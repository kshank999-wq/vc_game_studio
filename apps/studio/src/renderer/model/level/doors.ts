import { bool, contains, frameOf, num, paramOf, type Point } from './geometry';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * A door's rules (structure spec §7), read once for Play Mode, the structure
 * graph and the solvability check alike: locked with a key, one way, timed,
 * secret, breakable.
 */
export interface DoorRules {
  /** It needs its key (or to be broken) to open. */
  locked: boolean;
  /** The inventory item that unlocks it. */
  key: string;
  /** Opens only from inside its room (the one whose wall it is in), or only from outside it. */
  oneWay: 'inside' | 'outside' | null;
  /** Seconds it stays open before it shuts again; 0 for good. */
  openFor: number;
  /** Looks like the wall until searched. */
  secret: boolean;
  /** A locked door the player can break open. */
  breakable: boolean;
  /** What it takes to break it, if anything. */
  breakWith: string;
}

export const doorRules = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): DoorRules => {
  const way = String(paramOf(set, item, 'oneWay', global) ?? '');
  return {
    locked: bool(paramOf(set, item, 'locked', global), false),
    key: String(paramOf(set, item, 'keyItem', global) ?? '').trim(),
    oneWay: way === 'inside its room' ? 'inside' : way === 'outside its room' ? 'outside' : null,
    openFor: Math.max(0, num(paramOf(set, item, 'openFor', global), 0)),
    secret: bool(paramOf(set, item, 'secret', global), false),
    breakable: bool(paramOf(set, item, 'destructible', global), false),
    breakWith: String(paramOf(set, item, 'breakWith', global) ?? '').trim(),
  };
};

/** Which side of a door someone stands on: inside its room (the one whose wall it is in), or outside it. Unknown without a room. */
export const doorSide = (set: LevelSet, door: LevelItem, at: Point, global?: readonly AssetDefinition[]): 'inside' | 'outside' | null => {
  const host = door.host && set.items.find((i) => i.id === door.host!.id);
  if (!host) return null;
  return contains(frameOf(set, host, global), at) ? 'inside' : 'outside';
};
