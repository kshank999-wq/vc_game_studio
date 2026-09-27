import * as THREE from 'three';
import { assetOf, corners, frameOf, outlineOf, toPlan, type Mesh } from '../../model/level/geometry';
import { pivotPoint, type Face } from '../../model/level/level';
import type { NavCell } from '../../model/level/nav';
import type { AssetDefinition, LevelItem, LevelSet } from '../../model/level/types';
import { slabGeometry, UNIT } from './three-pieces';

/**
 * The graybox's editing handles (spec §5.1) and its overlays: move arrows
 * along the world's or the item's axes, a handle on each face to push or
 * pull it (a wall of an outline, the top), the pivot, what the player
 * collides with, and where they can walk.
 */

export type Tool3d = 'move' | 'size' | 'pivot';
export type Axes = 'world' | 'local';

/** What a handle does when dragged: along `dir` (in 3D, from `origin`), or across the floor for the pivot. */
export type Handle =
  | { kind: 'move'; origin: THREE.Vector3; dir: THREE.Vector3 }
  | { kind: 'face'; face: Face; origin: THREE.Vector3; dir: THREE.Vector3 }
  | { kind: 'pivot'; height: number };

const GOLD = new THREE.MeshBasicMaterial({ color: '#e8c872', depthTest: false, transparent: true });
const AXIS_X = new THREE.MeshBasicMaterial({ color: '#e5484d', depthTest: false, transparent: true });
const AXIS_Z = new THREE.MeshBasicMaterial({ color: '#4a86d8', depthTest: false, transparent: true });
const CUBE = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(0.5, 1.4, 16);
const BALL = new THREE.SphereGeometry(0.5, 16, 12);

const lineTo = (a: THREE.Vector3, b: THREE.Vector3, material: THREE.Material) => {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(g, material);
  l.renderOrder = 10;
  l.userData.owned = g;
  return l;
};

const LINE = new THREE.LineBasicMaterial({ color: '#e8c872', depthTest: false, transparent: true, opacity: 0.8 });

/** Handles for one selected item, in `group`, each tagged with what it does. */
export const buildHandles = (group: THREE.Group, set: LevelSet, item: LevelItem, tool: Tool3d, axes: Axes, floorElevation: number, global?: readonly AssetDefinition[]) => {
  const f = frameOf(set, item, global);
  const def = assetOf(set, item, global);
  const base = floorElevation + f.z;
  const s = Math.max(0.22, Math.min(0.55, Math.max(f.w, f.d, f.h) * 0.06));
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, at: THREE.Vector3, handle: Handle, scale = s, turn?: THREE.Euler) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.copy(at);
    m.scale.setScalar(scale);
    if (turn) m.rotation.copy(turn);
    m.renderOrder = 11;
    m.userData.handle = handle;
    group.add(m);
  };
  const centre = new THREE.Vector3(f.x, base + f.h / 2, f.y);

  if (tool === 'move') {
    const turn = axes === 'local' ? f.rotation : 0;
    for (const [lx, ly, material] of [[1, 0, AXIS_X], [0, 1, AXIS_Z]] as const) {
      const d = toPlan({ x: 0, y: 0, z: 0, rotation: turn, w: 0, d: 0, h: 0 }, lx, ly);
      const dir = new THREE.Vector3(d.x, 0, d.y).normalize();
      const reach = Math.max(f.w, f.d) / 2 + s * 3;
      const origin = new THREE.Vector3(f.x, base + 0.05, f.y);
      for (const sign of [1, -1]) {
        const tip = origin.clone().addScaledVector(dir, sign * reach);
        group.add(lineTo(origin, tip, LINE));
        // A cone points along +y; turn it to point along the axis.
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().multiplyScalar(sign));
        add(CONE, material, tip, { kind: 'move', origin, dir }, s, new THREE.Euler().setFromQuaternion(q));
      }
    }
    return;
  }

  if (tool === 'pivot') {
    const p = pivotPoint(set, item, global);
    add(BALL, GOLD, new THREE.Vector3(p.x, base + 0.05, p.y), { kind: 'pivot', height: base }, s * 1.2);
    group.add(lineTo(new THREE.Vector3(p.x, base, p.y), new THREE.Vector3(p.x, base + f.h + s, p.y), LINE));
    return;
  }

  // Size: a handle on each face; an outline's are on its walls.
  if (def.kind === 'marker' || def.kind === 'assembly') return;
  const top = new THREE.Vector3(f.x, base + f.h, f.y);
  add(CUBE, GOLD, top, { kind: 'face', face: 'top', origin: top.clone(), dir: new THREE.Vector3(0, 1, 0) });
  if (outlineOf(set, item, global)) {
    const c = corners(f);
    c.forEach((a, i) => {
      const b = c[(i + 1) % c.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dir = new THREE.Vector3((b.y - a.y) / len, 0, -(b.x - a.x) / len);
      const at = new THREE.Vector3((a.x + b.x) / 2, centre.y, (a.y + b.y) / 2);
      add(CUBE, GOLD, at, { kind: 'face', face: { wall: i }, origin: at.clone(), dir });
    });
    return;
  }
  for (const [face, lx, ly] of [['e', 1, 0], ['w', -1, 0], ['s', 0, 1], ['n', 0, -1]] as const) {
    const p = toPlan(f, (lx * f.w) / 2, (ly * f.d) / 2);
    const d = toPlan({ ...f, x: 0, y: 0 }, lx, ly);
    const at = new THREE.Vector3(p.x, centre.y, p.y);
    add(CUBE, GOLD, at, { kind: 'face', face, origin: at.clone(), dir: new THREE.Vector3(d.x, 0, d.y).normalize() });
  }
};

/** How far along a line (from `origin`, along unit `dir`) a pointer ray comes closest to it. */
export const alongLine = (ray: THREE.Ray, origin: THREE.Vector3, dir: THREE.Vector3): number => {
  const w0 = origin.clone().sub(ray.origin);
  const b = dir.dot(ray.direction);
  const d = dir.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return 0;
  return (b * e - d) / denom;
};

const COLLISION = new THREE.LineBasicMaterial({ color: '#e5484d', transparent: true, opacity: 0.75, depthTest: false });
const BOX_EDGES = new THREE.EdgesGeometry(UNIT.box);

/** Everything the player collides with, as red outlines seen through walls. */
export const buildCollision = (group: THREE.Group, meshes: readonly Mesh[]) => {
  for (const m of meshes) {
    if (!m.collide) continue;
    const holder = new THREE.Group();
    holder.position.set(m.x, m.y, m.z);
    holder.rotation.y = m.rotY;
    if (m.shape === 'slab' && m.outline) {
      const g = slabGeometry(m);
      const edges = new THREE.EdgesGeometry(g);
      g.dispose();
      holder.add(new THREE.LineSegments(edges, COLLISION));
      holder.userData.owned = edges;
    } else {
      const l = new THREE.LineSegments(BOX_EDGES, COLLISION);
      l.scale.set(m.sx, m.sy, m.sz);
      holder.add(l);
    }
    holder.renderOrder = 9;
    group.add(holder);
  }
};

const TILE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const WALK = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, vertexColors: false });

/** Where the player can stand: green where they can walk to from the start, amber where they can't. */
export const buildWalkable = (group: THREE.Group, cells: readonly NavCell[], size: number) => {
  if (!cells.length) return;
  const mesh = new THREE.InstancedMesh(TILE, WALK, cells.length);
  const m = new THREE.Matrix4();
  const reached = new THREE.Color('#6fae5e');
  const cut = new THREE.Color('#e0a040');
  cells.forEach((c, i) => {
    m.makeScale(size * 0.86, 1, size * 0.86).setPosition(c.x, c.z + 0.03, c.y);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.reached ? reached : cut);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.owned = mesh;
  group.add(mesh);
};

/** Free what an overlay made for itself. */
export const clearGroup = (group: THREE.Group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const owned = o.userData.owned as { dispose?: () => void } | undefined;
      owned?.dispose?.();
    });
  }
};
