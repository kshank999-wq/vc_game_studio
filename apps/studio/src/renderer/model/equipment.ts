import type { PlayState } from './rules';
import type { Project, StoryObject } from './types';

/**
 * Weapons and equipment (spec §8). Any inventory item can be equipment: it
 * goes in a slot (Hand, Head, Light: whatever the game has, one item each),
 * carries stats for the game to read (Damage 2, Armour 1: names and numbers,
 * no genre built in; equipped items' stats add up), and may take ammunition
 * (so many of another item each use) and wear out (so many uses, then it
 * breaks and is gone). Equipping needs the item carried and puts back what
 * was in the slot. Conditions ask whether an item is equipped; effects equip
 * it or put it away. The engines apply the same rules in the same order.
 */

export interface Stat {
  name: string;
  value: number;
}

export interface Equipment {
  slot: string;
  stats: Stat[];
  /** The item used up each use, and how many. */
  ammo?: string;
  ammoPerUse: number;
  /** Uses before it breaks; 0 never breaks. */
  durability: number;
}

export const equipmentOf = (o: StoryObject | undefined): Equipment | undefined => {
  if (!o || o.type !== 'inventory') return undefined;
  const e = o.data.equip as Partial<Equipment> | undefined;
  if (!e) return undefined;
  return {
    slot: String(e.slot ?? '').trim() || 'Hand',
    stats: (e.stats ?? []).filter((s) => s && String(s.name).trim()).map((s) => ({ name: String(s.name).trim(), value: Number(s.value) || 0 })),
    ...(e.ammo ? { ammo: e.ammo } : {}),
    ammoPerUse: Math.max(1, Math.round(Number(e.ammoPerUse ?? 1)) || 1),
    durability: Math.max(0, Math.round(Number(e.durability ?? 0)) || 0),
  };
};

/** Every item that can be equipped, by slot then name. */
export const equipmentList = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => equipmentOf(o))
    .sort((a, b) => equipmentOf(a)!.slot.localeCompare(equipmentOf(b)!.slot) || a.name.localeCompare(b.name));

const name = (project: Project, id: string) => project.objects[id]?.name ?? 'something no longer in the story';

export const isEquipped = (state: Pick<PlayState, 'equipped'>, id: string): boolean => Object.values(state.equipped ?? {}).includes(id);

/** Uses left before it breaks (Infinity when it never does). */
export const usesLeft = (project: Project, state: Pick<PlayState, 'wear'>, id: string): number => {
  const e = equipmentOf(project.objects[id]);
  return !e || !e.durability ? Infinity : Math.max(0, e.durability - (state.wear?.[id] ?? 0));
};

/** What the equipped items add up to for a stat (0 when none has it). */
export const statTotal = (project: Project, state: Pick<PlayState, 'equipped'>, stat: string): number =>
  Object.values(state.equipped ?? {}).reduce((n, id) => n + (equipmentOf(project.objects[id])?.stats.find((s) => s.name.toLowerCase() === stat.toLowerCase())?.value ?? 0), 0);

/** Why an item can't be equipped now ("" when it can). */
export const equipCheck = (project: Project, state: PlayState, id: string): string => {
  const e = equipmentOf(project.objects[id]);
  if (!e) return 'Not equipment.';
  if ((state.items[id] ?? 0) < 1) return `You don't carry ${name(project, id)}.`;
  if (isEquipped(state, id)) return `${name(project, id)} is already equipped.`;
  return '';
};

/** Why an equipped item can't be used now ("" when it can): not equipped, or out of its ammunition. */
export const useCheck = (project: Project, state: PlayState, id: string): string => {
  const e = equipmentOf(project.objects[id]);
  if (!e) return 'Not equipment.';
  if (!isEquipped(state, id)) return `Equip ${name(project, id)} first.`;
  if (e.ammo && (state.items[e.ammo] ?? 0) < e.ammoPerUse) return `Out of ${name(project, e.ammo)}.`;
  return '';
};

/** An item's stats in words ("Damage 2 · Reach 1"). */
export const describeStats = (e: Equipment): string => e.stats.map((s) => `${s.name} ${s.value}`).join(' · ');
