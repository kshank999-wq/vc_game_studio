import { guid } from './level';
import { modelParams } from './library';
import type { AssetCategory, AssetDefinition, ModelInfo, ModelUnits } from './types';

/**
 * Personal proxy models (spec V2 §10): OBJ, glTF and GLB files read in the
 * browser, converted to metres, and kept as a light copy of their shape (up to
 * MAX_KEPT triangles) to draw in the graybox. The engines get the asset's box
 * and the file's name; the real model goes in there.
 */

export const MODEL_UNITS: readonly { id: ModelUnits; label: string; metres: number }[] = [
  { id: 'm', label: 'metres', metres: 1 },
  { id: 'cm', label: 'centimetres', metres: 0.01 },
  { id: 'mm', label: 'millimetres', metres: 0.001 },
  { id: 'in', label: 'inches', metres: 0.0254 },
  { id: 'ft', label: 'feet', metres: 0.3048 },
];

export const metresIn = (u: ModelUnits): number => MODEL_UNITS.find((x) => x.id === u)?.metres ?? 1;

/** The most triangles the studio keeps of a model. */
export const MAX_KEPT = 4000;

/** What a file holds, in its own units and axes. */
export interface ParsedModel {
  format: ModelInfo['format'];
  /** Every triangle's three corners, x y z in turn. Empty when only the bounds could be read. */
  positions: Float32Array;
  vertices: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Why the shape couldn't be read, when only its bounds were. */
  note?: string;
}

const boundsOfPositions = (p: Float32Array): { min: [number, number, number]; max: [number, number, number] } => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return min[0] === Infinity ? { min: [0, 0, 0], max: [0, 0, 0] } : { min, max };
};

// ---------------------------------------------------------------- OBJ

/** Wavefront OBJ: its vertices and faces (fans for faces of more than three corners). */
export const parseObj = (text: string): ParsedModel => {
  const verts: number[] = [];
  const out: number[] = [];
  let triangles = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    } else if (line.startsWith('f ')) {
      const count = verts.length / 3;
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((t) => {
          const n = parseInt(t.split('/')[0]!, 10);
          return n < 0 ? count + n : n - 1;
        })
        .filter((n) => Number.isInteger(n) && n >= 0 && n < count);
      for (let i = 1; i + 1 < idx.length; i++) {
        for (const v of [idx[0]!, idx[i]!, idx[i + 1]!]) out.push(verts[v * 3]!, verts[v * 3 + 1]!, verts[v * 3 + 2]!);
        triangles++;
      }
    }
  }
  if (!verts.length) throw new Error('No vertices in this OBJ file.');
  const positions = new Float32Array(out);
  // A point cloud without faces still has a size.
  const b = boundsOfPositions(positions.length ? positions : new Float32Array(verts));
  return { format: 'obj', positions, vertices: verts.length / 3, triangles, ...b };
};

// ---------------------------------------------------------------- glTF / GLB

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
};
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): Mat4 => {
  const [x, y, z, w] = q as [number, number, number, number];
  const [sx, sy, sz] = s as [number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
};
const apply = (m: Mat4, x: number, y: number, z: number): [number, number, number] => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
];

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
}

const COMPONENT: Record<number, { size: number; read: (v: DataView, at: number) => number }> = {
  5120: { size: 1, read: (v, at) => v.getInt8(at) },
  5121: { size: 1, read: (v, at) => v.getUint8(at) },
  5122: { size: 2, read: (v, at) => v.getInt16(at, true) },
  5123: { size: 2, read: (v, at) => v.getUint16(at, true) },
  5125: { size: 4, read: (v, at) => v.getUint32(at, true) },
  5126: { size: 4, read: (v, at) => v.getFloat32(at, true) },
};
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

const decodeDataUri = (uri: string): Uint8Array | null => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const bin = atob(m[1]!);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** glTF 2.0, from its JSON and (for a GLB) its binary chunk. Buffers in separate files can't be read here: only the bounds are. */
export const parseGltf = (json: Gltf, bin?: Uint8Array, format: 'gltf' | 'glb' = 'gltf'): ParsedModel => {
  const buffers = (json.buffers ?? []).map((b, i) => (b.uri ? decodeDataUri(b.uri) : i === 0 ? bin ?? null : null));
  const read = (index: number): number[][] | null => {
    const acc = json.accessors?.[index];
    if (!acc) return null;
    const width = WIDTH[acc.type] ?? 1;
    const comp = COMPONENT[acc.componentType];
    if (acc.bufferView === undefined || !comp) return null;
    const view = json.bufferViews?.[acc.bufferView];
    const buf = view && buffers[view.buffer];
    if (!view || !buf) return null;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const stride = view.byteStride || comp.size * width;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out: number[][] = [];
    for (let i = 0; i < acc.count; i++) {
      const row: number[] = [];
      for (let k = 0; k < width; k++) row.push(comp.read(dv, base + i * stride + k * comp.size));
      out.push(row);
    }
    return out;
  };
  const out: number[] = [];
  let vertices = 0;
  let triangles = 0;
  let missing = false;
  const boundsOnly: number[] = [];
  const visit = (n: number, parent: Mat4, depth: number) => {
    const node = json.nodes?.[n];
    if (!node || depth > 64) return;
    const local = node.matrix?.length === 16 ? node.matrix : trs(node.translation, node.rotation, node.scale);
    const m = mul(parent, local);
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : undefined;
    for (const prim of mesh?.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
      const pos = read(prim.attributes.POSITION);
      const acc = json.accessors?.[prim.attributes.POSITION];
      if (!pos) {
        // Its corners are elsewhere: the accessor's bounds still say how big it is.
        missing = true;
        if (acc?.min && acc.max) for (const x of [acc.min[0]!, acc.max[0]!]) for (const y of [acc.min[1]!, acc.max[1]!]) for (const z of [acc.min[2]!, acc.max[2]!]) boundsOnly.push(...apply(m, x, y, z));
        if (acc) triangles += Math.floor((prim.indices !== undefined ? json.accessors?.[prim.indices]?.count ?? 0 : acc.count) / 3);
        if (acc) vertices += acc.count;
        continue;
      }
      vertices += pos.length;
      const world = pos.map((p) => apply(m, p[0]!, p[1]!, p[2]!));
      const idx = prim.indices !== undefined ? read(prim.indices)?.map((r) => r[0]!) : world.map((_, i) => i);
      if (!idx) {
        missing = true;
        continue;
      }
      for (let i = 0; i + 2 < idx.length; i += 3) {
        for (const v of [idx[i]!, idx[i + 1]!, idx[i + 2]!]) {
          const p = world[v];
          if (p) out.push(p[0], p[1], p[2]);
          else out.push(0, 0, 0);
        }
        triangles++;
      }
    }
    for (const c of node.children ?? []) visit(c, m, depth + 1);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i).filter((i) => !(json.nodes ?? []).some((n) => n.children?.includes(i)));
  for (const r of roots) visit(r, IDENTITY, 0);
  if (!roots.length) {
    // Meshes without nodes: take them as they are.
    json.nodes = (json.meshes ?? []).map((_, i) => ({ mesh: i }));
    json.nodes.forEach((_, i) => visit(i, IDENTITY, 0));
  }
  const positions = new Float32Array(out);
  if (!positions.length && !boundsOnly.length) throw new Error('No triangles in this glTF file.');
  const b = boundsOfPositions(new Float32Array([...out, ...boundsOnly]));
  return {
    format,
    positions,
    vertices,
    triangles,
    ...b,
    ...(missing ? { note: 'Its buffers are in separate files, so only its size could be read: save it as .glb (or glTF with embedded buffers) to see its shape.' } : {}),
  };
};

export const parseGlb = (data: ArrayBuffer): ParsedModel => {
  const dv = new DataView(data);
  if (data.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file.');
  let json: Gltf | null = null;
  let bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= data.byteLength; ) {
    const len = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const body = new Uint8Array(data, at + 8, Math.min(len, data.byteLength - at - 8));
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as Gltf;
    else if (type === 0x004e4942) bin = body;
    at += 8 + len;
  }
  if (!json) throw new Error('This GLB file has no glTF data.');
  return parseGltf(json, bin, 'glb');
};

/** Read a model file by its extension. */
export const parseModel = (file: string, data: ArrayBuffer): ParsedModel => {
  const ext = file.toLowerCase().split('.').pop();
  if (ext === 'obj') return parseObj(new TextDecoder().decode(data));
  if (ext === 'glb') return parseGlb(data);
  if (ext === 'gltf') return parseGltf(JSON.parse(new TextDecoder().decode(data)) as Gltf, undefined, 'gltf');
  throw new Error('Choose an .obj, .gltf or .glb file.');
};

// ---------------------------------------------------------------- units and fitting

/**
 * The units a file was probably made in, from how big it is (spec V2 §10):
 * a model thousands across was made in millimetres, hundreds in centimetres.
 * A guess for the import to start from; the designer can change it.
 */
export const guessUnits = (m: ParsedModel): ModelUnits => {
  const extent = Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);
  if (extent > 5000) return 'mm';
  if (extent > 200) return 'cm';
  return 'm';
};

export interface FitOptions {
  units: ModelUnits;
  scale?: number;
  upAxis?: 'y' | 'z';
}

/** A file's corners in the studio's axes (x east, y up, z south), in metres. */
const toStudio = (x: number, y: number, z: number, k: number, up: 'y' | 'z'): [number, number, number] => (up === 'z' ? [x * k, z * k, -y * k] : [x * k, y * k, z * k]);

/** How big it comes out, in metres, with these units and axes. */
export const fittedSize = (m: ParsedModel, o: FitOptions): { w: number; d: number; h: number } => {
  const k = metresIn(o.units) * (o.scale ?? 1);
  const a = toStudio(m.min[0], m.min[1], m.min[2], k, o.upAxis ?? 'y');
  const b = toStudio(m.max[0], m.max[1], m.max[2], k, o.upAxis ?? 'y');
  const r = (v: number) => Math.max(0.01, Math.round(Math.abs(v) * 1000) / 1000);
  return { w: r(b[0] - a[0]), h: r(b[1] - a[1]), d: r(b[2] - a[2]) };
};

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Pack corners fitted to a unit box (−0.5 to 0.5 on each axis) as 16-bit integers. */
export const encodeMesh = (unit: Float32Array): string => {
  const q = new Int16Array(unit.length);
  for (let i = 0; i < unit.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(unit[i]! * 2 * 32767)));
  return toBase64(new Uint8Array(q.buffer));
};

/** The kept corners back, in the unit box. */
export const decodeMesh = (mesh: string): Float32Array => {
  if (!mesh) return new Float32Array(0);
  const bin = atob(mesh);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i]! / 32767 / 2;
  return out;
};

/**
 * The model in the studio: its size in metres, its triangles (at most
 * MAX_KEPT, every so many when there are more) fitted to a unit box, and
 * where its file's origin is from the base's centre.
 */
export const fitModel = (m: ParsedModel, o: FitOptions): { size: { w: number; d: number; h: number }; unit: Float32Array; origin: { x: number; y: number; z: number }; kept: number } => {
  const k = metresIn(o.units) * (o.scale ?? 1);
  const up = o.upAxis ?? 'y';
  const total = m.positions.length / 9;
  const step = total > MAX_KEPT ? total / MAX_KEPT : 1;
  const kept = Math.min(total, MAX_KEPT);
  const pts = new Float32Array(kept * 9);
  for (let t = 0; t < kept; t++) {
    const src = Math.floor(t * step) * 9;
    for (let c = 0; c < 3; c++) {
      const [x, y, z] = toStudio(m.positions[src + c * 3]!, m.positions[src + c * 3 + 1]!, m.positions[src + c * 3 + 2]!, k, up);
      pts.set([x, y, z], t * 9 + c * 3);
    }
  }
  // The bounds are the whole model's, not just what was kept.
  const corners = [toStudio(m.min[0], m.min[1], m.min[2], k, up), toStudio(m.max[0], m.max[1], m.max[2], k, up)];
  const lo = [0, 1, 2].map((i) => Math.min(corners[0]![i]!, corners[1]![i]!));
  const hi = [0, 1, 2].map((i) => Math.max(corners[0]![i]!, corners[1]![i]!));
  const span = [0, 1, 2].map((i) => Math.max(1e-6, hi[i]! - lo[i]!));
  const mid = [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2);
  const unit = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i++) unit[i] = Math.max(-0.5, Math.min(0.5, (pts[i]! - mid[i % 3]!) / span[i % 3]!));
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return { size: fittedSize(m, o), unit, origin: { x: r(-mid[0]!), y: r(-lo[1]!), z: r(-mid[2]!) }, kept };
};

export interface ModelImport extends FitOptions {
  file: string;
  name: string;
  category?: AssetCategory;
  tags?: string[];
  pivot?: ModelInfo['pivot'];
  collision?: 'static' | 'dynamic' | 'trigger' | 'none';
  thumbnail?: string;
  plan?: string;
}

/** A personal asset from a model (spec V2 §10): its box the model's size, its shape kept to draw. */
export const modelAsset = (m: ParsedModel, o: ModelImport): AssetDefinition => {
  const fit = fitModel(m, o);
  const model: ModelInfo = {
    file: o.file,
    format: m.format,
    units: o.units,
    scale: o.scale ?? 1,
    upAxis: o.upAxis ?? 'y',
    pivot: o.pivot ?? 'base',
    origin: fit.origin,
    vertices: m.vertices,
    triangles: m.triangles,
    kept: fit.kept,
    mesh: fit.kept ? encodeMesh(fit.unit) : '',
    ...(o.thumbnail ? { thumbnail: o.thumbnail } : {}),
    ...(o.plan ? { plan: o.plan } : {}),
  };
  const tags = (o.tags ?? []).map((t) => t.trim()).filter(Boolean);
  return {
    id: `global.model.${guid()}`,
    name: o.name.trim() || o.file.replace(/\.[^.]+$/, ''),
    category: o.category ?? 'props',
    kind: 'solid',
    role: 'prop',
    naming: 'prop',
    size: fit.size,
    proxy: 'model',
    params: modelParams(o.collision ?? 'static'),
    engine: {
      godot: `MeshInstance3D proxy box + StaticBody3D (put ${o.file} in Final asset)`,
      unity: `GameObject + BoxCollider (put ${o.file} in Final asset)`,
      unreal: `StaticMeshActor proxy box (put ${o.file} in Final asset)`,
    },
    description: `Imported from ${o.file}: ${m.triangles.toLocaleString('en')} triangles, made in ${MODEL_UNITS.find((u) => u.id === o.units)?.label ?? o.units}.`,
    source: 'global',
    version: 1,
    model,
    ...(tags.length ? { tags } : {}),
  };
};
