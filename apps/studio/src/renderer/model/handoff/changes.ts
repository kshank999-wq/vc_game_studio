import type { Project } from '../types';
import { levelsOf, placeAsset, placeAt, removeItems, updateItem } from '../level/level';
import { exportNameOf } from '../level/naming';
import { buildIR } from './ir';

/**
 * Bringing safe engine-side changes back (spec §19 round-trip import). Each
 * engine's handoff has an exporter (Godot's `vcgs/export_changes.gd`, Unity's
 * VCGS ▸ Export changes for the studio, Unreal's `export_changes.py`) that
 * writes vcgs-changes.json: every studio item it finds, by GUID, with its name,
 * position and turn as they are in the engine now, and what was added under a
 * level without a GUID. The studio reads it against the project and lists
 * what differs: moved, renamed, deleted in the engine, added there. Only what
 * the studio owns comes back (where things are, what they're called, whether
 * they're there); code, art and engine settings stay the engine team's. The
 * designer ticks what to take, and it applies as one undo step.
 */

export const CHANGES_FORMAT = 'vcgs-changes';

/** vcgs-changes.json: positions in metres in the level's space (x east, y up, z south), turns in degrees counter-clockwise from above, as the IR. */
export interface EngineChanges {
  format: typeof CHANGES_FORMAT;
  version: 1;
  engine: string;
  levels: {
    guid: string;
    items: { guid: string; name: string; position: [number, number, number]; turn: number }[];
    added?: { name: string; position: [number, number, number]; turn: number }[];
  }[];
}

export type EngineChange =
  | { kind: 'moved'; id: string; levelId: string; name: string; from: { x: number; y: number; z: number; rotation: number }; to: { x: number; y: number; z: number; rotation: number } }
  | { kind: 'renamed'; id: string; levelId: string; name: string; from: string; to: string }
  | { kind: 'deleted'; id: string; levelId: string; name: string }
  | { kind: 'added'; id: string; levelId: string; floorId: string; name: string; at: { x: number; y: number; z: number; rotation: number } };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const vec = (v: unknown): [number, number, number] | null => (Array.isArray(v) && v.length === 3 && v.every((n) => num(n) !== null) ? (v as [number, number, number]) : null);

/** The file, checked; or what is wrong with it, in words. */
export const parseChanges = (text: string): EngineChanges | string => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'This isn’t a JSON file.';
  }
  const o = raw as Partial<EngineChanges>;
  if (!o || o.format !== CHANGES_FORMAT) return 'This isn’t a vcgs-changes.json from an engine’s exporter.';
  if (o.version !== 1) return `This vcgs-changes.json is version ${String(o.version)}; this studio reads version 1.`;
  if (!Array.isArray(o.levels)) return 'This vcgs-changes.json has no levels.';
  const levels: EngineChanges['levels'] = [];
  for (const l of o.levels) {
    if (!l || typeof l.guid !== 'string') continue;
    const items = (Array.isArray(l.items) ? l.items : []).flatMap((i) => {
      const position = vec(i?.position);
      return i && typeof i.guid === 'string' && position ? [{ guid: i.guid, name: String(i.name ?? ''), position, turn: num(i.turn) ?? 0 }] : [];
    });
    const added = (Array.isArray(l.added) ? l.added : []).flatMap((a) => {
      const position = vec(a?.position);
      return a && position ? [{ name: String(a.name ?? 'Added'), position, turn: num(a.turn) ?? 0 }] : [];
    });
    levels.push({ guid: l.guid, items, added });
  }
  return { format: CHANGES_FORMAT, version: 1, engine: String(o.engine ?? 'engine'), levels };
};

/** Names as the engines can hold them: letters, digits and underscores. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
/** An engine name the same as the export name, give or take what the engine does to it (unsafe letters, a _2 to keep names apart). */
const sameName = (engine: string, exported: string) => {
  const e = safe(engine);
  const x = safe(exported);
  return e === x || new RegExp(`^${x}_\\d+$`).test(e);
};
const turnOf = (deg: number) => ((-deg % 360) + 360) % 360;
const angleApart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** What the engine's copy has that the studio's doesn't, item by item. */
export const changesFrom = (project: Project, file: EngineChanges): EngineChange[] => {
  const set = levelsOf(project);
  const ir = buildIR(project);
  const out: EngineChange[] = [];
  for (const l of file.levels) {
    const level = set.levels.find((x) => x.id === l.guid);
    const sent = ir.levels.find((x) => x.guid === l.guid);
    if (!level || !sent) continue;
    const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
    const there = new Map(l.items.map((i) => [i.guid, i]));
    for (const s of sent.items) {
      const item = set.items.find((i) => i.id === s.guid);
      if (!item) continue;
      const e = there.get(s.guid);
      if (!e) {
        out.push({ kind: 'deleted', id: item.id, levelId: level.id, name: item.name });
        continue;
      }
      if (!sameName(e.name, s.export_name)) out.push({ kind: 'renamed', id: item.id, levelId: level.id, name: item.name, from: s.export_name, to: safe(e.name) });
      // A door or window sits in its wall: moving it is the wall's business.
      if (item.host) continue;
      const to = { x: e.position[0], y: e.position[2], z: e.position[1] - (elevation.get(item.floorId) ?? 0), rotation: turnOf(e.turn) };
      const moved = Math.hypot(to.x - s.position[0], to.y - s.position[2], e.position[1] - s.position[1]) > 0.01 || angleApart(e.turn, s.turn) > 0.5;
      if (moved) out.push({ kind: 'moved', id: item.id, levelId: level.id, name: item.name, from: { x: item.x, y: item.y, z: item.z, rotation: item.rotation }, to });
    }
    const floors = [...level.floors].sort((a, b) => a.elevation - b.elevation);
    (l.added ?? []).forEach((a, n) => {
      // On the highest floor at or below it.
      const floor = [...floors].reverse().find((f) => f.elevation <= a.position[1] + 0.1) ?? floors[0];
      if (!floor) return;
      out.push({ kind: 'added', id: `added:${l.guid}:${n}`, levelId: level.id, floorId: floor.id, name: a.name, at: { x: a.position[0], y: a.position[2], z: a.position[1] - floor.elevation, rotation: turnOf(a.turn) } });
    });
  }
  return out;
};

/** Take the chosen changes into the project, all at once. Added things come in as waypoints, named as in the engine, to give a role to. */
export const applyChanges = (project: Project, changes: readonly EngineChange[]): Project => {
  // Export names say which room things are in. Whatever comes back, things keep the names the engine knows them by, unless renamed there.
  const before = levelsOf(project);
  const names = new Map(before.items.map((i) => [i.id, exportNameOf(before, i)]));
  const renamed = new Set(changes.filter((c) => c.kind === 'renamed').map((c) => c.id));
  let p = project;
  for (const c of changes) {
    if (c.kind === 'moved') p = placeAt(p, c.id, c.to);
    else if (c.kind === 'renamed') p = updateItem(p, c.id, { exportName: c.to });
  }
  const gone = changes.filter((c) => c.kind === 'deleted').map((c) => c.id);
  if (gone.length) p = removeItems(p, gone);
  const now = levelsOf(p);
  for (const i of now.items) {
    const was = names.get(i.id);
    if (was && !renamed.has(i.id) && exportNameOf(now, i) !== was) p = updateItem(p, i.id, { exportName: was });
  }
  for (const c of changes) {
    if (c.kind !== 'added') continue;
    const made = placeAsset(p, c.levelId, c.floorId, 'nav.waypoint', { x: c.at.x, y: c.at.y });
    const id = made.ids[0];
    if (!id) continue;
    p = updateItem(placeAt(made.project, id, { z: c.at.z, rotation: c.at.rotation }), id, { name: c.name });
  }
  return p;
};

/** A change in words, for the review list. */
export const describeChange = (c: EngineChange): string => {
  switch (c.kind) {
    case 'moved':
      return `${c.name} moved ${Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y, c.to.z - c.from.z).toFixed(2)} m${angleApart(c.to.rotation, c.from.rotation) > 0.5 ? `, turned to ${Math.round(c.to.rotation)}°` : ''}`;
    case 'renamed':
      return `${c.name} renamed ${c.from} → ${c.to}`;
    case 'deleted':
      return `${c.name} deleted in the engine`;
    case 'added':
      return `${c.name} added in the engine (comes in as a waypoint)`;
  }
};
