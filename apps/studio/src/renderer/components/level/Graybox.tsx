import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { frameOf, meshesFor, toLocal, type Point } from '../../model/level/geometry';
import { buildPiece, disposePiece } from './three-pieces';
import { extrude, levelsOf, moveItems, placeAt, setPivot, snap, withGroups } from '../../model/level/level';
import { navigate } from '../../model/level/nav';
import { alongLine, buildCollision, buildHandles, buildWalkable, clearGroup, type Axes, type Handle, type Tool3d } from './gizmo';
import type { AssetDefinition } from '../../model/level/types';
import type { Project } from '../../model/types';

/**
 * The 3D graybox (spec §5): the same items as the map, as proxy geometry.
 * Orbit with the left button, pan with the right, zoom with the wheel; click
 * to select, drag a selected item to move it across its floor.
 */

export interface GrayboxApi {
  worldAt: (clientX: number, clientY: number) => Point | null;
  frame: (ids?: readonly string[]) => void;
  /** Where the camera stands on the plan and which way it looks, to start playing from there. */
  cameraSpot: () => { x: number; y: number; yaw: number } | null;
}

interface Props {
  project: Project;
  levelId: string;
  floorId: string;
  /** Every floor, or just the current one. */
  allFloors: boolean;
  ceilings: boolean;
  /** Show trigger volumes, spawn radii and collision edges. */
  logic: boolean;
  global: readonly AssetDefinition[];
  selection: readonly string[];
  onSelect: (ids: string[]) => void;
  onCommit: (project: Project) => void;
  placing: string | null;
  onPlace: (at: Point) => void;
  onHover: (at: Point | null) => void;
  /** Items to bring into view when the graybox opens. */
  focus?: readonly string[];
  /** What the selected item's handles do: move it along an axis, push or pull its faces, or place its pivot. */
  tool: Tool3d;
  axes: Axes;
  /** Show what the player collides with, and where they can walk from the start. */
  collision: boolean;
  walkable: boolean;
}

export const Graybox = forwardRef<GrayboxApi, Props>((props, ref) => {
  const { project, levelId, floorId, global } = props;
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    handles: THREE.Group;
    overlay: THREE.Group;
    grid: THREE.GridHelper;
    render: () => void;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Project | null>(null);
  const previewRef = useRef<Project | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const shown = preview ?? project;
  const set = levelsOf(shown);
  const level = set.levels.find((l) => l.id === levelId);
  const floorElevation = level?.floors.find((f) => f.id === floorId)?.elevation ?? 0;

  const meshes = useMemo(
    () =>
      meshesFor(set, levelId, {
        ceilings: props.ceilings,
        global,
        ...(props.allFloors ? {} : { floorId }),
      }).filter((m) => props.logic || m.part !== 'volume'),
    [set, levelId, floorId, props.allFloors, props.ceilings, props.logic, global],
  );

  // ------------------------------------------------------------ setup

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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#0b0a07');
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#0b0a07', 60, 220);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
    camera.position.set(14, 16, 18);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.maxPolarAngle = Math.PI * 0.495;
    scene.add(new THREE.HemisphereLight('#f1e7cf', '#221d10', 1.1));
    const sun = new THREE.DirectionalLight('#fff4dc', 1.6);
    sun.position.set(20, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 150 });
    scene.add(sun);
    const grid = new THREE.GridHelper(200, 200, '#3a3218', '#1c1910');
    scene.add(grid);
    const content = new THREE.Group();
    scene.add(content);
    const handles = new THREE.Group();
    scene.add(handles);
    const overlay = new THREE.Group();
    scene.add(overlay);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height));
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    three.current = { renderer, scene, camera, controls, content, handles, overlay, grid, render };
    resize();
    return () => {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // ------------------------------------------------------------ content

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const child of [...t.content.children]) {
      t.content.remove(child);
      disposePiece(child);
    }
    const selected = new Set(props.selection);
    let lights = 0;
    for (const m of meshes) {
      const piece = buildPiece(m, selected.has(m.itemId));
      t.content.add(piece);
      if (m.light && lights < 12) {
        lights++;
        const color = new THREE.Color(m.light.color);
        const light =
          m.light.kind === 'spot'
            ? new THREE.SpotLight(color, m.light.intensity * 30, m.light.range, (m.light.angle ?? 40) * (Math.PI / 360), 0.4, 1.4)
            : m.light.kind === 'area'
              ? new THREE.PointLight(color, m.light.intensity * 18, m.light.range * 1.5, 1.2)
              : new THREE.PointLight(color, m.light.intensity * 22, m.light.range, 1.4);
        light.position.set(m.x, m.y, m.z);
        if (light instanceof THREE.SpotLight) {
          light.target.position.set(m.x - Math.sin(m.rotY) * 2, m.y - 2, m.z - Math.cos(m.rotY) * 2);
          t.scene.add(light.target);
        }
        t.content.add(light);
      }
    }
    t.grid.position.y = floorElevation - 0.001;
    t.render();
  }, [meshes, props.selection, floorElevation]);

  // The selected item's handles.
  const single = props.selection.length === 1 ? set.items.find((i) => i.id === props.selection[0]) : undefined;
  const editable = single && !single.host && !single.locked && single.levelId === levelId && (props.allFloors || single.floorId === floorId) ? single : undefined;
  const itemElevation = level?.floors.find((f) => f.id === editable?.floorId)?.elevation ?? floorElevation;
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    clearGroup(t.handles);
    if (editable) buildHandles(t.handles, set, editable, props.tool, props.axes, itemElevation, global);
    t.render();
  }, [set, editable, props.tool, props.axes, itemElevation, global]);

  // Collision and where the player can walk.
  const colliders = useMemo(
    () => (props.collision ? meshesFor(set, levelId, { ceilings: true, global, ...(props.allFloors ? {} : { floorId }) }) : []),
    [props.collision, set, levelId, global, props.allFloors, floorId],
  );
  const nav = useMemo(() => (props.walkable ? navigate(set, levelId, global) : null), [props.walkable, set, levelId, global]);
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    clearGroup(t.overlay);
    if (props.collision) buildCollision(t.overlay, colliders);
    if (nav) {
      const top = level?.floors.find((f) => f.id === floorId);
      const cells = props.allFloors || !top ? nav.cells : nav.cells.filter((c) => c.z >= top.elevation - 0.6 && c.z < top.elevation + top.height);
      buildWalkable(t.overlay, cells, nav.cell);
    }
    t.render();
  }, [colliders, nav, props.collision, props.allFloors, floorId, level]);

  const frame = (ids?: readonly string[]) => {
    const t = three.current;
    if (!t) return;
    const box = new THREE.Box3();
    const wanted = ids?.length ? new Set(ids) : null;
    t.content.traverse((o) => {
      if (o instanceof THREE.Mesh && (!wanted || wanted.has(o.userData.itemId as string))) box.expandByObject(o);
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-6, floorElevation, -6), new THREE.Vector3(6, floorElevation + 3, 6));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const distance = Math.max(6, size * 1.1);
    t.controls.target.copy(centre);
    t.camera.position.copy(centre).add(new THREE.Vector3(0.62, 0.75, 0.9).normalize().multiplyScalar(distance));
    t.controls.update();
    t.render();
  };

  // Open on what was asked for.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !three.current) return;
    framed.current = true;
    frame(props.focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes]);

  const ground = (clientX: number, clientY: number, height = floorElevation): THREE.Vector3 | null => {
    const t = three.current;
    if (!t) return null;
    const r = t.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), t.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), hit) ? hit : null;
  };

  const rayAt = (clientX: number, clientY: number): THREE.Raycaster | null => {
    const t = three.current;
    if (!t) return null;
    const r = t.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), t.camera);
    return ray;
  };

  const handleAt = (clientX: number, clientY: number): Handle | null => {
    const t = three.current;
    const ray = rayAt(clientX, clientY);
    if (!t || !ray) return null;
    const hit = ray.intersectObjects(t.handles.children, false).find((h) => h.object.userData.handle);
    return (hit?.object.userData.handle as Handle | undefined) ?? null;
  };

  const pick = (clientX: number, clientY: number): string | null => {
    const t = three.current;
    if (!t) return null;
    const r = t.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), t.camera);
    const hits = ray.intersectObjects(t.content.children, true).filter((h) => h.object instanceof THREE.Mesh && h.object.userData.itemId);
    // Look through floors and see-through volumes to what stands on them.
    const solid = hits.find((h) => ((h.object as THREE.Mesh).material as THREE.Material).opacity >= 0.5) ?? hits[0];
    return (solid?.object.userData.itemId as string | undefined) ?? null;
  };

  useImperativeHandle(ref, () => ({
    worldAt: (clientX, clientY) => {
      const r = host.current?.getBoundingClientRect();
      if (!r || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      const p = ground(clientX, clientY);
      return p ? { x: p.x, y: p.z } : null;
    },
    frame,
    cameraSpot: () => {
      const t = three.current;
      if (!t) return null;
      const dir = t.camera.getWorldDirection(new THREE.Vector3());
      return { x: t.camera.position.x, y: t.camera.position.z, yaw: Math.atan2(dir.x, -dir.z) };
    },
  }));

  // ------------------------------------------------------------ pointer work

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const el = t.renderer.domElement;
    let down: { x: number; y: number; drag: { ids: string[]; start: THREE.Vector3 } | null; moved: boolean } | null = null;
    // A handle being dragged: which, on what item, and where along its line it was picked up.
    let held: { handle: Handle; id: string; from: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const p = latest.current;
      if (e.button !== 0) return;
      if (p.placing) {
        const g = ground(e.clientX, e.clientY);
        if (g) p.onPlace({ x: g.x, y: g.z });
        e.stopImmediatePropagation();
        return;
      }
      const handle = handleAt(e.clientX, e.clientY);
      const selected = p.selection[0];
      if (handle && selected) {
        const item = levelsOf(p.project).items.find((i) => i.id === selected)!;
        const ray = rayAt(e.clientX, e.clientY)!;
        held = { handle, id: selected, from: handle.kind === 'pivot' ? 0 : alongLine(ray.ray, handle.origin, handle.dir), x: item.x, y: item.y };
        t.controls.enabled = false;
        e.stopImmediatePropagation();
        return;
      }
      const id = pick(e.clientX, e.clientY);
      down = { x: e.clientX, y: e.clientY, drag: null, moved: false };
      if (id && p.selection.includes(id) && !e.shiftKey) {
        const s = levelsOf(p.project);
        const ids = p.selection.filter((x) => !s.items.find((i) => i.id === x)?.locked);
        const start = ground(e.clientX, e.clientY);
        if (ids.length && start) {
          down.drag = { ids, start };
          t.controls.enabled = false;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = latest.current;
      if (held) {
        const ray = rayAt(e.clientX, e.clientY)!;
        const h = held.handle;
        let next: Project | null = null;
        if (h.kind === 'pivot') {
          const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.height), new THREE.Vector3());
          const set0 = levelsOf(p.project);
          const item = set0.items.find((i) => i.id === held!.id)!;
          if (hit) {
            const f = frameOf(set0, item, p.global);
            const l = toLocal(f, { x: hit.x, y: hit.z });
            // Near a corner, an edge's middle or the centre, it settles there.
            const settle = (v: number) => ([-0.5, 0, 0.5].find((q) => Math.abs(v - q) < 0.1) ?? v);
            next = setPivot(p.project, item.id, { x: settle(l.x / (f.w || 1)), y: settle(l.y / (f.d || 1)) });
          }
        } else {
          const delta = alongLine(ray.ray, h.origin, h.dir) - held.from;
          if (h.kind === 'face') next = extrude(p.project, held.id, h.face, delta, p.global);
          else {
            const d = snap(levelsOf(p.project), delta);
            next = placeAt(p.project, held.id, { x: Math.round((held.x + h.dir.x * d) * 1000) / 1000, y: Math.round((held.y + h.dir.z * d) * 1000) / 1000 });
          }
        }
        if (next) {
          previewRef.current = next;
          setPreview(next);
        }
        return;
      }
      const g = ground(e.clientX, e.clientY);
      p.onHover(g ? { x: g.x, y: g.z } : null);
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) down.moved = true;
      if (down.drag && down.moved && g) {
        const next = moveItems(p.project, down.drag.ids, g.x - down.drag.start.x, g.z - down.drag.start.z, p.global);
        previewRef.current = next;
        setPreview(next);
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = latest.current;
      if (held) {
        held = null;
        t.controls.enabled = true;
        if (previewRef.current) {
          p.onCommit(previewRef.current);
          previewRef.current = null;
          setPreview(null);
        }
        return;
      }
      if (!down) return;
      const was = down;
      down = null;
      t.controls.enabled = true;
      if (was.drag && was.moved && previewRef.current) {
        p.onCommit(previewRef.current);
        previewRef.current = null;
        setPreview(null);
        return;
      }
      if (was.moved) return;
      const id = pick(e.clientX, e.clientY);
      if (!id) {
        if (!e.shiftKey) p.onSelect([]);
        return;
      }
      const group = withGroups(p.project, [id]);
      if (e.shiftKey || e.metaKey || e.ctrlKey) p.onSelect(p.selection.includes(id) ? p.selection.filter((x) => !group.includes(x)) : [...p.selection, ...group]);
      else p.onSelect(group);
    };
    const onLeave = () => latest.current.onHover(null);
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  if (failed) {
    return (
      <div className="lvl-3d lvl-3d-off" role="status">
        <p>The 3D graybox needs WebGL, which this browser has switched off.</p>
        <p className="muted">Everything is still editable on the 2D map and in the inspector.</p>
      </div>
    );
  }
  return <div ref={host} className={`lvl-3d${props.placing ? ' is-drawing' : ''}`} aria-label="3D graybox" role="application" />;
});
Graybox.displayName = 'Graybox';

export default Graybox;
