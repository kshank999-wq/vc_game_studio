import * as THREE from 'three';
import type { Mesh } from '../../model/level/geometry';

/**
 * The graybox's pieces in three.js, shared by the editor's 3D view and Play
 * Mode: unit shapes scaled to size, one material per colour, and outlines.
 */

// Shared unit geometry: every piece is one of these, scaled.
export const UNIT = {
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
export const materialFor = (color: string, opacity: number, emissive = false): THREE.Material => {
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

export const buildPiece = (m: Mesh, selected: boolean): THREE.Object3D => {
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

