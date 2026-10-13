import * as THREE from 'three';
import type { Placeholder } from '../../model/character/profile';
import { mannequin } from './mannequin';

/**
 * A character's placeholder in 3D (Character Creator spec §8): the stand-in
 * figure in its tint, proportioned by its silhouette (stocky, slender, small,
 * four-legged, winged), at its height, with its primitive prop at the right
 * hand (sword, shield, bow, staff). Feet at y 0, facing −z, like the
 * mannequin; final art replaces it later without moving the collider or the
 * hand socket.
 */
export const placeholderFigure = (ph: Placeholder, height = 1.75): THREE.Group => {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: ph.tint, roughness: 0.65 });
  if (ph.silhouette === 'beast') {
    const k = height / 1.1;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * k, 0.6 * k, 4, 10).rotateX(Math.PI / 2), cloth);
    body.position.set(0, 0.62 * k, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17 * k, 14, 10), cloth);
    head.position.set(0, 0.82 * k, -0.52 * k);
    g.add(body, head);
    for (const [x, z] of [[-0.14, -0.3], [0.14, -0.3], [-0.14, 0.3], [0.14, 0.3]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 0.45 * k, 8), cloth);
      leg.position.set(x * k, 0.22 * k, z * k);
      g.add(leg);
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
  }
  const figure = mannequin(ph.tint, height * (ph.silhouette === 'small' ? 0.75 : 1));
  const wide = ph.silhouette === 'stocky' ? 1.3 : ph.silhouette === 'slender' ? 0.82 : 1;
  figure.scale.x = wide;
  figure.scale.z = wide;
  g.add(figure);
  if (ph.silhouette === 'flyer') {
    const wing = new THREE.MeshStandardMaterial({ color: ph.tint, roughness: 0.8, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), wing);
      w.position.set(side * 0.55, height * 0.72, 0.12);
      w.rotation.y = side * 0.4;
      g.add(w);
    }
  }
  // The right hand socket, about where the mannequin's right hand hangs.
  const k = (height * (ph.silhouette === 'small' ? 0.75 : 1)) / 1.75;
  const hand = new THREE.Vector3(0.27 * wide * k, 0.86 * k, -0.04);
  const metal = new THREE.MeshStandardMaterial({ color: '#d8dde3', roughness: 0.3, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 0.8 });
  const prop = new THREE.Group();
  if (ph.prop === 'sword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.015), metal);
    blade.position.set(0, 0.5, 0);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), wood);
    guard.position.set(0, 0.08, 0);
    prop.add(blade, guard);
    prop.rotation.x = -0.35;
  } else if (ph.prop === 'shield') {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20).rotateZ(Math.PI / 2), wood);
    s.position.set(0.04, 0.1, 0);
    prop.add(s);
  } else if (ph.prop === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.015, 6, 20, Math.PI), wood);
    bow.rotation.z = Math.PI / 2;
    bow.position.set(0, 0.1, 0);
    prop.add(bow);
  } else if (ph.prop === 'staff') {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 8), wood);
    staff.position.set(0, 0.35, 0);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: '#9fd0ff', emissive: '#3a6a9a' }));
    orb.position.set(0, 1.17, 0);
    prop.add(staff, orb);
  }
  if (prop.children.length) {
    prop.position.copy(hand);
    prop.name = 'hand-socket';
    g.add(prop);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
};
