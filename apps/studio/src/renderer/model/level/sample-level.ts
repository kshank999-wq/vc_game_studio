import type { Project } from '../types';
import { addLevel, linkItem, placeAsset, resizeItem, setOutline, setParam, updateItem, updateLevel } from './level';
import { bindToPuzzle } from './puzzles';
import type { LevelItem } from './types';

/**
 * The Sunken Vault's level: the cave mouth, the squeeze, the silt camp where
 * the key lies, and the vault chamber behind the bronze door. Built with the
 * Level Designer's own operations, and tied to the sample's scenes and Bible.
 */
export const sampleLevel = (
  project: Project,
  refs: { caveMouth: string; squeeze: string; theKey: string; vaultDoor: string; chamber: string; mara: string; lever: string; key: string; puzzle: string; cinematic: string; descent: string; oil: string },
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
  // The cave mouth is open ground of no particular shape; the chamber has its corners cut.
  p = setOutline(p, cave, [{ x: -8, y: -6 }, { x: 8, y: -6 }, { x: 8, y: 2 }, { x: 5, y: 6 }, { x: -4, y: 6 }, { x: -8, y: 3 }]);
  const chamberCorners = [{ x: 6.5, y: -20 }, { x: 13.5, y: -20 }, { x: 15, y: -18.5 }, { x: 15, y: -13.5 }, { x: 13.5, y: -12 }, { x: 6.5, y: -12 }, { x: 5, y: -13.5 }, { x: 5, y: -18.5 }];
  p = setOutline(p, vault, chamberCorners);
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
  // Low: the player crouches through (1.1 m crouched, 1.75 m standing).
  archway('Crawlway', 0, -6.05, 1.2, 1.3);
  archway('Squeeze exit', 6, -7.5, 1.2, 1.8);
  archway('Chamber stair', 10, -12, 2);
  const bronze = put('arch.door', 'Bronze Door', 10, -20, { w: 2.4, h: 3.2 });
  set(bronze, { swing: 'sliding', locked: true, keyItem: refs.key, prompt: 'Turn the key' });
  p = linkItem(p, bronze, refs.puzzle);
  patch(bronze, { activeWhen: { match: 'all', items: [{ kind: 'puzzle', ref: refs.puzzle, op: 'unsolved' }] } });

  // Who is where.
  // The explorer's light is the lantern (Lantern oil): a minute and a half of oil, topped up by Mara.
  const start = put('actor.player', 'Explorer start', -1, 3.5);
  set(start, { light: refs.oil, lightFuel: 90, lightRange: 8 });
  const mara = put('actor.npc', 'Mara', 1.5, 3);
  set(mara, { character: refs.mara, prompt: 'Talk to Mara', patrol: 'Cave watch', speed: 1.1 });
  // She paces the cave mouth while the player gets their bearings: two stops, a wait at each.
  const watch = (name: string, x: number, y: number, order: number, wait: number) => set(put('actor.patrol', name, x, y), { path: 'Cave watch', order, wait });
  watch('Cave watch 1', 1.5, 3, 1, 4);
  watch('Cave watch 2', 4.5, 0.5, 2, 3);
  // The lantern by the entrance: taking it makes Lantern oil available, so the player's light can be lit (L).
  const lantern = put('light.practical', 'Lantern', -2.5, 2.5, undefined);
  set(lantern, { interactive: true, prompt: 'Take the lantern' });
  patch(lantern, { rules: [{ id: 'rule_lantern', on: 'interact', effects: [{ kind: 'enableMechanic', ref: refs.oil }], actions: [{ kind: 'despawn', target: lantern }] }] });
  patch(mara, { rules: [{ id: 'rule_oil', on: 'interact', actions: [{ kind: 'refuel', target: start }] }] });
  const guide = put('pres.dialogue', 'Mara at the door', 12.5, -17);
  set(guide, { speaker: refs.mara });
  // The Vault Door puzzle (spec V2 §14): played in the chamber, Mara's warning its clue. (The lever, the door and the water are read from the level.)
  p = bindToPuzzle(p, vault, { puzzle: refs.puzzle, role: 'entry' });
  p = bindToPuzzle(p, guide, { puzzle: refs.puzzle, role: 'clue' });

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
  // The chamber's echo fills it, cut corners and all.
  const echo = put('pres.ambient', 'Dripping echo', 10, -16, { w: 10, d: 8, h: 4.5 });
  p = setOutline(p, echo, chamberCorners);
  // The Squeeze is pitch dark: the lantern, or nothing. (Placed last, so the other items keep their export names.)
  const squeezeDark = put('logic.darkness', 'Squeeze dark', 0, -7.5, { w: 12, d: 3, h: 2.2 });
  set(squeezeDark, { dark: 96 });
  return p;
};
