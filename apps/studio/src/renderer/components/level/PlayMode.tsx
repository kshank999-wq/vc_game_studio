import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { startPoses } from '../../model/level/actors';
import { mannequin } from './mannequin';
import { BODY, collidersFrom, eyeOf, facing, look, step, type Body, type Collider } from '../../model/level/controller';
import { assetOf, frameOf, meshesFor, num, paramOf, type Mesh } from '../../model/level/geometry';
import { levelsOf } from '../../model/level/level';
import { exportNameOf } from '../../model/level/naming';
import { answerScreen, darknessAt, dismiss, inHand, interactWith, isOpen, lightOf, offerFor, present, spendStamina, startLevelPlay, tick, toggleLight, tracksStamina, traversalAt, useInHand, type LevelPlayState, type Offer, type Where } from '../../model/level/play';
import { equipmentList, equipmentOf, usesLeft } from '../../model/equipment';
import { recipesOf } from '../../model/crafting';
import { skillsOf } from '../../model/skills';
import type { AssetDefinition, LevelItem, Perspective, PlayPreset } from '../../model/level/types';
import type { PlayWorld } from '../../model/play';
import { shotsOf, describeShot } from '../../model/shots';
import type { Project } from '../../model/types';
import { usePreferences } from '../../preferences';
import { actionOfKey, controlsOf, keyLabel, padLabel, readPad, type Action } from './input';
import { PlayInspect } from './PlayInspect';
import { ScreenPlayer } from '../puzzle/ScreenPlayer';
import { screenOf } from '../../model/puzzle/screens';
import { buildPiece, disposePiece } from './three-pieces';

/**
 * Play Mode (spec §9): walk the graybox as the player, first person, third
 * person or from above, with the level's rules and the story's state live.
 * Keyboard and mouse or a controller; pause to inspect and change the state,
 * save it as a preset, or note an issue against the thing responsible.
 */

export interface PlayStart extends Where {
  yaw: number;
  floorId: string;
}

interface Props {
  project: Project;
  levelId: string;
  global: readonly AssetDefinition[];
  start: PlayStart;
  preset?: PlayPreset;
  /** The story so far, when arriving from another level. */
  world?: PlayWorld;
  perspective: Perspective;
  onPerspective: (p: Perspective) => void;
  onCommit: (project: Project) => void;
  /** Leave Play Mode, back to the editor (on the item the player was nearest, if any). */
  onExit: (nearItem?: string) => void;
  onGoToLevel: (levelId: string, world: PlayWorld) => void;
}

const PERSPECTIVES: { id: Perspective; label: string }[] = [
  { id: 'first', label: 'First person' },
  { id: 'third', label: 'Third person' },
  { id: 'top', label: 'Top-down' },
];

/** In play, the markers and volumes that are the designer's scaffolding stay out of sight (the debug overlay shows them). */
const shownInPlay = (set: ReturnType<typeof levelsOf>, item: LevelItem, m: Mesh, global: readonly AssetDefinition[]): boolean => {
  const def = assetOf(set, item, global);
  // Something to use shows as a faint box, so the player can find it; other volumes stay invisible.
  if (m.part === 'volume') return ['interaction', 'puzzle'].includes(def.role) || (def.role === 'gate' && m.collide);
  if (m.part === 'marker') return ['npc', 'companion', 'enemy', 'neutral'].includes(def.role);
  if (m.part === 'light') return def.id === 'light.practical' || def.id === 'light.emissive';
  if (def.kind !== 'space' && paramOf(set, item, 'visible', global) === false) return false;
  return true;
};

const actorColor: Record<string, string> = { enemy: '#e5484d', npc: '#d9607a', companion: '#5fa8d3', neutral: '#9a8f7a', item: '#6cc4d6' };

export const PlayMode = (props: Props) => {
  const { project, levelId, global } = props;
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const prefs = usePreferences();
  const controls = useMemo(() => controlsOf(prefs.playControls), [prefs.playControls]);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<LevelPlayState>(() => startLevelPlay(project, levelId, { preset: props.preset, world: props.world, global }));
  const [offer, setOffer] = useState<Offer | null>(null);
  const [paused, setPaused] = useState(false);
  // Which tab the paused panel opens on: the state, or the gear screen (I).
  const [pauseTab, setPauseTab] = useState<'state' | 'gear'>('state');
  const [debug, setDebug] = useState(false);
  const [locked, setLocked] = useState(false);
  const [padOn, setPadOn] = useState(false);
  const padRef = useRef(false);

  const state = useRef<LevelPlayState>(hud);
  const body = useRef<Body>({ x: props.start.x, y: props.start.y, z: props.start.z, vz: 0, yaw: props.start.yaw, pitch: 0, grounded: true });
  const held = useRef(new Set<Action>());
  const pressedOnce = useRef(new Set<Action>());
  const mouse = useRef({ dx: 0, dy: 0 });
  const latest = useRef({ props, paused, debug, controls, offer });
  latest.current = { props, paused, debug, controls, offer };

  const commitState = (next: LevelPlayState) => {
    state.current = next;
    setHud(next);
  };

  const restart = (from: 'start' | 'checkpoint' = 'start') => {
    const s = state.current;
    if (from === 'checkpoint' && s.checkpoint) {
      body.current = { ...body.current, ...s.checkpoint, vz: 0, grounded: true };
      commitState({ ...s, health: 100, over: undefined, log: [...s.log, { t: s.time, kind: 'info', text: 'Back at the checkpoint' }] });
    } else {
      body.current = { x: props.start.x, y: props.start.y, z: props.start.z, vz: 0, yaw: props.start.yaw, pitch: 0, grounded: true };
      commitState(startLevelPlay(project, levelId, { preset: props.preset, world: props.world, global }));
    }
    setPaused(false);
  };

  // ------------------------------------------------------------ the world as it stands

  const signature = useMemo(() => {
    const items = set.items.filter((i) => i.levelId === levelId);
    return items.map((i) => `${i.id}:${present(project, hud, i) ? 1 : 0}:${isOpen(project, hud, i, global) ? 1 : 0}`).join('|') + `|${hud.spawned.map((a) => a.id).join(',')}|${debug}|${props.perspective}`;
  }, [set, levelId, project, hud, global, debug, props.perspective]);

  const scene = useMemo(() => {
    const s = state.current;
    const all = meshesFor(set, levelId, { ceilings: true, global, models: true, skip: (i) => !present(project, s, i), open: (i) => isOpen(project, s, i, global) });
    const colliders: Collider[] = collidersFrom(all);
    const byId = new Map(set.items.map((i) => [i.id, i]));
    const visible = all.filter((m) => {
      const item = byId.get(m.itemId);
      if (!item) return false;
      // Ceilings hide the view from above.
      if (m.part === 'ceiling' && props.perspective !== 'first') return false;
      return debug || shownInPlay(set, item, m, global);
    });
    return { visible, colliders };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const collidersRef = useRef<Collider[]>(scene.colliders);
  collidersRef.current = scene.colliders;

  // ------------------------------------------------------------ three.js

  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; content: THREE.Group; avatar: THREE.Group; actors: THREE.Group; lamp: THREE.PointLight } | null>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  // Actors that move (patrols, companions): drawn in a group each, placed at their pose every frame.
  const movers = useRef(new Map<string, THREE.Group>());

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor('#07060a');
    el.appendChild(renderer.domElement);
    const s = new THREE.Scene();
    s.fog = new THREE.Fog('#07060a', 25, 90);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 400);
    camera.rotation.order = 'YXZ';
    s.add(new THREE.HemisphereLight('#f1e7cf', '#2a2416', 1.35));
    const sun = new THREE.DirectionalLight('#fff4dc', 1.1);
    sun.position.set(20, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, far: 150 });
    s.add(sun);
    const content = new THREE.Group();
    const actors = new THREE.Group();
    s.add(content, actors);
    // The player, seen in third person and from above.
    const avatar = new THREE.Group();
    avatar.add(mannequin('#c9a24a', BODY.height));
    s.add(avatar);
    // The player's light, carried at the head.
    const lamp = new THREE.PointLight('#ffd89a', 26, lightOf(project, levelId, global).range, 1.4);
    lamp.visible = false;
    s.add(lamp);
    three.current = { renderer, scene: s, camera, content, avatar, actors, lamp };
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height));
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const lockChange = () => setLocked(document.pointerLockElement === renderer.domElement);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerlockchange', lockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Rebuild what is drawn when what is there changes.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const child of [...t.content.children]) {
      t.content.remove(child);
      disposePiece(child);
    }
    let lights = 0;
    for (const g of movers.current.values()) {
      g.parent?.remove(g);
      g.traverse(disposePiece);
    }
    movers.current.clear();
    const origins = startPoses(set, levelId, global);
    // Characters placed in the level show as stand-in figures, not markers.
    const PEOPLE = new Set(['npc', 'enemy', 'companion', 'neutral']);
    const piece = (m: (typeof scene.visible)[number]) => {
      const item = m.part === 'marker' ? set.items.find((i) => i.id === m.itemId) : undefined;
      if (!item || !PEOPLE.has(assetOf(set, item, global).role)) return buildPiece(m, false);
      const figure = mannequin(actorColor[assetOf(set, item, global).role] ?? '#8fb07a');
      figure.position.set(m.x, m.y - m.sy / 2, m.z);
      figure.rotation.y = (-item.rotation * Math.PI) / 180;
      return figure;
    };
    for (const m of scene.visible) {
      const origin = origins[m.itemId];
      if (origin && state.current.actors?.[m.itemId]) {
        // Its pieces, about where it was placed; the outer group moves and turns it.
        let outer = movers.current.get(m.itemId);
        if (!outer) {
          outer = new THREE.Group();
          outer.userData = { origin, inner: new THREE.Group() };
          (outer.userData.inner as THREE.Group).position.set(-origin.x, -origin.z, -origin.y);
          outer.add(outer.userData.inner as THREE.Group);
          movers.current.set(m.itemId, outer);
          t.actors.add(outer);
        }
        (outer.userData.inner as THREE.Group).add(piece(m));
        continue;
      }
      t.content.add(piece(m));
      if (m.light && lights < 12) {
        lights++;
        const light = m.light.kind === 'spot'
          ? new THREE.SpotLight(m.light.color, m.light.intensity * 30, m.light.range, (m.light.angle ?? 40) * (Math.PI / 360), 0.4, 1.4)
          : new THREE.PointLight(m.light.color, m.light.intensity * 22, m.light.range * (m.light.kind === 'area' ? 1.5 : 1), 1.4);
        light.position.set(m.x, m.y, m.z);
        t.content.add(light);
      }
    }
    for (const child of [...t.actors.children]) if (![...movers.current.values()].includes(child as THREE.Group)) t.actors.remove(child);
    const elevation = new Map(level?.floors.map((f) => [f.id, f.elevation]) ?? []);
    for (const a of state.current.spawned) {
      // People appear as stand-in figures; a spawned item as a small crate.
      const color = actorColor[a.role] ?? '#9aa0a6';
      const figure = a.role === 'item' ? new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color })) : mannequin(color);
      figure.position.set(a.x, (elevation.get(a.floorId) ?? 0) + (a.role === 'item' ? 0.2 : 0), a.y);
      figure.castShadow = true;
      t.actors.add(figure);
    }
  }, [scene, level]);

  // ------------------------------------------------------------ input

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey) return;
      // Rebinding a control takes the next key itself.
      if (document.querySelector('.play-bind.listening')) return;
      const action = actionOfKey(latest.current.controls, e.code);
      if (e.code === 'Escape') {
        e.preventDefault();
        if (latest.current.paused) setPaused(false);
        else setPaused(true);
        return;
      }
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (!held.current.has(action)) pressedOnce.current.add(action);
      held.current.add(action);
    };
    const up = (e: KeyboardEvent) => {
      const action = actionOfKey(latest.current.controls, e.code);
      if (action) held.current.delete(action);
    };
    const blur = () => held.current.clear();
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement === three.current?.renderer.domElement) {
        mouse.current.dx += e.movementX;
        mouse.current.dy += e.movementY;
      }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('mousemove', move);
    };
  }, []);

  // Without pointer lock, drag to look.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || failed) return;
    const canvas = three.current?.renderer.domElement;
    if (props.perspective !== 'top' && canvas?.requestPointerLock && !paused) {
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => undefined);
      } catch {
        // Locking the pointer isn't allowed here: dragging looks instead.
      }
    }
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || locked) return;
    mouse.current.dx += (e.clientX - drag.current.x) * 1.5;
    mouse.current.dy += (e.clientY - drag.current.y) * 1.5;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  useEffect(() => {
    if (paused && document.pointerLockElement) document.exitPointerLock?.();
    held.current.clear();
  }, [paused]);

  // A screen puzzle wants the mouse.
  useEffect(() => {
    if (hud.screen && document.pointerLockElement) document.exitPointerLock?.();
    held.current.clear();
  }, [hud.screen]);

  // ------------------------------------------------------------ the loop

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let padWas = new Set<Action>();
    let hudAt = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Slow frames still move at the real speed (the controller sub-steps); a long stall doesn't teleport.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { props: p, paused: isPaused, controls: c } = latest.current;
      const t = three.current;
      const pad = readPad(c);
      if (pad.connected !== padRef.current) {
        padRef.current = pad.connected;
        setPadOn(pad.connected);
      }
      for (const a of pad.pressed) if (!padWas.has(a)) pressedOnce.current.add(a);
      padWas = pad.pressed;
      const once = (a: Action) => {
        const was = pressedOnce.current.has(a);
        pressedOnce.current.delete(a);
        return was;
      };
      if (once('inspect')) {
        setPauseTab('state');
        setPaused((v) => !v);
      }
      if (once('gear')) {
        setPauseTab('gear');
        setPaused(true);
      }
      if (once('debug')) setDebug((v) => !v);
      if (once('view')) p.onPerspective(p.perspective === 'first' ? 'third' : p.perspective === 'third' ? 'top' : 'first');
      if (once('note')) setPaused(true);
      const on = (a: Action) => held.current.has(a) || pad.pressed.has(a);
      let s = state.current;

      if (!isPaused && !s.over) {
        const overlay = !!(s.cinematic || s.scene || s.screen);
        if (overlay) {
          // A screen puzzle is answered with the mouse; the rest go with the interact key.
          if (!s.screen && (once('interact') || once('jump'))) s = dismiss(s);
          s = tick(p.project, s, dt, body.current, p.global);
        } else {
          // Look.
          const speed = 0.0024 * c.lookSpeed;
          const turnKeys = (on('turnRight') ? 1 : 0) - (on('turnLeft') ? 1 : 0);
          const invert = c.invertY ? -1 : 1;
          if (p.perspective !== 'top') {
            body.current = look(body.current, mouse.current.dx * speed + turnKeys * 2.2 * dt + pad.lookX * 2.6 * dt * c.lookSpeed, -(mouse.current.dy * speed + pad.lookY * 2 * dt * c.lookSpeed) * invert);
          }
          mouse.current = { dx: 0, dy: 0 };
          // Move.
          const forward = (on('forward') ? 1 : 0) - (on('back') ? 1 : 0) - pad.moveY;
          const strafe = (on('right') ? 1 : 0) - (on('left') ? 1 : 0) + pad.moveX;
          const top = p.perspective === 'top';
          // Ladders and water change how the body moves; out of stamina, it can't run.
          const at = traversalAt(p.project, s, body.current, p.global);
          const running = on('run') && (s.stamina ?? 100) > 0;
          const next = step(body.current, { forward, strafe: top ? strafe + turnKeys : strafe, jump: on('jump'), run: running, crouch: on('crouch'), worldAxes: top, ladder: at.ladder, water: at.water }, dt, collidersRef.current);
          const moving = Math.abs(forward) > 0.1 || Math.abs(strafe) > 0.1;
          s = spendStamina(p.project, s, dt, { run: running && moving && !next.swimming && !next.climbing, swim: !!next.swimming, climb: !!next.climbing && Math.abs(forward) > 0.1 }, p.global);
          if (top && (Math.abs(forward) > 0.1 || Math.abs(strafe + turnKeys) > 0.1)) next.yaw = Math.atan2(strafe + turnKeys, forward);
          body.current = next;
          // Fell out of the world: back to the checkpoint or the start.
          const lowest = Math.min(...(level?.floors.map((f) => f.elevation) ?? [0]));
          if (body.current.z < lowest - 25) {
            const back = s.checkpoint ?? p.start;
            body.current = { ...body.current, x: back.x, y: back.y, z: back.z, vz: 0, grounded: true };
            s = { ...s, log: [...s.log, { t: s.time, kind: 'warn', text: 'Fell out of the level' }] };
          }
          s = tick(p.project, s, dt, body.current, p.global);
          // What is in reach.
          const target = nearestOffer(p.project, s, body.current, p.perspective, p.global);
          if ((target?.itemId ?? null) !== (latest.current.offer?.itemId ?? null) || target?.verb !== latest.current.offer?.verb || target?.blocked !== latest.current.offer?.blocked) setOffer(target);
          if (once('interact') && target) s = interactWith(p.project, s, target.itemId, p.global);
          if (once('light')) s = toggleLight(p.project, s, p.global);
          if (once('useItem')) s = useInHand(p.project, s);
        }
        if (s.placePlayer) {
          body.current = { ...body.current, ...s.placePlayer, vz: 0, grounded: true };
          s = { ...s, placePlayer: undefined };
        }
        if (s.goTo) {
          p.onGoToLevel(s.goTo, s.world);
          s = { ...s, goTo: undefined };
        }
      }
      pressedOnce.current.delete('interact');
      pressedOnce.current.delete('jump');
      pressedOnce.current.delete('light');
      pressedOnce.current.delete('useItem');
      if (s !== state.current) {
        state.current = s;
        // The HUD follows at 12 frames a second; anything that changes what is there shows at once.
        if (now - hudAt > 80 || s.world !== hud.world || s.gone !== hud.gone || s.open !== hud.open || s.cinematic !== hud.cinematic || s.scene !== hud.scene || s.screen !== hud.screen || s.over !== hud.over || s.spawned !== hud.spawned || s.enabled !== hud.enabled || s.light?.on !== hud.light?.on) {
          hudAt = now;
          setHud(s);
        }
      }
      if (!t) return;
      for (const [id, g] of movers.current) {
        const pose = s.actors?.[id];
        const origin = g.userData.origin as { yaw: number };
        if (!pose) continue;
        g.position.set(pose.x, pose.z, pose.y);
        g.rotation.y = -(pose.yaw - origin.yaw);
      }
      placeCamera(t, body.current, p.perspective, collidersRef.current);
      // The dark (spec §6): the view goes dark in a darkness zone; the player's light pushes it back around them.
      const { dark, lit } = darknessAt(p.project, s, p.global);
      const shade = `${dark.toFixed(2)}:${lit ? 1 : 0}`;
      if (darkRef.current && darkRef.current.dataset.shade !== shade) {
        darkRef.current.dataset.shade = shade;
        darkRef.current.style.background = dark <= 0 ? 'none' : lit ? `radial-gradient(circle at 50% 55%, rgba(0,0,0,${(dark * 0.15).toFixed(2)}) 0%, rgba(0,0,0,${(dark * 0.35).toFixed(2)}) 35%, rgba(0,0,0,${dark.toFixed(2)}) 75%)` : `rgba(0,0,0,${dark.toFixed(2)})`;
      }
      t.lamp.visible = !!s.light?.on && lit;
      t.lamp.position.set(body.current.x, body.current.z + eyeOf(body.current) + 0.2, body.current.y);
      if (latest.current.debug) drawLabels(labels.current, t.camera, p.project, s, p.global);
      else if (labels.current && labels.current.childElementCount) labels.current.replaceChildren();
      t.renderer.render(t.scene, t.camera);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // The loop reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.world, hud.gone, hud.open, hud.cinematic, hud.scene, hud.over, hud.spawned, hud.enabled]);

  // ------------------------------------------------------------ what the player sees over the level

  const items = Object.entries(hud.world.items).filter(([, n]) => n > 0);
  const staminaShown = tracksStamina(project, levelId, global);
  // Gear, skills and crafting (spec §8): what is in hand, and a way to the gear screen when the story has any.
  const hasGear = equipmentList(project).length > 0 || skillsOf(project).length > 0 || recipesOf(project).length > 0;
  const hand = inHand(hud);
  const handGear = hand ? equipmentOf(project.objects[hand]) : undefined;
  const handLeft = hand ? usesLeft(project, hud.world, hand) : Infinity;
  // Health shows when something here can hurt.
  const dangerous = set.items.some(
    (i) => i.levelId === levelId && ['hazard', 'damage'].includes(assetOf(set, i, global).role) && (num(paramOf(set, i, 'damage', global), 0) > 0 || paramOf(set, i, 'kills', global) === true),
  );
  const lightSource = lightOf(project, levelId, global).source;
  const cinematic = hud.cinematic ? project.objects[hud.cinematic.id] : undefined;
  const nearest = () => nearestItem(project, state.current, body.current, global);

  return (
    <div className="play-mode">
      <div ref={host} className={`play-view${locked ? ' locked' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="application" aria-label="Play Mode" />
      <div ref={labels} className="play-labels" aria-hidden="true" />
      <div ref={darkRef} className="play-dark" aria-hidden="true" />
      {failed && (
        <div className="play-card" role="status">
          <p>Play Mode needs WebGL, which this browser has switched off.</p>
          <button className="tb-btn" onClick={() => props.onExit()}>Back to the editor</button>
        </div>
      )}
      <div className="play-hud-top">
        <div className="play-chip">
          ▶ {level?.name}
          <select className="play-persp" aria-label="Perspective" value={props.perspective} onChange={(e) => props.onPerspective(e.target.value as Perspective)}>
            {PERSPECTIVES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {hud.objective && <div className="play-objective">Objective: {hud.objective}</div>}
        <div className="grow" />
        {staminaShown && (hud.stamina ?? 100) < 100 && (
          <div className="play-health play-stamina" aria-label={`Stamina ${Math.round(hud.stamina ?? 100)}`}>
            <span style={{ width: `${Math.max(0, hud.stamina ?? 100)}%` }} />
          </div>
        )}
        {(dangerous || hud.health < 100) && (
          <div className="play-health" aria-label={`Health ${Math.round(hud.health)}`}>
            <span style={{ width: `${Math.max(0, hud.health)}%` }} />
          </div>
        )}
        {lightSource && (
          <div className={`play-light${hud.light?.on ? ' on' : ''}`} aria-label="Light" title={`Light on or off (${controls.keys.light.map(keyLabel).join(' / ')}) · ${project.objects[lightSource]?.name ?? ''}`}>
            {hud.light?.on ? 'Light on' : `Light off · ${controls.keys.light.map(keyLabel).join('/')}`}
            {hud.light && Number.isFinite(hud.light.fuel) && <span className="play-light-fuel"> · {Math.ceil(hud.light.fuel)} s</span>}
          </div>
        )}
        <div className="play-inventory" aria-label="Carrying">
          {items.map(([id, n]) => (
            <span key={id} className="play-item">
              {project.objects[id]?.name ?? '?'}
              {n > 1 ? ` × ${n}` : ''}
            </span>
          ))}
        </div>
        {hand && handGear && (
          <div className="play-hand" aria-label="In hand" title={`Use it (${controls.keys.useItem.map(keyLabel).join(' / ')})`}>
            Hand: {project.objects[hand]?.name}
            <span className="play-hand-detail">
              {handGear.ammo ? ` · ${hud.world.items[handGear.ammo] ?? 0} ${project.objects[handGear.ammo]?.name ?? ''}` : ''}
              {Number.isFinite(handLeft) ? ` · ${handLeft} ${handLeft === 1 ? 'use' : 'uses'} left` : ''} · {controls.keys.useItem.map(keyLabel).join('/')}
            </span>
          </div>
        )}
        {hasGear && (
          <button
            className="tb-btn small"
            onClick={() => {
              setPauseTab('gear');
              setPaused(true);
            }}
            title={`Gear, skills and crafting (${controls.keys.gear.map(keyLabel).join(' / ')})`}
          >
            Gear
          </button>
        )}
        <button className="tb-btn small" onClick={() => { setPauseTab('state'); setPaused(true); }} title={`Pause and inspect (${controls.keys.inspect.map(keyLabel).join(' / ')})`}>
          ❚❚ Inspect
        </button>
        <button className="tb-btn small" onClick={() => props.onExit(nearest())}>
          Stop
        </button>
      </div>
      {props.perspective === 'first' && !hud.cinematic && !hud.scene && <div className="play-crosshair" aria-hidden="true" />}
      {offer && !hud.cinematic && !hud.scene && !paused && (
        <div className={`play-prompt${offer.blocked ? ' blocked' : ''}`} role="status">
          <kbd>{padOn ? padLabel(controls.pad.interact[0] ?? 2) : keyLabel(controls.keys.interact[0] ?? 'KeyE')}</kbd>
          {offer.blocked ? `${offer.label}: ${offer.blocked}` : `${offer.verb} · ${offer.label}`}
        </div>
      )}
      {hud.message && <div className="play-message">{hud.message.text}</div>}
      {!locked && !paused && props.perspective !== 'top' && !failed && !hud.cinematic && !hud.scene && (
        <div className="play-hint">Click to look around with the mouse (Esc gives the pointer back) · {controls.keys.forward.map(keyLabel)[0]}{controls.keys.left.map(keyLabel)[0]}{controls.keys.back.map(keyLabel)[0]}{controls.keys.right.map(keyLabel)[0]} to move · {keyLabel(controls.keys.interact[0] ?? 'KeyE')} to use · {keyLabel(controls.keys.inspect[0] ?? 'Tab')} to inspect{hasGear ? ` · ${keyLabel(controls.keys.gear[0] ?? 'KeyI')} for gear` : ''}{padOn ? ' · controller connected' : ''}</div>
      )}
      {debug && (
        <div className="play-debug">
          <div className="mono">
            {body.current.x.toFixed(1)}, {body.current.y.toFixed(1)} · z {body.current.z.toFixed(2)} · {Math.round((((body.current.yaw * 180) / Math.PI) % 360 + 360) % 360)}° {body.current.grounded ? '' : '· in the air'}
          </div>
          <div>Inside: {hud.inside.map((id) => set.items.find((i) => i.id === id)?.name).join(', ') || 'nothing'}</div>
          {hud.log.slice(-6).map((l, n) => (
            <div key={n} className={`play-log-line ${l.kind}${l.pass === false ? ' fail' : ''}`}>
              <span className="mono">{l.t.toFixed(1)}s</span> {l.text}
            </div>
          ))}
        </div>
      )}
      {hud.cinematic && (
        <div className="play-cine-overlay" role="dialog" aria-label="Cinematic">
          <div className="play-bars" />
          <div className="play-cine-body">
            <span className="play-kicker">CINEMATIC</span>
            <h2>{hud.cinematic.name}</h2>
            {cinematic && shotsOf(cinematic).length > 0 && (
              <ol>
                {shotsOf(cinematic).map((shot, n) => (
                  <li key={n}>{describeShot(project, shot)}</li>
                ))}
              </ol>
            )}
            <div className="play-progress">
              <span style={{ width: `${Math.min(100, (1 - (hud.cinematic.until - hud.time) / hud.cinematic.seconds) * 100)}%` }} />
            </div>
            <button className="tb-btn small" onClick={() => commitState(dismiss(state.current))}>
              Skip ({keyLabel(controls.keys.interact[0] ?? 'KeyE')})
            </button>
          </div>
        </div>
      )}
      {hud.screen && screenOf(project.objects[hud.screen.objectId]) && (
        <div className="play-card play-screen">
          <ScreenPlayer
            project={project}
            screen={screenOf(project.objects[hud.screen.objectId])!}
            seed={hud.screen.objectId}
            title={project.objects[hud.screen.objectId]!.name}
            triesUsed={hud.world.screenFails?.[hud.screen.objectId] ?? 0}
            onRight={() => commitState(answerScreen(project, state.current, 'right'))}
            onWrong={() => commitState(answerScreen(project, state.current, 'wrong'))}
            onLeave={() => commitState(answerScreen(project, state.current, 'leave'))}
          />
        </div>
      )}
      {hud.scene && (
        <div className="play-card" role="dialog" aria-label="Scene">
          <span className="play-kicker">SCENE</span>
          <h2>{hud.scene.title}</h2>
          {hud.scene.text && <p>{hud.scene.text}</p>}
          <p className="muted">The scene plays here in the game. In the studio, its script and timeline play in the story’s play-through.</p>
          <button className="tb-btn primary" onClick={() => commitState(dismiss(state.current))}>
            Carry on ({keyLabel(controls.keys.interact[0] ?? 'KeyE')})
          </button>
        </div>
      )}
      {hud.over && (
        <div className="play-card" role="dialog" aria-label="Game over">
          <span className="play-kicker">GAME OVER</span>
          <h2>{hud.over.text}</h2>
          <div className="lvl-btnrow">
            {hud.checkpoint && <button className="tb-btn primary" onClick={() => restart('checkpoint')}>From the checkpoint</button>}
            <button className="tb-btn" onClick={() => restart('start')}>Start again</button>
            <button className="tb-btn" onClick={() => props.onExit(nearest())}>Back to the editor</button>
          </div>
        </div>
      )}
      {paused && (
        <PlayInspect
          key={pauseTab}
          tab={pauseTab}
          project={project}
          levelId={levelId}
          state={hud}
          at={body.current}
          nearest={nearest()}
          onState={(s) => commitState(s)}
          onCommit={props.onCommit}
          onResume={() => setPaused(false)}
          onRestart={() => restart('start')}
          onExit={() => props.onExit(nearest())}
        />
      )}
    </div>
  );
};

export default PlayMode;

// ---------------------------------------------------------------- helpers

/** The camera for each perspective. In third person it comes in rather than go through a wall. */
const placeCamera = (t: { camera: THREE.PerspectiveCamera; avatar: THREE.Group }, b: Body, perspective: Perspective, colliders: readonly Collider[]) => {
  const { camera, avatar } = t;
  avatar.position.set(b.x, b.z, b.y);
  avatar.rotation.y = -b.yaw;
  avatar.scale.y = b.crouched ? 0.63 : 1;
  avatar.visible = perspective !== 'first';
  if (perspective === 'first') {
    camera.fov = 72;
    camera.position.set(b.x, b.z + eyeOf(b), b.y);
    camera.rotation.set(b.pitch, -b.yaw, 0, 'YXZ');
  } else if (perspective === 'third') {
    camera.fov = 65;
    const f = facing(b);
    const pitch = Math.max(-0.6, Math.min(0.9, b.pitch));
    let distance = 4.2;
    // Pull in to the nearest wall between the head and the camera.
    for (let d = 0.4; d <= 4.2; d += 0.2) {
      const px = b.x - f.x * d * Math.cos(pitch);
      const py = b.y - f.y * d * Math.cos(pitch);
      const pz = b.z + eyeOf(b) + 0.7 - Math.sin(pitch) * d;
      if (colliders.some((c) => pz > c.bottom && pz < c.top && Math.abs((px - c.x) * Math.cos(c.rot) + (py - c.y) * Math.sin(c.rot)) <= c.hw && Math.abs(-(px - c.x) * Math.sin(c.rot) + (py - c.y) * Math.cos(c.rot)) <= c.hd)) {
        distance = Math.max(0.4, d - 0.25);
        break;
      }
    }
    camera.position.set(b.x - f.x * distance * Math.cos(pitch), b.z + eyeOf(b) + 0.7 - Math.sin(pitch) * distance, b.y - f.y * distance * Math.cos(pitch));
    camera.lookAt(b.x, b.z + eyeOf(b), b.y);
  } else {
    camera.fov = 50;
    camera.position.set(b.x, b.z + 16, b.y + 7);
    camera.lookAt(b.x, b.z, b.y);
  }
  camera.updateProjectionMatrix();
};

/** The nearest thing the player can use: within its reach, and (unless seen from above) in front of them. */
const nearestOffer = (project: Project, state: LevelPlayState, b: Body, perspective: Perspective, global: readonly AssetDefinition[]): Offer | null => {
  const set = levelsOf(project);
  const f = facing(b);
  let best: { offer: Offer; d: number } | null = null;
  for (const item of set.items) {
    if (item.levelId !== state.levelId) continue;
    const def = assetOf(set, item, global);
    if (def.kind === 'space' || !present(project, state, item)) continue;
    const fr = frameOf(set, item, global);
    const floor = set.levels.find((l) => l.id === item.levelId)?.floors.find((x) => x.id === item.floorId);
    // Someone walking a patrol (or following) is talked to where they are now.
    const pose = state.actors?.[item.id];
    const base = pose ? pose.z : (floor?.elevation ?? 0) + fr.z;
    if (b.z + BODY.height < base - 0.3 || b.z > base + Math.max(fr.h, 1) + 0.5) continue;
    const dx = (pose?.x ?? fr.x) - b.x;
    const dy = (pose?.y ?? fr.y) - b.y;
    const d = Math.hypot(dx, dy);
    const reach = num(paramOf(set, item, 'range', global), 1.5) + Math.max(fr.w, def.kind === 'hosted' ? 0.3 : fr.d) / 2 + 0.2;
    if (d > reach) continue;
    if (perspective !== 'top' && d > 0.6 && (dx * f.x + dy * f.y) / d < 0.35) continue;
    const offer = offerFor(project, state, item, global);
    if (offer && (!best || d < best.d)) best = { offer, d };
  }
  return best?.offer ?? null;
};

/** The item nearest the player, for notes and for going back to the editor. */
const nearestItem = (project: Project, state: LevelPlayState, b: Body, global: readonly AssetDefinition[]): string | undefined => {
  const set = levelsOf(project);
  let best: { id: string; d: number } | undefined;
  for (const item of set.items) {
    if (item.levelId !== state.levelId) continue;
    const def = assetOf(set, item, global);
    if (def.kind === 'space') continue;
    const f = frameOf(set, item, global);
    const d = Math.hypot(f.x - b.x, f.y - b.y);
    if (d < 6 && (!best || d < best.d)) best = { id: item.id, d };
  }
  if (best) return best.id;
  // Otherwise the space they are standing in.
  return set.items.find((i) => i.levelId === state.levelId && assetOf(set, i, global).kind === 'space' && (() => {
    const f = frameOf(set, i, global);
    return Math.abs(b.x - f.x) <= f.w / 2 && Math.abs(b.y - f.y) <= f.d / 2;
  })())?.id;
};

/** Names over things for the debug overlay (spec §9.3): items within reach of sight, their export names and story links. */
const drawLabels = (root: HTMLDivElement | null, camera: THREE.PerspectiveCamera, project: Project, state: LevelPlayState, global: readonly AssetDefinition[]) => {
  if (!root) return;
  const set = levelsOf(project);
  const floorOf = new Map(set.levels.find((l) => l.id === state.levelId)?.floors.map((f) => [f.id, f.elevation]) ?? []);
  const rect = root.getBoundingClientRect();
  const v = new THREE.Vector3();
  const shown: { key: string; x: number; y: number; html: string; cls: string }[] = [];
  for (const item of set.items) {
    if (item.levelId !== state.levelId || item.hidden) continue;
    const def = assetOf(set, item, global);
    const f = frameOf(set, item, global);
    v.set(f.x, (floorOf.get(item.floorId) ?? 0) + f.z + Math.min(f.h, 2.2) + 0.2, f.y);
    if (v.distanceTo(camera.position) > 28) continue;
    v.project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
    const links = (item.links ?? []).map((l) => project.objects[l]).filter(Boolean).map((o) => (o!.data.code ? String(o!.data.code) : o!.name));
    const off = !present(project, state, item);
    shown.push({
      key: item.id,
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
      cls: `play-label${def.kind === 'volume' ? ' volume' : ''}${state.inside.includes(item.id) ? ' inside' : ''}${off ? ' off' : ''}`,
      html: `<b>${escape(item.name)}</b><span>${escape(exportNameOf(set, item, global))}${links.length ? ` · ${escape(links.join(', '))}` : ''}${off ? ' · not present' : ''}</span>`,
    });
    if (shown.length >= 40) break;
  }
  const existing = new Map([...root.children].map((c) => [(c as HTMLElement).dataset.key!, c as HTMLElement]));
  for (const s of shown) {
    let el = existing.get(s.key);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = s.key;
      root.appendChild(el);
    }
    existing.delete(s.key);
    if (el.className !== s.cls) el.className = s.cls;
    if (el.innerHTML !== s.html) el.innerHTML = s.html;
    el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }
  for (const el of existing.values()) el.remove();
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
