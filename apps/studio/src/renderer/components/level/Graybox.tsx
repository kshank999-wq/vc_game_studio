import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { meshesFor, type Mesh, type Point } from '../../model/level/geometry';
import { levelsOf, moveItems, withGroups } from '../../model/level/level';
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
}

// Shared unit geometry: every piece is one of these, scaled.
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  cone: new THREE.ConeGeometry(0.5, 1, 16).rotateX(-Math.PI / 2),
  wedge: (() => {
    // Rises to the north (-z): low at the south edge, full height at the north.
    const g = new THREE.BufferGeometry();
    const v = [
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
    ];
    const tri = [
      [0, 2, 1], [0, 3, 2], // bottom
      [3, 4, 5], [3, 5, 2], // north face
      [0, 1, 5], [0, 5, 4], // slope
      [0, 4, 3], // west
      [1, 2, 5], // east
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat().flatMap((i) => v[i]!), 3));
    g.computeVertexNormals();
    return g;
  })(),
};
const EDGES = { box: new THREE.EdgesGeometry(UNIT.box), wedge: new THREE.EdgesGeometry(UNIT.wedge) };

const materials = new Map<string, THREE.Material>();
const materialFor = (color: string, opacity: number, emissive = false): THREE.Material => {
  const key = `${color}:${opacity}:${emissive}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.92,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 0.5,
      side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
      ...(emissive ? { emissive: color, emissiveIntensity: 0.9 } : {}),
    });
    materials.set(key, m);
  }
  return m;
};
const EDGE_DIM = new THREE.LineBasicMaterial({ color: '#0b0a07', transparent: true, opacity: 0.45 });
const EDGE_ON = new THREE.LineBasicMaterial({ color: '#e8c872' });

const buildPiece = (m: Mesh, selected: boolean): THREE.Object3D => {
  const holder = new THREE.Group();
  holder.position.set(m.x, m.y, m.z);
  holder.rotation.y = m.rotY;
  const geometry = UNIT[m.shape];
  const mesh = new THREE.Mesh(geometry, materialFor(m.color, m.opacity, m.part === 'light'));
  mesh.scale.set(m.sx, m.sy, m.sz);
  mesh.castShadow = m.opacity >= 1 && m.part !== 'light';
  mesh.receiveShadow = m.part === 'floor' || m.part === 'wall';
  mesh.userData = { itemId: m.itemId };
  holder.add(mesh);
  const edges = m.shape === 'box' ? EDGES.box : m.shape === 'wedge' ? EDGES.wedge : null;
  if (edges && (selected || m.part !== 'floor')) {
    const line = new THREE.LineSegments(edges, selected ? EDGE_ON : EDGE_DIM);
    line.scale.copy(mesh.scale);
    line.raycast = () => {};
    holder.add(line);
  } else if (selected) {
    const box = new THREE.LineSegments(EDGES.box, EDGE_ON);
    box.scale.copy(mesh.scale);
    box.raycast = () => {};
    holder.add(box);
  }
  return holder;
};

export const Graybox = forwardRef<GrayboxApi, Props>((props, ref) => {
  const { project, levelId, floorId, global } = props;
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; content: THREE.Group; grid: THREE.GridHelper; render: () => void } | null>(null);
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
    three.current = { renderer, scene, camera, controls, content, grid, render };
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
      child.traverse((o) => {
        if (o instanceof THREE.Light) o.dispose();
      });
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
  }));

  // ------------------------------------------------------------ pointer work

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const el = t.renderer.domElement;
    let down: { x: number; y: number; drag: { ids: string[]; start: THREE.Vector3 } | null; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      const p = latest.current;
      if (e.button !== 0) return;
      if (p.placing) {
        const g = ground(e.clientX, e.clientY);
        if (g) p.onPlace({ x: g.x, y: g.z });
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
