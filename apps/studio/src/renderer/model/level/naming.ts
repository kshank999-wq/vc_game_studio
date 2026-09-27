import { assetOf, frameOf, spaceAt } from './geometry';
import type { AssetDefinition, Level, LevelItem, LevelSet, LevelSettings, NamingClass } from './types';

/**
 * Export names (spec §10.2): a prefix for the kind of thing, the place it is
 * in, its own name and a serial, as TYPE_Context_Name_###. The prefixes and
 * the pattern are project settings, not rules baked in. The GUID is what
 * references use; the name is for people reading the engine project.
 */

export const DEFAULT_PREFIXES: Record<NamingClass, string> = {
  level: 'LVL',
  room: 'RM',
  architecture: 'ARC',
  prop: 'PRP',
  light: 'LGT',
  interactive: 'INT',
  inventory: 'INV',
  spawn: 'SPN',
  trigger: 'TRG',
  npc: 'NPC',
  player: 'PLR',
  camera: 'CAM',
  audio: 'AUD',
  navigation: 'NAV',
  logic: 'LOG',
};

export const NAMING_LABEL: Record<NamingClass, string> = {
  level: 'Level / map',
  room: 'Room / space',
  architecture: 'Architecture',
  prop: 'Prop',
  light: 'Light',
  interactive: 'Interactive',
  inventory: 'Inventory item',
  spawn: 'Spawn',
  trigger: 'Trigger',
  npc: 'NPC / actor',
  player: 'Player',
  camera: 'Camera / cinematic',
  audio: 'Audio',
  navigation: 'Navigation',
  logic: 'Logic',
};

export const DEFAULT_TEMPLATE = '{TYPE}_{Context}_{Name}_{###}';

export const defaultSettings = (): LevelSettings => ({ units: 'm', grid: 0.5, snap: true, template: DEFAULT_TEMPLATE, prefixes: { ...DEFAULT_PREFIXES } });

/** "the magic orb" → "MagicOrb". Letters and digits only, so every engine takes it as it is. */
export const pascal = (text: string): string => {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
};

const fill = (template: string, parts: { TYPE: string; Context: string; Name: string; serial: number }): string =>
  template
    .replace(/\{TYPE\}/g, parts.TYPE)
    .replace(/\{Context\}/g, parts.Context)
    .replace(/\{Name\}/g, parts.Name)
    .replace(/\{(#+)\}/g, (_, hashes: string) => String(parts.serial).padStart(hashes.length, '0'))
    // An empty part leaves no doubled or trailing separators.
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');

export const levelExportName = (set: LevelSet, level: Level): string =>
  fill('{TYPE}_{Name}_{##}', { TYPE: set.settings.prefixes.level, Context: '', Name: pascal(level.name) || 'Level', serial: level.serial });

/** The place an item's name is given in: a space is named in its level, anything else in the space it stands in. */
export const contextOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): string => {
  const level = set.levels.find((l) => l.id === item.levelId);
  const def = assetOf(set, item, global);
  if (def.kind === 'space') return pascal(level?.name ?? '');
  const holder = item.host ? set.items.find((i) => i.id === item.host!.id) : spaceAt(set, item.levelId, item.floorId, frameOf(set, item, global), global);
  return pascal(holder?.name ?? level?.name ?? '');
};

export const exportNameOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): string => {
  if (item.exportName?.trim()) return item.exportName.trim();
  const def = assetOf(set, item, global);
  const name = pascal(item.name) || pascal(def.name) || 'Item';
  const context = contextOf(set, item, global);
  return fill(set.settings.template || DEFAULT_TEMPLATE, {
    TYPE: set.settings.prefixes[def.naming] ?? DEFAULT_PREFIXES[def.naming],
    // "RM_Castle_Castle" says nothing twice.
    Context: context === name ? '' : context,
    Name: name,
    serial: item.serial,
  });
};

/** How each engine would write the name: what the exporters do, so clashes show before handoff. */
export const engineSafe = (name: string, engine: 'godot' | 'unity' | 'unreal'): string => {
  if (engine === 'godot') return name.replace(/[.:@/"%]/g, '_');
  if (engine === 'unreal') return name.replace(/[^A-Za-z0-9_]/g, '_');
  return name.replace(/[/\\]/g, '_');
};
