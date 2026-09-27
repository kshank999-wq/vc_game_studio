import type { Effect, Rule } from '../rules';
import type { Project } from '../types';
import { assetOf, frameOf, meshesFor, paramOf } from '../level/geometry';
import { levelsOf } from '../level/level';
import { exportNameOf, levelExportName } from '../level/naming';
import type { LevelItem, ParamValue } from '../level/types';
import { fingerprint } from './engines';
import type { IrEffect, IrRule } from './ir';

/**
 * Levels in the engine-neutral handoff model (spec §11.1). Coordinates are
 * metres with y up: x east, z south, the same as the graybox. Rotation is
 * about y in degrees, counter-clockwise seen from above (the graybox's
 * sense); each adapter turns this into its engine's axes. Every item carries
 * its GUID, so an engine can find and update what it placed last time.
 */

/** One piece of an item's graybox, in the item's own frame. */
export interface IrPiece {
  part: string;
  shape: 'box' | 'cylinder' | 'sphere' | 'wedge' | 'cone' | 'slab';
  /** Centre, relative to the item. */
  at: [number, number, number];
  size: [number, number, number];
  /** About y, relative to the item. */
  turn: number;
  color: string;
  opacity: number;
  collide: boolean;
  light?: { kind: 'point' | 'spot' | 'area'; color: string; intensity: number; range: number; angle?: number };
  /**
   * A slab's corners [x, z] around its centre, in its own frame, clockwise
   * seen from above; `size` is their bounds and its thickness. `triangles`
   * cover the outline, three indices each, also clockwise from above.
   */
  outline?: [number, number][];
  triangles?: number[];
}

export interface IrLevelAction {
  kind: string;
  /** An item's GUID, a story key (scene, cinematic) or a level key. */
  target: string;
}

export interface IrLevelRule {
  on: string;
  detail?: string;
  when?: IrRule;
  effects?: IrEffect[];
  actions?: IrLevelAction[];
}

export interface IrLevelItem {
  guid: string;
  /** TYPE_Context_Name_### (spec §10.2). */
  export_name: string;
  name: string;
  asset: string;
  kind: string;
  role: string;
  category: string;
  floor: string;
  /** World position: the item's centre on the plan, at its base height. */
  position: [number, number, number];
  /** Degrees about y, counter-clockwise from above. */
  turn: number;
  size: [number, number, number];
  /** Every parameter's value as it stands (inherited or changed); story references as story keys. */
  params: Record<string, ParamValue>;
  /** Story elements it belongs to, as story keys. */
  links: string[];
  /** The scenes among them: a character here starts the first when talked to. */
  scenes: string[];
  /** A door or window's space and wall: 0–3 north, east, south, west, or the outline's wall n (corner n to the next). */
  host?: { guid: string; wall: number };
  /** A freeform space's corners [x, z] in metres around its position, in its own frame, clockwise seen from above. */
  outline?: [number, number][];
  active_when?: IrRule;
  rules: IrLevelRule[];
  /** Where each engine's exporter puts it, unless the item names a template of its own. */
  engine: { godot: string; unity: string; unreal: string; template: string };
  /** The final art that replaces the proxy, and whether re-export must leave the art alone (spec §11.3). */
  final_asset: string;
  replacement_locked: boolean;
  pieces: IrPiece[];
  revision: string;
}

export interface IrLevel {
  guid: string;
  key: string;
  export_name: string;
  name: string;
  floors: { key: string; name: string; elevation: number; height: number }[];
  links: string[];
  /** Where the player begins, when there is a player start. */
  start: { position: [number, number, number]; turn: number } | null;
  items: IrLevelItem[];
  revision: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface StoryKeys {
  key: (id: string | undefined | null) => string | null;
  rule: (r: Rule | undefined) => IrRule | undefined;
  effects: (e: Effect[] | undefined) => IrEffect[] | undefined;
  toKey: (text: string) => string;
}

export const buildLevels = (project: Project, story: StoryKeys): IrLevel[] => {
  const set = levelsOf(project);
  const usedKeys = new Set<string>();
  const levelKey = new Map<string, string>();
  for (const level of set.levels) {
    let k = story.toKey(level.name);
    for (let n = 2; usedKeys.has(k); n++) k = `${story.toKey(level.name)}_${n}`;
    usedKeys.add(k);
    levelKey.set(level.id, k);
  }
  const itemsById = new Map(set.items.map((i) => [i.id, i]));

  return set.levels.map((level): IrLevel => {
    const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
    const floorKey = new Map(level.floors.map((f, n) => [f.id, `${story.toKey(f.name)}_${n + 1}`]));
    const meshes = meshesFor(set, level.id, { ceilings: true });
    const byItem = new Map<string, typeof meshes>();
    for (const m of meshes) byItem.set(m.itemId, [...(byItem.get(m.itemId) ?? []), m]);
    const items = set.items
      .filter((i) => i.levelId === level.id && !i.hidden && paramOf(set, i, 'export') !== false)
      .map((item): IrLevelItem => {
        const def = assetOf(set, item);
        const f = frameOf(set, item);
        const base = (elevation.get(item.floorId) ?? 0) + f.z;
        const theta = (-f.rotation * Math.PI) / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const pieces = (byItem.get(item.id) ?? []).map((m): IrPiece => {
          const dx = m.x - f.x;
          const dz = m.z - f.y;
          return {
            part: m.part,
            shape: m.shape,
            at: [round(dx * cos - dz * sin), round(m.y - base), round(dx * sin + dz * cos)],
            size: [round(m.sx), round(m.sy), round(m.sz)],
            turn: round(((m.rotY - theta) * 180) / Math.PI),
            color: m.color,
            opacity: m.opacity,
            collide: m.collide,
            ...(m.light ? { light: m.light } : {}),
            ...(m.outline ? { outline: m.outline.map((q): [number, number] => [round(q.x), round(q.z)]), triangles: m.triangles ?? [] } : {}),
          };
        });
        const params: Record<string, ParamValue> = {};
        for (const p of def.params) {
          const v = paramOf(set, item, p.key) ?? p.default;
          params[p.key] = p.type === 'ref' ? (story.key(String(v || '')) ?? '') : v;
          // A portal names the level it leads to; the engine gets that level's key.
          if (p.key === 'to' && def.role === 'portal') {
            const to = set.levels.find((l) => l.name.trim().toLowerCase() === String(v).trim().toLowerCase());
            params[p.key] = to ? levelKey.get(to.id)! : String(v);
          }
        }
        const target = (a: { kind: string; target: string }): string =>
          a.kind === 'startScene' || a.kind === 'playCinematic' ? (story.key(a.target) ?? '') : a.kind === 'goToLevel' ? (levelKey.get(a.target) ?? '') : itemsById.has(a.target) ? a.target : '';
        const rules = (item.rules ?? []).map((r): IrLevelRule => {
          const when = story.rule(r.when);
          const effects = story.effects(r.effects);
          const actions = (r.actions ?? []).map((a) => ({ kind: a.kind, target: target(a) })).filter((a) => a.target);
          return { on: r.on, ...(r.detail ? { detail: r.detail } : {}), ...(when ? { when } : {}), ...(effects ? { effects } : {}), ...(actions.length ? { actions } : {}) };
        });
        const out: Omit<IrLevelItem, 'revision'> = {
          guid: item.id,
          export_name: exportNameOf(set, item),
          name: item.name,
          asset: def.id,
          kind: def.kind,
          role: def.role,
          category: def.category,
          floor: floorKey.get(item.floorId) ?? '',
          position: [round(f.x), round(base), round(f.y)],
          turn: round(-f.rotation),
          size: [round(f.w), round(f.h), round(f.d)],
          params,
          links: (item.links ?? []).map((l) => story.key(l)).filter((k): k is string => !!k),
          scenes: (item.links ?? []).filter((l) => project.objects[l]?.type === 'scene').map((l) => story.key(l)!).filter(Boolean),
          ...(item.host && itemsById.has(item.host.id) ? { host: { guid: item.host.id, wall: item.host.wall } } : {}),
          ...(f.outline ? { outline: f.outline.map((q): [number, number] => [round(q.x), round(q.y)]) } : {}),
          ...(story.rule(item.activeWhen) ? { active_when: story.rule(item.activeWhen) } : {}),
          rules,
          engine: { ...def.engine, template: String(params.template ?? '') },
          final_asset: String(params.finalAsset ?? ''),
          replacement_locked: params.replacementLocked === true,
          pieces,
        };
        return { ...out, revision: fingerprint(JSON.stringify(out)) };
      });
    const start = items.find((i) => i.role === 'playerStart');
    const out: Omit<IrLevel, 'revision'> = {
      guid: level.id,
      key: levelKey.get(level.id)!,
      export_name: levelExportName(set, level),
      name: level.name,
      floors: level.floors.map((f) => ({ key: floorKey.get(f.id)!, name: f.name, elevation: f.elevation, height: f.height })),
      links: (level.links ?? []).map((l) => story.key(l)).filter((k): k is string => !!k),
      start: start ? { position: start.position, turn: start.turn } : null,
      items,
    };
    return { ...out, revision: fingerprint(JSON.stringify(out)) };
  });
};

/** What changed since the last export, item by item (spec §11.4). */
export interface LevelChanges {
  added: string[];
  changed: string[];
  removed: string[];
  same: number;
}

export const levelChanges = (levels: readonly IrLevel[], last: Record<string, string> | undefined): LevelChanges => {
  const now = new Map(levels.flatMap((l) => l.items.map((i) => [i.guid, i.revision] as const)));
  if (!last) return { added: [...now.keys()], changed: [], removed: [], same: 0 };
  const added: string[] = [];
  const changed: string[] = [];
  let same = 0;
  for (const [guid, revision] of now) {
    if (!(guid in last)) added.push(guid);
    else if (last[guid] !== revision) changed.push(guid);
    else same++;
  }
  return { added, changed, removed: Object.keys(last).filter((g) => !now.has(g)), same };
};

/** Items the story's element refers to, by GUID: for "what each element becomes". */
export const levelItemFor = (levels: readonly IrLevel[], guid: string): { level: IrLevel; item: IrLevelItem } | null => {
  for (const level of levels) {
    const item = level.items.find((i) => i.guid === guid);
    if (item) return { level, item };
  }
  return null;
};

/**
 * A slab as a closed solid: its top, bottom and sides as triangles of
 * [x, y, z] corners around its centre, each clockwise seen from outside.
 */
export const slabFaces = (piece: IrPiece): [number, number, number][][] => {
  const o = piece.outline ?? [];
  const t = piece.triangles ?? [];
  const h = piece.size[1] / 2;
  const top = (i: number): [number, number, number] => [o[i]![0], h, o[i]![1]];
  const bottom = (i: number): [number, number, number] => [o[i]![0], -h, o[i]![1]];
  const out: [number, number, number][][] = [];
  for (let k = 0; k + 2 < t.length; k += 3) {
    out.push([top(t[k]!), top(t[k + 1]!), top(t[k + 2]!)]);
    out.push([bottom(t[k]!), bottom(t[k + 2]!), bottom(t[k + 1]!)]);
  }
  for (let i = 0; i < o.length; i++) {
    const j = (i + 1) % o.length;
    out.push([top(j), top(i), bottom(i)], [top(j), bottom(i), bottom(j)]);
  }
  return out;
};

/**
 * A slab cut into convex pieces, one upright prism per triangle: six [x, y, z]
 * corners each (top three, then bottom three) around its centre. Engines whose
 * triggers must be convex build a freeform volume from these.
 */
export const slabPrisms = (piece: IrPiece): [number, number, number][][] => {
  const o = piece.outline ?? [];
  const t = piece.triangles ?? [];
  const h = piece.size[1] / 2;
  const out: [number, number, number][][] = [];
  for (let k = 0; k + 2 < t.length; k += 3) {
    const corners = [t[k]!, t[k + 1]!, t[k + 2]!].map((i) => o[i]!);
    out.push([...corners.map((c): [number, number, number] => [c[0], h, c[1]]), ...corners.map((c): [number, number, number] => [c[0], -h, c[1]])]);
  }
  return out;
};

export type { LevelItem };
