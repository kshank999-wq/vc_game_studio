import type { Project } from '../types';
import { assetOf, frameOf, pointInPolygon, polygonArea, selfIntersects, type Point } from './geometry';
import { levelsOf, placeAsset, setOutline, withSet } from './level';
import type { AssetDefinition, LevelItem } from './types';

/**
 * Imported CAD plans (structure spec V2): a floor plan drawn elsewhere, as
 * DXF (AutoCAD, BricsCAD, LibreCAD, Revit's export) or SVG (Illustrator,
 * Inkscape, any vector tool), read into a structure's floor. Each layer has a
 * role: closed shapes on a room layer become rooms (named by the text inside
 * them), the outline becomes the floor's footprint, door swings and door
 * blocks become doors in the nearest wall, and stairs become stairs. Nothing
 * is read from the network; the file is parsed here.
 */

export type CadUnits = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type CadRole = 'ignore' | 'walls' | 'rooms' | 'doors' | 'stairs' | 'footprint' | 'labels';

export const CAD_ROLES: readonly { id: CadRole; label: string }[] = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'walls', label: 'Walls' },
  { id: 'doors', label: 'Doors' },
  { id: 'stairs', label: 'Stairs' },
  { id: 'footprint', label: 'Outline / footprint' },
  { id: 'labels', label: 'Room names' },
  { id: 'ignore', label: 'Leave out' },
];

export const UNIT_METRES: Record<CadUnits, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

/** A line or shape in the drawing's own units; y up for DXF, down for SVG (the importer turns it the plan's way). */
export interface CadShape {
  layer: string;
  points: Point[];
  closed: boolean;
  /** Set when it is a door's swing: the hinge, the radius and the two ends of the arc. */
  arc?: { c: Point; r: number; a: Point; b: Point };
  /** Set when it came from a block insert: all the shapes of one insert share it. */
  block?: { name: string; n: number };
}

export interface CadText {
  layer: string;
  at: Point;
  text: string;
}

export interface CadDrawing {
  format: 'dxf' | 'svg';
  /** The units the file says it is in, if it says. */
  units?: CadUnits;
  /** Whether y runs up the page (DXF) or down it (SVG). */
  yUp: boolean;
  shapes: CadShape[];
  texts: CadText[];
  layers: string[];
  /** What couldn't be read, said plainly. */
  notes: string[];
}

// ---------------------------------------------------------------- DXF

const INSUNITS: Record<number, CadUnits> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

const rad = (deg: number) => (deg * Math.PI) / 180;
const arcPoints = (c: Point, r: number, a0: number, a1: number): Point[] => {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(2, Math.ceil(sweep / 15));
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = rad(a0 + (sweep * k) / n);
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
};
/** A polyline segment with a bulge (DXF's arcs inside polylines), as points along the arc. */
const bulged = (p: Point, q: Point, bulge: number): Point[] => {
  if (!bulge) return [];
  const theta = 4 * Math.atan(bulge);
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (d < 1e-9) return [];
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const c = { x: mx - (h * (q.y - p.y)) / d, y: my + (h * (q.x - p.x)) / d };
  const a0 = Math.atan2(p.y - c.y, p.x - c.x);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / rad(15)));
  return Array.from({ length: n - 1 }, (_, k) => {
    const a = a0 + (theta * (k + 1)) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
};

const stripMtext = (s: string) =>
  s
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\[~ ]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[cdp]/gi, '')
    .trim();

interface DxfEntity {
  type: string;
  codes: [number, string][];
}

const dxfPairs = (text: string): [number, string][] => {
  const lines = text.split(/\r\n|\r|\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) {
      i -= 1;
      continue;
    }
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
};

/** Read a DXF (ASCII) drawing: lines, polylines, arcs, text and block inserts. */
export const parseDxf = (text: string): CadDrawing => {
  const pairs = dxfPairs(text);
  const notes: string[] = [];
  let units: CadUnits | undefined;
  const blocks = new Map<string, DxfEntity[]>();
  const entities: DxfEntity[] = [];
  let section = '';
  let current: DxfEntity | null = null;
  let block: { name: string; items: DxfEntity[] } | null = null;
  const flush = () => {
    if (!current) return;
    if (block && current.type !== 'BLOCK' && current.type !== 'ENDBLK') block.items.push(current);
    else if (section === 'ENTITIES') entities.push(current);
    current = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0) {
      flush();
      if (value === 'SECTION') {
        const name = pairs[i + 1];
        section = name && name[0] === 2 ? name[1] : '';
        i++;
        continue;
      }
      if (value === 'ENDSEC') {
        section = '';
        continue;
      }
      if (value === 'EOF') break;
      if (section === 'BLOCKS' && value === 'BLOCK') {
        let name = '';
        for (let k = i + 1; k < pairs.length && pairs[k]![0] !== 0; k++) if (pairs[k]![0] === 2) name = pairs[k]![1];
        block = { name, items: [] };
        blocks.set(name, block.items);
        current = { type: 'BLOCK', codes: [] };
        continue;
      }
      if (section === 'BLOCKS' && value === 'ENDBLK') {
        block = null;
        current = { type: 'ENDBLK', codes: [] };
        continue;
      }
      if (section === 'ENTITIES' || section === 'BLOCKS') current = { type: value, codes: [] };
      continue;
    }
    if (section === 'HEADER' && code === 9 && value === '$INSUNITS') {
      const next = pairs[i + 1];
      if (next) units = INSUNITS[Number(next[1])];
    }
    current?.codes.push([code, value]);
  }
  flush();

  const shapes: CadShape[] = [];
  const texts: CadText[] = [];
  const skipped = new Map<string, number>();
  let inserts = 0;
  type T = (p: Point) => Point;
  const ident: T = (p) => p;
  const num = (e: DxfEntity, code: number, fallback = 0) => {
    const f = e.codes.find((c) => c[0] === code);
    return f ? Number(f[1]) : fallback;
  };
  const str = (e: DxfEntity, code: number) => e.codes.find((c) => c[0] === code)?.[1] ?? '';
  const read = (list: DxfEntity[], t: T, scale: number, layerOf: (e: DxfEntity) => string, tag: CadShape['block'], depth: number) => {
    for (let k = 0; k < list.length; k++) {
      const e = list[k]!;
      const layer = layerOf(e);
      const add = (points: Point[], closed: boolean, arc?: CadShape['arc']) => {
        if (points.length >= 2) shapes.push({ layer, points: points.map(t), closed, ...(arc ? { arc } : {}), ...(tag ? { block: tag } : {}) });
      };
      switch (e.type) {
        case 'LINE':
          add([{ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }], false);
          break;
        case 'LWPOLYLINE': {
          const pts: Point[] = [];
          const bulges: number[] = [];
          for (const [c, v] of e.codes) {
            if (c === 10) {
              pts.push({ x: Number(v), y: 0 });
              bulges.push(0);
            } else if (c === 20 && pts.length) pts[pts.length - 1]!.y = Number(v);
            else if (c === 42 && pts.length) bulges[bulges.length - 1] = Number(v);
          }
          const closed = (num(e, 70) & 1) === 1;
          const out: Point[] = [];
          pts.forEach((p, n) => {
            out.push(p);
            const q = pts[n + 1] ?? (closed ? pts[0] : undefined);
            if (q) out.push(...bulged(p, q, bulges[n]!));
          });
          add(out, closed);
          break;
        }
        case 'POLYLINE': {
          const closed = (num(e, 70) & 1) === 1;
          const pts: Point[] = [];
          while (list[k + 1] && list[k + 1]!.type === 'VERTEX') {
            k++;
            pts.push({ x: num(list[k]!, 10), y: num(list[k]!, 20) });
          }
          if (list[k + 1]?.type === 'SEQEND') k++;
          add(pts, closed);
          break;
        }
        case 'ARC': {
          const c = { x: num(e, 10), y: num(e, 20) };
          const r = num(e, 40);
          const a0 = num(e, 50);
          const a1 = num(e, 51);
          const pts = arcPoints(c, r, a0, a1);
          add(pts, false, { c: t(c), r: r * scale, a: t(pts[0]!), b: t(pts[pts.length - 1]!) });
          break;
        }
        case 'CIRCLE':
          add(arcPoints({ x: num(e, 10), y: num(e, 20) }, num(e, 40), 0, 360).slice(0, -1), true);
          break;
        case 'TEXT':
        case 'MTEXT': {
          const raw = e.type === 'MTEXT' ? stripMtext(e.codes.filter((c) => c[0] === 3 || c[0] === 1).map((c) => c[1]).join('')) : str(e, 1).trim();
          if (raw) texts.push({ layer, at: t({ x: num(e, 10), y: num(e, 20) }), text: raw });
          break;
        }
        case 'INSERT': {
          const def = blocks.get(str(e, 2));
          if (!def || depth > 4) break;
          const at = { x: num(e, 10), y: num(e, 20) };
          const sx = num(e, 41, 1);
          const sy = num(e, 42, 1);
          const rot = rad(num(e, 50));
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const inner: T = (p) => t({ x: at.x + p.x * sx * cos - p.y * sy * sin, y: at.y + p.x * sx * sin + p.y * sy * cos });
          // Shapes in a block on layer 0 take the insert's layer.
          const parent = layer;
          read(def, inner, scale * Math.abs(sx), (b) => (str(b, 8) === '0' || !str(b, 8) ? parent : str(b, 8)), tag ?? { name: str(e, 2), n: inserts++ }, depth + 1);
          break;
        }
        case 'VERTEX':
        case 'SEQEND':
        case 'ATTRIB':
        case 'ATTDEF':
          break;
        default:
          skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
      }
    }
  };
  read(entities, ident, 1, (e) => str(e, 8) || '0', undefined, 0);
  if (skipped.size) notes.push(`Left out what a plan doesn't need: ${[...skipped].map(([t, n]) => `${n} ${t.toLowerCase()}`).join(', ')}.`);
  if (!shapes.length) notes.push('No lines or shapes found. Is it a DXF saved as text (ASCII), not binary?');
  return { format: 'dxf', ...(units ? { units } : {}), yUp: true, shapes, texts, layers: [...new Set([...shapes.map((s) => s.layer), ...texts.map((t) => t.layer)])].sort(), notes };
};

// ---------------------------------------------------------------- SVG

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m: M, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const numbers = (s: string) => (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

const transformOf = (s: string | undefined): M => {
  if (!s) return I;
  let m = I;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(args!);
    let t: M = I;
    if (fn === 'matrix' && a.length === 6) t = a as M;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = rad(a[0] ?? 0);
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const cx = a[1] ?? 0;
      const cy = a[2] ?? 0;
      t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(rad(a[0] ?? 0)), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(rad(a[0] ?? 0)), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
};

/** A path's outline: straight runs as they are, curves by their points along them. Each M starts a new shape. */
const pathShapes = (d: string): { points: Point[]; closed: boolean }[] => {
  const out: { points: Point[]; closed: boolean }[] = [];
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let k = 0;
  let cmd = '';
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let pts: Point[] = [];
  const end = (closed: boolean) => {
    if (pts.length >= 2) out.push({ points: pts, closed });
    pts = [];
  };
  const n = () => Number(tokens[k++]);
  const isNum = () => k < tokens.length && !/^[a-z]$/i.test(tokens[k]!);
  while (k < tokens.length) {
    if (/^[a-z]$/i.test(tokens[k]!)) cmd = tokens[k++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const to = (x: number, y: number) => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    if (C === 'Z') {
      end(true);
      cur = start;
      continue;
    }
    if (!isNum()) {
      k++;
      continue;
    }
    if (C === 'M') {
      end(false);
      cur = to(n(), n());
      start = cur;
      pts = [cur];
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L' || C === 'T') {
      cur = to(n(), n());
      pts.push(cur);
    } else if (C === 'H') {
      cur = { x: rel ? cur.x + n() : n(), y: cur.y };
      pts.push(cur);
    } else if (C === 'V') {
      cur = { x: cur.x, y: rel ? cur.y + n() : n() };
      pts.push(cur);
    } else if (C === 'C') {
      const a = to(n(), n());
      const b = to(n(), n());
      const e = to(n(), n());
      for (const t of [0.25, 0.5, 0.75]) pts.push({ x: (1 - t) ** 3 * cur.x + 3 * (1 - t) ** 2 * t * a.x + 3 * (1 - t) * t * t * b.x + t ** 3 * e.x, y: (1 - t) ** 3 * cur.y + 3 * (1 - t) ** 2 * t * a.y + 3 * (1 - t) * t * t * b.y + t ** 3 * e.y });
      cur = e;
      pts.push(cur);
    } else if (C === 'S' || C === 'Q') {
      const a = to(n(), n());
      const e = to(n(), n());
      pts.push({ x: (cur.x + 2 * a.x + e.x) / 4, y: (cur.y + 2 * a.y + e.y) / 4 });
      cur = e;
      pts.push(cur);
    } else if (C === 'A') {
      n();
      n();
      n();
      n();
      n();
      const e = to(n(), n());
      pts.push({ x: (cur.x + e.x) / 2, y: (cur.y + e.y) / 2 });
      cur = e;
      pts.push(cur);
    } else k++;
  }
  end(false);
  return out;
};

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [, k, v1, v2] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[k!] = (v1 ?? v2 ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return out;
};
const lengthUnits = (v: string | undefined): CadUnits | undefined => {
  const m = v?.match(/^\s*[\d.]+\s*(mm|cm|m|in|ft)\s*$/);
  return m ? (m[1] as CadUnits) : undefined;
};

/** Read an SVG drawing: rects, polygons, polylines, lines, paths and text, each on the layer (group) it is in. */
export const parseSvg = (text: string): CadDrawing => {
  const shapes: CadShape[] = [];
  const texts: CadText[] = [];
  const notes: string[] = [];
  const stack: { m: M; layer: string }[] = [{ m: I, layer: 'Drawing' }];
  let units: CadUnits | undefined;
  let skipDepth = 0;
  let pendingText: { at: Point; layer: string; parts: string[] } | null = null;
  const tags = text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>|([^<]+)/g);
  for (const t of tags) {
    const [, close, name, rest, selfClose, body] = t;
    if (body !== undefined) {
      if (pendingText && body.trim()) pendingText.parts.push(body.trim());
      continue;
    }
    const tag = name!.replace(/^svg:/, '');
    if (close) {
      if (skipDepth) {
        if (['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker'].includes(tag)) skipDepth--;
        continue;
      }
      if (tag === 'text' && pendingText) {
        const s = pendingText.parts.join(' ').replace(/&amp;/g, '&').trim();
        if (s) texts.push({ layer: pendingText.layer, at: pendingText.at, text: s });
        pendingText = null;
      }
      if ((tag === 'g' || tag === 'svg' || tag === 'a') && stack.length > 1) stack.pop();
      continue;
    }
    if (['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker'].includes(tag) && !selfClose) {
      skipDepth++;
      continue;
    }
    if (skipDepth) continue;
    const a = attrs(rest!);
    const top = stack[stack.length - 1]!;
    const m = mul(top.m, transformOf(a.transform));
    if (tag === 'svg') {
      units ??= lengthUnits(a.width);
      const vb = a.viewBox ? numbers(a.viewBox) : [];
      // Width "210mm" over a viewBox 0 0 210 297: one user unit is a millimetre. Otherwise the viewBox's own scale is folded in.
      let sm: M = I;
      const w = a.width ? numbers(a.width)[0] : undefined;
      if (vb.length === 4 && w && vb[2]) sm = [w / vb[2], 0, 0, w / vb[2], -vb[0]! * (w / vb[2]), -vb[1]! * (w / vb[2])];
      if (!selfClose) stack.push({ m: mul(m, sm), layer: top.layer });
      continue;
    }
    if (tag === 'g' || tag === 'a') {
      const label = a['inkscape:label'] ?? a['data-name'] ?? a.id;
      if (!selfClose) stack.push({ m, layer: a['inkscape:groupmode'] === 'layer' || label ? label ?? top.layer : top.layer });
      continue;
    }
    const layer = a.class && top.layer === 'Drawing' ? a.class.split(/\s+/)[0]! : top.layer;
    const add = (points: Point[], closed: boolean) => {
      if (points.length >= 2) shapes.push({ layer, points: points.map((p) => apply(m, p)), closed });
    };
    const f = (k: string) => Number(a[k] ?? 0) || 0;
    switch (tag) {
      case 'rect': {
        const x = f('x');
        const y = f('y');
        add([{ x, y }, { x: x + f('width'), y }, { x: x + f('width'), y: y + f('height') }, { x, y: y + f('height') }], true);
        break;
      }
      case 'polygon':
      case 'polyline': {
        const v = numbers(a.points ?? '');
        const pts: Point[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i]!, y: v[i + 1]! });
        add(pts, tag === 'polygon');
        break;
      }
      case 'line':
        add([{ x: f('x1'), y: f('y1') }, { x: f('x2'), y: f('y2') }], false);
        break;
      case 'path':
        for (const s of pathShapes(a.d ?? '')) add(s.points, s.closed);
        break;
      case 'circle':
      case 'ellipse': {
        const rx = f(tag === 'circle' ? 'r' : 'rx');
        const ry = tag === 'circle' ? rx : f('ry');
        add(Array.from({ length: 24 }, (_, k) => ({ x: f('cx') + rx * Math.cos((k * Math.PI) / 12), y: f('cy') + ry * Math.sin((k * Math.PI) / 12) })), true);
        break;
      }
      case 'text':
        pendingText = { at: apply(m, { x: f('x'), y: f('y') }), layer, parts: [] };
        if (selfClose) pendingText = null;
        break;
      default:
        break;
    }
  }
  if (!shapes.length) notes.push('No shapes found in the SVG.');
  return { format: 'svg', ...(units ? { units } : {}), yUp: false, shapes, texts, layers: [...new Set([...shapes.map((s) => s.layer), ...texts.map((t) => t.layer)])].sort(), notes };
};

/** Read either, by its name or what is in it. */
export const parseCad = (name: string, text: string): CadDrawing => (/\.svg$/i.test(name) || /^\s*(<\?xml|<svg)/.test(text) ? parseSvg(text) : parseDxf(text));

// ---------------------------------------------------------------- reading the plan

/** A role for each layer from its name: the usual CAD layer names (A-WALL, A-DOOR, A-AREA…) and plain words. */
export const guessRole = (layer: string): CadRole => {
  const l = layer.toLowerCase();
  if (/door|dr\b|opening|gate/.test(l)) return 'doors';
  if (/stair|step|ladder/.test(l)) return 'stairs';
  if (/foot|outline|boundary|envelope|perimeter|exterior/.test(l)) return 'footprint';
  if (/text|anno|label|name|tag/.test(l)) return 'labels';
  if (/room|space|area|zone|iden/.test(l)) return 'rooms';
  if (/wall|a-wall|partition|struct/.test(l)) return 'walls';
  if (/furn|equip|dim|grid|hatch|fixt|plumb|elec|defpoints|viewport|title/.test(l)) return 'ignore';
  return 'walls';
};

const bboxOf = (pts: readonly Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};

/** A unit to read it in when the file doesn't say: by how big it is (a 30 000-wide plan is in millimetres). */
export const guessUnits = (d: CadDrawing): CadUnits => {
  if (d.units) return d.units;
  const all = d.shapes.flatMap((s) => s.points);
  if (!all.length) return 'm';
  const b = bboxOf(all);
  const span = Math.max(b.w, b.d);
  return span > 2500 ? 'mm' : span > 250 ? 'cm' : 'm';
};

/** Join loose lines that meet end to end into longer runs, closed where they come back to the start. */
const chain = (segs: CadShape[], tol: number): CadShape[] => {
  const out: CadShape[] = segs.filter((s) => s.closed);
  const left = segs.filter((s) => !s.closed).map((s) => ({ ...s, points: [...s.points] }));
  const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  while (left.length) {
    const run = left.shift()!;
    let grew = true;
    while (grew && !(run.points.length > 2 && near(run.points[0]!, run.points[run.points.length - 1]!))) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i]!;
        if (s.layer !== run.layer) continue;
        const head = run.points[0]!;
        const tail = run.points[run.points.length - 1]!;
        const a = s.points[0]!;
        const b = s.points[s.points.length - 1]!;
        if (near(tail, a)) run.points.push(...s.points.slice(1));
        else if (near(tail, b)) run.points.push(...[...s.points].reverse().slice(1));
        else if (near(head, b)) run.points.unshift(...s.points.slice(0, -1));
        else if (near(head, a)) run.points.unshift(...[...s.points].reverse().slice(0, -1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (run.points.length > 3 && near(run.points[0]!, run.points[run.points.length - 1]!)) {
      run.points.pop();
      run.closed = true;
    }
    out.push(run);
  }
  return out;
};

export interface PlanRead {
  /** The floor's outline on the plan, in metres. */
  footprint?: Point[];
  rooms: { points: Point[]; name: string; area: number }[];
  doors: { at: Point; width: number }[];
  stairs: { points: Point[] }[];
  /** Everything kept, for the preview: each line with its role. */
  lines: { points: Point[]; closed: boolean; role: CadRole }[];
  size: { w: number; d: number };
  notes: string[];
}

export interface PlanOptions {
  roles: Record<string, CadRole>;
  units: CadUnits;
}

/**
 * What a drawing comes to on the plan, in metres, centred on the origin with
 * north up: the footprint, the rooms with their names, the doors and the
 * stairs. Rooms come from closed shapes on a room layer, or on a wall layer
 * when there is no room layer (the largest, the outside wall, is the
 * footprint instead). Loose lines that meet end to end count as one shape.
 */
export const readPlan = (d: CadDrawing, opts: PlanOptions): PlanRead => {
  const k = UNIT_METRES[opts.units];
  const notes: string[] = [...d.notes];
  const role = (layer: string) => opts.roles[layer] ?? guessRole(layer);
  const kept = d.shapes.filter((s) => role(s.layer) !== 'ignore');
  const all = kept.flatMap((s) => s.points);
  if (!all.length) return { rooms: [], doors: [], stairs: [], lines: [], size: { w: 0, d: 0 }, notes: [...notes, 'Nothing to read: every layer is left out.'] };
  const b = bboxOf(all);
  const flip = d.yUp ? -1 : 1;
  const P = (p: Point): Point => ({ x: Math.round((p.x - b.cx) * k * 1000) / 1000, y: Math.round((p.y - b.cy) * k * flip * 1000) / 1000 });
  const shapes = chain(
    kept.filter((s) => !s.arc && !s.block).map((s) => ({ ...s, points: s.points.map(P) })),
    0.02,
  ).concat(kept.filter((s) => s.arc || s.block).map((s) => ({ ...s, points: s.points.map(P), ...(s.arc ? { arc: { c: P(s.arc.c), r: s.arc.r * k, a: P(s.arc.a), b: P(s.arc.b) } } : {}) })));
  const closedOn = (r: CadRole) => shapes.filter((s) => s.closed && role(s.layer) === r && !s.block && s.points.length >= 3 && polygonArea(s.points) >= 1 && !selfIntersects(s.points));
  // The footprint: the outline layer's largest shape; or the outside wall; or the drawing's bounds.
  let footprint: Point[] | undefined;
  const outlines = closedOn('footprint').sort((x, y) => polygonArea(y.points) - polygonArea(x.points));
  const walls = closedOn('walls').sort((x, y) => polygonArea(y.points) - polygonArea(x.points));
  let roomShapes = closedOn('rooms');
  if (outlines[0]) footprint = outlines[0].points;
  if (!roomShapes.length && walls.length) {
    // Walls drawn as closed rooms: the biggest is the outside, unless an outline layer gave one.
    if (!footprint && walls.length > 1 && walls.slice(1).every((w) => w.points.every((p) => pointInPolygon(p, walls[0]!.points) || Math.min(...walls[0]!.points.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) < 0.5))) {
      footprint = walls[0]!.points;
      roomShapes = walls.slice(1);
    } else roomShapes = walls.filter((w) => w.points !== footprint);
  }
  if (!footprint) {
    const bb = bboxOf(shapes.flatMap((s) => s.points));
    footprint = [
      { x: bb.minX, y: bb.minY },
      { x: bb.maxX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY },
      { x: bb.minX, y: bb.maxY },
    ];
    notes.push('No outline layer: the footprint is the drawing’s bounds.');
  }
  // Names: the text inside each room, from a label layer or any layer but a left-out one.
  const labels = d.texts.filter((t) => role(t.layer) !== 'ignore').map((t) => ({ at: P(t.at), text: t.text.split('\n')[0]!.trim() }));
  const used = new Set<number>();
  let unnamed = 0;
  const rooms = roomShapes
    .sort((x, y) => polygonArea(x.points) - polygonArea(y.points))
    .map((s) => {
      const n = labels.findIndex((l, i) => !used.has(i) && pointInPolygon(l.at, s.points));
      if (n >= 0) used.add(n);
      return { points: s.points, name: n >= 0 ? labels[n]!.text : `Room ${++unnamed}`, area: Math.round(polygonArea(s.points) * 10) / 10 };
    })
    .reverse();
  // Doors: a swing's hinge and the end of its arc on the wall; a door block or shape by its middle.
  const doors: { at: Point; width: number }[] = [];
  const edges = rooms.flatMap((r) => r.points.map((p, i) => [p, r.points[(i + 1) % r.points.length]!] as const)).concat(footprint.map((p, i) => [p, footprint![(i + 1) % footprint!.length]!] as const));
  const toWall = (p: Point) =>
    Math.min(
      ...edges.map(([a, c]) => {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * (c.x - a.x) + (p.y - a.y) * (c.y - a.y)) / ((c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1)));
        return Math.hypot(p.x - (a.x + t * (c.x - a.x)), p.y - (a.y + t * (c.y - a.y)));
      }),
      Infinity,
    );
  const doorShapes = shapes.filter((s) => role(s.layer) === 'doors' || (s.block && /door/i.test(s.block.name)));
  const byBlock = new Map<string, CadShape[]>();
  const loose: CadShape[] = [];
  for (const s of doorShapes) {
    if (s.block) {
      const key = `${s.block.name}#${s.block.n}`;
      byBlock.set(key, [...(byBlock.get(key) ?? []), s]);
    } else loose.push(s);
  }
  const swing = (arc: NonNullable<CadShape['arc']>) => {
    const m1 = { x: (arc.c.x + arc.a.x) / 2, y: (arc.c.y + arc.a.y) / 2 };
    const m2 = { x: (arc.c.x + arc.b.x) / 2, y: (arc.c.y + arc.b.y) / 2 };
    return { at: toWall(m1) <= toWall(m2) ? m1 : m2, width: arc.r };
  };
  const widthOk = (w: number) => Math.round(Math.max(0.7, Math.min(3, w)) * 100) / 100;
  for (const group of byBlock.values()) {
    const arc = group.find((s) => s.arc)?.arc;
    if (arc && arc.r >= 0.5 && arc.r <= 2) {
      const s = swing(arc);
      doors.push({ at: s.at, width: widthOk(s.width) });
    } else {
      const bb = bboxOf(group.flatMap((s) => s.points));
      doors.push({ at: { x: bb.cx, y: bb.cy }, width: widthOk(Math.max(bb.w, bb.d)) });
    }
  }
  const arcs = loose.filter((s) => s.arc && s.arc.r >= 0.5 && s.arc.r <= 2);
  for (const s of arcs) {
    const sw = swing(s.arc!);
    doors.push({ at: sw.at, width: widthOk(sw.width) });
  }
  if (!arcs.length)
    for (const s of loose.filter((x) => !x.arc)) {
      const bb = bboxOf(s.points);
      if (Math.max(bb.w, bb.d) < 0.5 || Math.max(bb.w, bb.d) > 4) continue;
      doors.push({ at: { x: bb.cx, y: bb.cy }, width: widthOk(Math.max(bb.w, bb.d)) });
    }
  const stairs = shapes.filter((s) => role(s.layer) === 'stairs' && s.closed && s.points.length >= 3 && polygonArea(s.points) >= 0.8).map((s) => ({ points: s.points }));
  if (!rooms.length) notes.push('No rooms found: rooms come from closed shapes on a Rooms layer (or closed walls). Give a layer the Rooms role.');
  const fb = bboxOf(footprint);
  return {
    footprint,
    rooms,
    doors,
    stairs,
    lines: shapes.map((s) => ({ points: s.points, closed: s.closed, role: role(s.layer) })),
    size: { w: Math.round(fb.w * 100) / 100, d: Math.round(fb.d * 100) / 100 },
    notes,
  };
};

// ---------------------------------------------------------------- into the structure

export const CAD_TAG = 'cad';

export interface Imported {
  project: Project;
  made: string[];
  counts: { rooms: number; doors: number; stairs: number };
  problems: string[];
}

const isRect = (pts: readonly Point[]) => {
  if (pts.length !== 4) return false;
  const b = bboxOf(pts);
  return pts.every((p) => (Math.abs(p.x - b.minX) < 1e-3 || Math.abs(p.x - b.maxX) < 1e-3) && (Math.abs(p.y - b.minY) < 1e-3 || Math.abs(p.y - b.maxY) < 1e-3));
};

/**
 * Put a read plan on a structure's floor, as one change: the footprint
 * reshaped to the plan (or placed, if the floor has none), a room for each
 * room (rectangles as rectangles, anything else outlined), doors in the
 * nearest wall, and stairs. A door that finds no wall within a metre and a
 * half is reported, not left floating.
 */
export const importPlan = (project: Project, levelId: string, floorId: string, plan: PlanRead, global?: readonly AssetDefinition[], height?: number): Imported => {
  let p = project;
  const made: string[] = [];
  const problems: string[] = [];
  const counts = { rooms: 0, doors: 0, stairs: 0 };
  const level = levelsOf(p).levels.find((l) => l.id === levelId);
  const floor = level?.floors.find((f) => f.id === floorId);
  if (!level || !floor) return { project, made, counts, problems: ['No such floor.'] };
  const h = height ?? floor.height;
  const tagged = (id: string, patch: Partial<LevelItem> = {}) => {
    const s = levelsOf(p);
    p = withSet(p, { ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch, tags: [...new Set([...(i.tags ?? []), CAD_TAG])] } : i)) });
  };
  const shaped = (assetId: string, points: Point[], name: string, size: { h: number }) => {
    const b = bboxOf(points);
    const placed = placeAsset(p, levelId, floorId, assetId, { x: b.cx, y: b.cy }, { name, global });
    const id = placed.ids[0];
    if (!id) return '';
    p = placed.project;
    tagged(id, { x: b.cx, y: b.cy, size: { w: Math.max(0.2, b.w), d: Math.max(0.2, b.d), h: size.h } });
    if (!isRect(points)) {
      const before = p;
      p = setOutline(p, id, points, global);
      if (p === before) problems.push(`${name}’s shape crosses itself, so it is a rectangle round it.`);
    }
    made.push(id);
    return id;
  };
  // The footprint: this floor's, reshaped, or a new one.
  if (plan.footprint) {
    const set = levelsOf(p);
    const fp = set.items.find((i) => i.levelId === levelId && i.floorId === floorId && assetOf(set, i, global).role === 'footprint');
    if (fp) {
      const b = bboxOf(plan.footprint);
      p = withSet(p, { ...set, items: set.items.map((i) => (i.id === fp.id ? { ...i, x: b.cx, y: b.cy, rotation: 0, size: { ...i.size, w: b.w, d: b.d }, outline: undefined } : i)) });
      if (!isRect(plan.footprint)) p = setOutline(p, fp.id, plan.footprint, global);
      tagged(fp.id);
    } else shaped('struct.footprint', plan.footprint, `Footprint ${floor.name}`, { h: floor.height });
  }
  for (const r of plan.rooms) if (shaped('space.room', r.points, r.name, { h })) counts.rooms++;
  for (const s of plan.stairs) if (shaped('arch.stairs', s.points, 'Stairs', { h: Math.min(h, 3) })) counts.stairs++;
  plan.doors.forEach((d, n) => {
    const placed = placeAsset(p, levelId, floorId, 'arch.door', d.at, { name: plan.doors.length > 1 ? `Door ${n + 1}` : 'Door', global });
    const id = placed.ids[0];
    if (!id) return;
    const it = levelsOf(placed.project).items.find((i) => i.id === id)!;
    if (!it.host) {
      problems.push(`A door at ${d.at.x.toFixed(1)}, ${d.at.y.toFixed(1)} m isn’t on any room’s wall, so it was left out.`);
      return;
    }
    p = placed.project;
    tagged(id, { size: { ...it.size, w: Math.round(d.width * 100) / 100 } });
    made.push(id);
    counts.doors++;
  });
  // Frames are worth a final look: a room that ended up outside the footprint is said.
  const set = levelsOf(p);
  if (plan.footprint) for (const id of made) {
    const it = set.items.find((i) => i.id === id)!;
    if (assetOf(set, it, global).kind !== 'space' || assetOf(set, it, global).role === 'footprint') continue;
    const f = frameOf(set, it, global);
    if (!pointInPolygon({ x: f.x, y: f.y }, plan.footprint)) problems.push(`${it.name} is outside the footprint.`);
  }
  return { project: p, made, counts, problems };
};
