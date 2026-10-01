import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { createWorld } from '../level/hierarchy';
import { meshesFor } from '../level/geometry';
import { levelsOf, placeAsset, withSet } from '../level/level';
import { decodeMesh, encodeMesh, fitModel, fittedSize, guessUnits, MAX_KEPT, modelAsset, parseGlb, parseGltf, parseModel, parseObj } from '../level/models';
import { addReference, fitReference, guessReferenceKind, metresPerPixel, referenceDepth, referencesOf, removeReference, setMetresPerPixel, updateReference } from '../level/references';
import { sunkenVault } from '../sample';

const CUBE_OBJ = `# a 2 x 4 x 6 box, centred on 0 0 3
v -1 -2 0
v 1 -2 0
v 1 2 0
v -1 2 0
v -1 -2 6
v 1 -2 6
v 1 2 6
v -1 2 6
f 1 2 3 4
f 5/1 6/1 7/1 8/1
f -8 -7 -3
`;

/** A GLB holding one triangle, its node moved and scaled. */
const glb = (translation = [10, 0, 0], scale = [2, 2, 2]): ArrayBuffer => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation, scale }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const bin = new Uint8Array(positions.buffer);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, jsonBytes.length).set(jsonBytes);
  dv.setUint32(20 + jsonBytes.length, bin.length, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  new Uint8Array(out, 28 + jsonBytes.length, bin.length).set(bin);
  return out;
};

describe('importing proxy models (Level Designer spec V2 §10)', () => {
  it('reads an OBJ: faces fanned into triangles, negative indices, its bounds', () => {
    const m = parseObj(CUBE_OBJ);
    expect(m).toMatchObject({ format: 'obj', vertices: 8, triangles: 5, min: [-1, -2, 0], max: [1, 2, 6] });
    expect(m.positions.length).toBe(5 * 9);
    expect(() => parseObj('# nothing')).toThrow(/No vertices/);
  });

  it('reads a GLB and a glTF, with their nodes’ transforms', () => {
    const m = parseGlb(glb());
    expect(m).toMatchObject({ format: 'glb', vertices: 3, triangles: 1, min: [10, 0, 0], max: [12, 2, 0] });
    expect(parseModel('chair.GLB', glb()).format).toBe('glb');
    // Its buffer in another file: only its size, from the accessor's bounds, and why.
    const external = parseGltf({
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 300, type: 'VEC3', min: [-50, 0, -25], max: [50, 200, 25] }],
      bufferViews: [{ buffer: 0, byteLength: 3600 }],
      buffers: [{ uri: 'chair.bin', byteLength: 3600 }],
    });
    expect(external).toMatchObject({ triangles: 100, min: [-50, 0, -25], max: [50, 200, 25] });
    expect(external.positions.length).toBe(0);
    expect(external.note).toMatch(/separate files/);
    expect(() => parseModel('chair.fbx', new ArrayBuffer(4))).toThrow(/\.obj, \.gltf or \.glb/);
  });

  it('guesses the units from the size, converts to metres, and turns Z up to Y up', () => {
    const m = parseObj(CUBE_OBJ);
    expect(guessUnits(m)).toBe('m');
    expect(guessUnits({ ...m, max: [90, 180, 60] })).toBe('m');
    expect(guessUnits({ ...m, max: [90, 1800, 60] })).toBe('cm');
    expect(guessUnits({ ...m, max: [900, 18000, 600] })).toBe('mm');
    // Made in metres with Y up: 2 wide, 4 tall, 6 deep.
    expect(fittedSize(m, { units: 'm' })).toEqual({ w: 2, h: 4, d: 6 });
    // Z up: 6 tall, 4 deep.
    expect(fittedSize(m, { units: 'm', upAxis: 'z' })).toEqual({ w: 2, h: 6, d: 4 });
    // Centimetres, scaled twice: 4 cm wide.
    expect(fittedSize(m, { units: 'cm', scale: 2 })).toEqual({ w: 0.04, h: 0.08, d: 0.12 });
    expect(fittedSize(m, { units: 'ft' }).w).toBeCloseTo(0.61, 2);
  });

  it('keeps its shape in a unit box, packed, and where its origin is', () => {
    const m = parseObj(CUBE_OBJ);
    const fit = fitModel(m, { units: 'm', upAxis: 'z' });
    expect(fit.kept).toBe(5);
    expect(Math.max(...fit.unit)).toBeLessThanOrEqual(0.5);
    expect(Math.min(...fit.unit)).toBeGreaterThanOrEqual(-0.5);
    // The file's 0, 0, 0 is the base's centre here.
    expect(fit.origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(fitModel(m, { units: 'm' }).origin).toEqual({ x: 0, y: 2, z: -3 });
    const back = decodeMesh(encodeMesh(fit.unit));
    expect(back.length).toBe(fit.unit.length);
    back.forEach((v, i) => expect(v).toBeCloseTo(fit.unit[i]!, 3));
    // A big model keeps every so many of its triangles.
    const many = { ...m, positions: new Float32Array(9 * (MAX_KEPT * 3)), triangles: MAX_KEPT * 3 };
    expect(fitModel(many, { units: 'm' }).kept).toBe(MAX_KEPT);
  });

  it('makes a personal asset its size, a model proxy, that the graybox draws and the engines get as a box', () => {
    const asset = modelAsset(parseObj(CUBE_OBJ), { file: 'crate.obj', name: 'Crate', units: 'cm', upAxis: 'z', tags: ['kit', ' '], collision: 'none' });
    expect(asset).toMatchObject({ name: 'Crate', source: 'global', proxy: 'model', kind: 'solid', category: 'props', size: { w: 0.02, h: 0.06, d: 0.04 }, tags: ['kit'] });
    expect(asset.id).toMatch(/^global\.model\./);
    expect(asset.model).toMatchObject({ file: 'crate.obj', format: 'obj', units: 'cm', upAxis: 'z', pivot: 'base', triangles: 5, kept: 5 });
    expect(asset.params.find((p) => p.key === 'collision')?.default).toBe('none');

    const p0 = sunkenVault();
    const set0 = levelsOf(p0);
    const level = set0.levels[0]!;
    const p1 = withSet(p0, { ...set0, assets: [...set0.assets, asset] });
    const placed = placeAsset(p1, level.id, level.floors[0]!.id, asset.id, { x: 0, y: 0 });
    const id = placed.ids[0]!;
    const set = levelsOf(placed.project);
    const drawn = meshesFor(set, level.id, { models: true }).find((m) => m.itemId === id)!;
    expect(drawn).toMatchObject({ shape: 'model', sx: 0.02, sy: 0.06, sz: 0.04, collide: false });
    expect(drawn.model?.key).toBe(`${asset.id}@1`);
    expect(meshesFor(set, level.id).find((m) => m.itemId === id)).toMatchObject({ shape: 'box' });
    // The engines: a box this size.
    const piece = buildIR(placed.project).levels.flatMap((l) => l.items).find((i) => i.guid === id)?.pieces[0];
    expect(piece).toMatchObject({ shape: 'box' });
  });
});

describe('reference images (Level Designer spec V2 §10)', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';

  it('lays a picture under a map, fitted to its extent, or 50 m', () => {
    const w = createWorld(sunkenVault(), { preset: 'small', name: 'Coast' });
    const r = addReference(w.project, w.id, { name: 'old-map', image, pixels: { w: 2000, h: 1000 } });
    const ref = levelsOf(r.project).levels.find((l) => l.id === w.id)!.references![0]!;
    // 10 km square; a 2:1 picture is as wide as it.
    expect(ref).toMatchObject({ name: 'old-map', kind: 'map', width: 10_000, x: -0, y: -0, opacity: 0.6, rotation: 0 });
    expect(referenceDepth(ref)).toBe(5_000);
    expect(metresPerPixel(ref)).toBe(5);

    const p0 = sunkenVault();
    const lid = levelsOf(p0).levels[0]!.id;
    const plain = addReference(p0, lid, { name: 'Ground floor plan', image, pixels: { w: 800, h: 600 } });
    expect(levelsOf(plain.project).levels[0]!.references![0]).toMatchObject({ kind: 'floorPlan', width: 50 });
    expect(addReference(p0, 'nope', { name: 'x', image, pixels: { w: 1, h: 1 } }).id).toBe('');
  });

  it('sizes by metres per pixel, moves, fades, fits again and goes', () => {
    const p0 = sunkenVault();
    const level = levelsOf(p0).levels[0]!;
    let { project, id } = addReference(p0, level.id, { name: 'heightmap_01', image, pixels: { w: 512, h: 512 }, floorId: level.floors[0]!.id });
    const get = () => levelsOf(project).levels[0]!.references!.find((r) => r.id === id)!;
    expect(get().kind).toBe('heightmap');
    project = setMetresPerPixel(project, level.id, id, 0.5);
    expect(get().width).toBe(256);
    project = updateReference(project, level.id, id, { x: 12, y: -4, rotation: 90, opacity: 2, locked: true });
    expect(get()).toMatchObject({ x: 12, y: -4, rotation: 90, opacity: 1, locked: true });
    project = updateReference(project, level.id, id, { locked: undefined, opacity: 0 });
    expect(get().locked).toBeUndefined();
    expect(get().opacity).toBe(0.05);
    // On its floor only.
    expect(referencesOf(levelsOf(project), level.id, level.floors[0]!.id)).toHaveLength(1);
    expect(referencesOf(levelsOf(project), level.id, 'another-floor')).toHaveLength(0);
    // A map without an extent: fitting does nothing.
    expect(fitReference(project, level.id, id)).toBe(project);
    project = removeReference(project, level.id, id);
    expect(levelsOf(project).levels[0]!.references).toBeUndefined();
  });

  it('guesses what a picture is from its name, and never sends it to the engines', () => {
    expect(['dem_tile', 'Floor 2 blueprint', 'IMG_0042', 'kingdom'].map(guessReferenceKind)).toEqual(['heightmap', 'floorPlan', 'photo', 'map']);
    const p0 = sunkenVault();
    const lid = levelsOf(p0).levels[0]!.id;
    const withRef = addReference(p0, lid, { name: 'plan', image, pixels: { w: 10, h: 10 } }).project;
    expect(JSON.stringify(buildIR(withRef))).not.toContain('iVBORw0KGgo');
  });
});
