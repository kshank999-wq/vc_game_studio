import type { Project } from '../types';
import { addLevel, linkItem, placeAsset, resizeItem, setParam, updateItem, updateLevel } from './level';
import type { LevelItem } from './types';

/**
 * The Sunken Vault's level: the cave mouth, the squeeze, the silt camp where
 * the key lies, and the vault chamber behind the bronze door. Built with the
 * Level Designer's own operations, and tied to the sample's scenes and Bible.
 */
export const sampleLevel = (
  project: Project,
  refs: { caveMouth: string; squeeze: string; theKey: string; vaultDoor: string; chamber: string; mara: string; lever: string; key: string; puzzle: string; cinematic: string; descent: string },
): Project => {
  const made = addLevel(project, 'Sunken Vault');
  let p = updateLevel(made.project, made.id, { links: [refs.descent] });
  const levelId = made.id;
  const floorId = p.levels!.levels.find((l) => l.id === levelId)!.floors[0]!.id;
  const put = (assetId: string, name: string, x: number, y: number, size?: { w?: number; d?: number; h?: number }, rotation = 0): string => {
    const placed = placeAsset(p, levelId, floorId, assetId, { x, y }, { name, rotation });
    p = placed.project;
    const id = placed.ids[0]!;
    if (size) p = resizeItem(p, id, size);
    return id;
  };
  const set = (id: string, params: Record<string, string | number | boolean>) => {
    for (const [k, v] of Object.entries(params)) p = setParam(p, id, k, v);
  };
  const patch = (id: string, change: Partial<LevelItem>) => {
    p = updateItem(p, id, change);
  };

  // The spaces, west of the vault and climbing north.
  const cave = put('space.exterior', 'Cave Mouth', 0, 0, { w: 16, d: 12, h: 5 });
  const squeeze = put('space.hall', 'The Squeeze', 0, -7.5, { w: 12, d: 3, h: 2.2 });
  const camp = put('space.room', 'Silt Camp', 10, -9, { w: 8, d: 6, h: 3 });
  const vault = put('space.room', 'Vault Chamber', 10, -16, { w: 10, d: 8, h: 4.5 });
  p = linkItem(p, cave, refs.caveMouth);
  p = linkItem(p, squeeze, refs.squeeze);
  p = linkItem(p, camp, refs.theKey);
  p = linkItem(linkItem(p, vault, refs.vaultDoor), vault, refs.chamber);
  set(squeeze, { material: 'stone', ceiling: true });
  set(vault, { material: 'stone' });

  // Openings: into the squeeze from the cave, on into the camp, up into the chamber, and the bronze door beyond.
  const archway = (name: string, x: number, y: number, w = 1.4, h = 2.1) => {
    const id = put('arch.door', name, x, y, { w, h });
    set(id, { swing: 'open archway', interactive: false });
    return id;
  };
  archway('Crawlway', 0, -6.05, 1.2, 1.6);
  archway('Squeeze exit', 6, -7.5, 1.2, 1.8);
  archway('Chamber stair', 10, -12, 2);
  const bronze = put('arch.door', 'Bronze Door', 10, -20, { w: 2.4, h: 3.2 });
  set(bronze, { swing: 'sliding', locked: true, keyItem: refs.key, prompt: 'Turn the key' });
  p = linkItem(p, bronze, refs.puzzle);
  patch(bronze, { activeWhen: { match: 'all', items: [{ kind: 'puzzle', ref: refs.puzzle, op: 'unsolved' }] } });

  // Who is where.
  const start = put('actor.player', 'Explorer start', -1, 3.5);
  void start;
  const mara = put('actor.npc', 'Mara', 1.5, 3);
  set(mara, { character: refs.mara, prompt: 'Talk to Mara' });
  put('light.practical', 'Lantern', -2.5, 2.5, undefined);
  const guide = put('pres.dialogue', 'Mara at the door', 12.5, -17);
  set(guide, { speaker: refs.mara });

  // The key in the silt, and what it does.
  const key = put('play.item', 'Vault Key', 11.5, -10.5);
  set(key, { item: refs.key, prompt: 'Dig out the key' });
  patch(key, { rules: [{ id: 'rule_key', on: 'pickup', effects: [{ kind: 'give', ref: refs.key }] }] });
  put('light.point', 'Camp embers', 8, -8, undefined);

  // The chamber: the lever, the water, the cinematic on the way in.
  const lever = put('logic.interaction', 'Rusted Lever', 6.5, -18, { w: 1, d: 1, h: 1.4 });
  set(lever, { prompt: 'Pull' });
  p = linkItem(p, lever, refs.lever);
  patch(lever, { rules: [{ id: 'rule_lever', on: 'interact', effects: [{ kind: 'setObject', ref: refs.lever, value: 'up' }] }] });
  const water = put('logic.hazard', 'Flooded seam', 10, -16.5, { w: 5, d: 3, h: 0.6 });
  set(water, { damage: 0 });
  patch(water, { activeWhen: { match: 'all', items: [{ kind: 'object', ref: refs.lever, op: 'isNot', value: 'up' }] } });
  const entry = put('pres.cinematic', 'Door in the dark trigger', 10, -13.2, { w: 3, d: 1.6 });
  set(entry, { cinematic: refs.cinematic });
  patch(entry, { rules: [{ id: 'rule_entry', on: 'enter', actions: [{ kind: 'playCinematic', target: refs.cinematic }] }] });
  put('pres.camera', 'Chamber crane', 14, -13, undefined, 315);
  const lamp = put('light.spot', 'Seam glow', 7, -19, undefined, 135);
  set(lamp, { color: '#9fc6d8', intensity: 2 });
  put('pres.ambient', 'Dripping echo', 10, -16, { w: 10, d: 8, h: 4.5 });
  return p;
};
