import { profileOf } from '../character/profile';
import { makeObject, nextCode } from '../project';
import type { Project } from '../types';
import { frameOf } from './geometry';
import { itemsInRoom } from './hierarchy';
import { levelsOf, placeAsset, setParam } from './level';
import type { AssetDefinition } from './types';

/** What to put in a room (structure spec §9): something from the story's catalog, or a new item made there. */
export type RoomPlacement = { kind: 'item'; ref: string } | { kind: 'newItem'; name: string } | { kind: 'character'; ref: string };

/**
 * Put an inventory item or a character into a room, in context (structure
 * spec §9). The definition stays in the story's catalog (an inventory item,
 * a character in the Character Creator); the room gets a placement that
 * points at it: a pickup that gives the item, or an NPC, enemy or companion
 * marker for the character. Things go round the room's middle so they don't
 * land on each other. A new item is made in the catalog first.
 */
export const placeInRoom = (project: Project, roomId: string, what: RoomPlacement, global?: readonly AssetDefinition[], now = new Date().toISOString()): { project: Project; id: string; objectId: string } | null => {
  const set = levelsOf(project);
  const room = set.items.find((i) => i.id === roomId);
  if (!room) return null;
  let p = project;
  let ref = what.kind === 'newItem' ? '' : what.ref;
  if (what.kind === 'newItem') {
    const name = what.name.trim();
    if (!name) return null;
    const made = makeObject('inventory', name, now, { code: nextCode(p, { prefix: 'ITM-', pad: 2 }) });
    p = { ...p, objects: { ...p.objects, [made.id]: made } };
    ref = made.id;
  }
  const object = p.objects[ref];
  if (!object || (what.kind === 'character' ? object.type !== 'character' : object.type !== 'inventory')) return null;
  let asset = 'play.pickup';
  if (what.kind === 'character') {
    const roles = profileOf(object).roles;
    asset = roles.includes('enemy') ? 'actor.enemy' : roles.includes('ally') ? 'actor.companion' : 'actor.npc';
  }
  // Round the middle of the room, a little further out for each thing already in it.
  const f = frameOf(set, room, global);
  const n = itemsInRoom(set, room.id, global).length;
  const reach = Math.min(f.w, f.d) / 2 - 0.6;
  const angle = n * 2.4;
  const r = n ? Math.max(0, Math.min(reach, 0.8 + 0.35 * n)) : 0;
  const at = { x: f.x + Math.cos(angle) * r, y: f.y + Math.sin(angle) * r };
  const placed = placeAsset(p, room.levelId, room.floorId, asset, at, { name: object.name, global });
  const id = placed.ids[0];
  if (!id) return null;
  p = setParam(placed.project, id, what.kind === 'character' ? 'character' : 'item', ref, global);
  return { project: p, id, objectId: ref };
};
