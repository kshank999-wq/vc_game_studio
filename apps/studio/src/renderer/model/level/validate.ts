import type { Project } from '../types';
import { assetOf, corners, frameOf, openingOf, outlineOf, overlaps, paramOf, selfIntersects, wallsOf } from './geometry';
import { referencesOf } from './links';
import { migrationFor } from './migrate';
import { engineSafe, exportNameOf, levelExportName } from './naming';
import type { AssetDefinition, LevelItem } from './types';

/**
 * Preflight for levels (spec §12): what would break or surprise on export or
 * in play, each saying what will happen and pointing at the item to fix.
 */

export interface LevelIssue {
  /** The item, or the level when it is about the whole level. */
  id: string;
  levelId: string;
  severity: 'error' | 'warning';
  message: string;
  /** What this means for the export (spec §15: messages explain the handoff). */
  export: string;
  /** Only true for the engine being exported to (spec §12: unsupported properties). */
  engine?: boolean;
}

/** Roles whose behaviour the generated runtimes don't build: they go over as placed markers for the game to script. */
const UNSCRIPTED: Record<string, string> = {
  elevator: 'an elevator',
  ladder: 'a ladder',
  traversal: 'a traversal link',
  patrolNode: 'a patrol stop',
  waypoint: 'a waypoint',
  cover: 'a cover point',
};

const ENGINES = ['godot', 'unity', 'unreal'] as const;

export const levelIssues = (project: Project, global?: readonly AssetDefinition[], engine?: 'godot' | 'unity' | 'unreal' | 'custom'): LevelIssue[] => {
  const set = project.levels;
  if (!set) return [];
  const out: LevelIssue[] = [];
  const add = (issue: LevelIssue) => out.push(issue);

  for (const level of set.levels) {
    const items = set.items.filter((i) => i.levelId === level.id);
    if (!items.some((i) => assetOf(set, i, global).role === 'playerStart' && !i.hidden)) {
      add({ id: level.id, levelId: level.id, severity: 'error', message: `${level.name} has no player start.`, export: 'The engine would not know where to put the player. Drag a Player start in from Actors.' });
    }
    for (const id of level.links ?? []) {
      if (!project.objects[id]) add({ id: level.id, levelId: level.id, severity: 'warning', message: `${level.name} links to something no longer in the story.`, export: 'The link is left out of the export.' });
    }
  }

  // Export names: the same name twice, or two names the same once an engine has cleaned them.
  const levelNames = new Map<string, string>();
  for (const level of set.levels) {
    const name = levelExportName(set, level);
    if (levelNames.has(name)) add({ id: level.id, levelId: level.id, severity: 'error', message: `Two levels are both exported as ${name}.`, export: 'One would overwrite the other. Rename a level.' });
    levelNames.set(name, level.id);
  }
  const clashed = new Set<string>();
  for (const engine of ENGINES) {
    const seen = new Map<string, LevelItem>();
    for (const item of set.items) {
      if (paramOf(set, item, 'export', global) === false) continue;
      const raw = exportNameOf(set, item, global);
      const key = `${item.levelId}:${engineSafe(raw, engine)}`;
      const other = seen.get(key);
      if (!other) {
        seen.set(key, item);
        continue;
      }
      if (clashed.has(item.id)) continue;
      clashed.add(item.id);
      const engineName = engine === 'godot' ? 'Godot' : engine === 'unity' ? 'Unity' : 'Unreal';
      add({
        id: item.id,
        levelId: item.levelId,
        severity: 'error',
        message: raw === exportNameOf(set, other, global) ? `${item.name} and ${other.name} are both exported as ${raw}.` : `${item.name} and ${other.name} both become ${engineSafe(raw, engine)} in ${engineName}.`,
        export: 'The second would replace the first in the engine. Give one of them another export name.',
      });
    }
  }

  const spaces = set.items.filter((i) => assetOf(set, i, global).kind === 'space' && !i.hidden);
  for (const item of set.items) {
    const def = assetOf(set, item, global);
    if (def.id === 'missing') {
      add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name} comes from a library asset that is missing.`, export: 'It exports as a plain box. Save the asset to this project’s library, or replace the item.' });
    }
    if (item.invalid) add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name}: ${item.invalid}`, export: 'It is exported where it is, outside any wall; the opening is not cut.' });
    else if (item.host) {
      const o = openingOf(set, item, global);
      if (o && !o.fits) add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name} doesn’t fit its wall.`, export: 'The opening would run past the wall’s end.' });
    }

    // References to the story, the library and other items.
    const refKeys = def.params.filter((p) => p.type === 'ref').map((p) => p.key);
    const refs = referencesOf(item, refKeys);
    const missing = refs.filter((r) => !project.objects[r] && !set.items.some((i) => i.id === r) && !set.levels.some((l) => l.id === r));
    if (missing.length) {
      add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name} refers to ${missing.length === 1 ? 'something' : `${missing.length} things`} no longer in the project.`, export: 'Those references are dropped from the export. Pick another, or remove them.' });
    }

    if (outlineOf(set, item, global)) {
      const f = frameOf(set, item, global);
      if (selfIntersects(corners(f))) {
        add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name}’s outline crosses itself.`, export: 'Its walls and floor can’t be built as drawn. Drag a corner so no two walls cross.' });
      } else if (wallsOf(f).some((w) => w.length < 0.25)) {
        add({ id: item.id, levelId: item.levelId, severity: 'warning', message: `${item.name} has a wall shorter than 25 cm.`, export: 'It exports, but the corners pile up there. Take out a corner.' });
      }
    }
    if (def.role === 'spawn' && !String(paramOf(set, item, 'actor', global) ?? '')) {
      add({ id: item.id, levelId: item.levelId, severity: 'error', message: `${item.name} has nothing to spawn.`, export: 'The spawner is exported empty. Choose who or what it spawns.' });
    }
    if ((def.role === 'pickup' || def.role === 'inventory') && !String(paramOf(set, item, 'item', global) ?? '')) {
      add({ id: item.id, levelId: item.levelId, severity: 'warning', message: `${item.name} isn’t tied to an inventory item.`, export: 'Picking it up changes nothing in the story. Choose the item it gives.' });
    }
    if (['npc', 'companion', 'enemy', 'neutral'].includes(def.role) && !String(paramOf(set, item, 'character', global) ?? '') && !(item.links ?? []).some((l) => project.objects[l]?.type === 'character')) {
      add({ id: item.id, levelId: item.levelId, severity: 'warning', message: `${item.name} doesn’t stand for a character.`, export: 'It exports as an unnamed actor. Choose the character from the Bible.' });
    }
    if (def.role === 'cinematic' && !String(paramOf(set, item, 'cinematic', global) ?? '')) {
      add({ id: item.id, levelId: item.levelId, severity: 'warning', message: `${item.name} doesn’t play a cinematic yet.`, export: 'The trigger is exported with nothing to play.' });
    }
    if (def.kind === 'volume' && def.role === 'trigger' && !(item.rules ?? []).length) {
      add({ id: item.id, levelId: item.levelId, severity: 'warning', message: `${item.name} has no rules, so it does nothing.`, export: 'An empty trigger is exported. Add a rule under Logic.' });
    }
  }

  // Placed from an earlier version of a library asset: shown, never silently changed (spec §4.3).
  for (const item of set.items) {
    const m = migrationFor(project, item, global);
    if (!m) continue;
    const def = assetOf(set, item, global);
    const inherited = m.changes.filter((c) => c.kind === 'inherited').length;
    add({
      id: item.id,
      levelId: item.levelId,
      severity: 'warning',
      message: `${item.name} is from v${m.from} of ${def.name}; the library is at v${m.to}.`,
      export: inherited
        ? `It exports with the library's new values for ${inherited === 1 ? 'one setting' : `${inherited} settings`} it inherited. Review it in the inspector to keep the old ones.`
        : 'It exports with the library’s current values. Update it in the inspector.',
    });
  }

  // What the engine being exported to will make of it.
  if (engine) {
    const engineName = { godot: 'Godot', unity: 'Unity', unreal: 'Unreal', custom: 'the JSON export' }[engine];
    for (const item of set.items) {
      if (item.hidden || paramOf(set, item, 'export', global) === false) continue;
      const def = assetOf(set, item, global);
      if (UNSCRIPTED[def.role]) {
        add({ id: item.id, levelId: item.levelId, severity: 'warning', engine: true, message: `${item.name} goes to ${engineName} as ${UNSCRIPTED[def.role]} marker.`, export: 'It is placed with its settings, but what it does is left to the game’s own code.' });
      }
      if (engine === 'unreal' && def.proxy === 'wedge') {
        add({ id: item.id, levelId: item.levelId, severity: 'warning', engine: true, message: `${item.name} goes to Unreal as a sloped box.`, export: 'Unreal’s basic shapes have no wedge; the ramp is a box tilted to the same slope.' });
      }
      if (paramOf(set, item, 'replacementLocked', global) === true && !String(paramOf(set, item, 'finalAsset', global) ?? '')) {
        add({ id: item.id, levelId: item.levelId, severity: 'warning', engine: true, message: `${item.name} has its final art locked but no final asset named.`, export: 'Its proxy is left out so re-export can’t cover the art; name the asset so the engine can place it.' });
      }
    }
  }

  // What someone noticed while playing, until it is marked resolved.
  for (const note of set.notes ?? []) {
    if (note.resolved) continue;
    const item = note.itemId ? set.items.find((i) => i.id === note.itemId) : undefined;
    add({ id: item?.id ?? note.levelId, levelId: note.levelId, severity: 'warning', message: item ? `Play note on ${item.name}: ${note.text}` : `Play note: ${note.text}`, export: 'Noted during Play Mode. Mark it resolved in the inspector once it is dealt with.' });
  }

  // Spaces on the same floor that overlap.
  for (let a = 0; a < spaces.length; a++) {
    for (let b = a + 1; b < spaces.length; b++) {
      const A = spaces[a]!;
      const B = spaces[b]!;
      if (A.levelId !== B.levelId || A.floorId !== B.floorId) continue;
      if (overlaps(frameOf(set, A, global), frameOf(set, B, global), 0.25)) {
        add({ id: B.id, levelId: B.levelId, severity: 'warning', message: `${B.name} overlaps ${A.name}.`, export: 'Their walls would cross in the engine. Move one, or make one smaller.' });
      }
    }
  }
  return out;
};
