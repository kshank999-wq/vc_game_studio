import * as THREE from 'three';

/**
 * A plain stand-in person for Play Mode (the player, and characters that
 * appear): legs, hips, torso, arms and a head, about `height` tall, facing
 * −z. Feet at y 0. A placeholder until the game's own models replace it.
 */
export const mannequin = (color: string, height = 1.75): THREE.Group => {
  const k = height / 1.75;
  const skin = new THREE.MeshStandardMaterial({ color: '#d9b48f', roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.75 });
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x * k, y * k, z * k);
    mesh.castShadow = true;
    return mesh;
  };
  const limb = (radius: number, length: number) => new THREE.CapsuleGeometry(radius * k, length * k, 4, 10);
  const figure = new THREE.Group();
  figure.add(
    // Legs and hips.
    part(limb(0.075, 0.68), dark, -0.1, 0.44),
    part(limb(0.075, 0.68), dark, 0.1, 0.44),
    part(new THREE.BoxGeometry(0.34 * k, 0.16 * k, 0.2 * k), dark, 0, 0.88),
    // Torso and shoulders.
    part(new THREE.BoxGeometry(0.38 * k, 0.5 * k, 0.22 * k), cloth, 0, 1.2),
    // Arms, hanging.
    part(limb(0.06, 0.5), cloth, -0.25, 1.12),
    part(limb(0.06, 0.5), cloth, 0.25, 1.12),
    // Neck and head, with a nose so it is clear which way it faces.
    part(new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 0.08 * k, 10), skin, 0, 1.49),
    part(new THREE.SphereGeometry(0.12 * k, 18, 14), skin, 0, 1.62),
    part(new THREE.ConeGeometry(0.03 * k, 0.07 * k, 8).rotateX(-Math.PI / 2), skin, 0, 1.61, -0.14),
  );
  return figure;
};
