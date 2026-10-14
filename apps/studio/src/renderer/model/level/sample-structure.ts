import { makeObject, nextCode } from '../project';
import type { Project } from '../types';
import { levelsOf, placeAsset, setParam } from './level';
import { interactWith, isOpen, leaveLevel, offerFor, startLevelPlay, tick, type LevelPlayState } from './play';
import { createStructure, floorCodes, updateStructure } from './structure';

/**
 * The Old Tomb: a small structure for the engine checks and the tests
 * (structure spec §16). Four rooms on one floor, one of each door rule:
 *
 *   Outside ─ Front door ─ Entrance Hall ─ Inner door (locked: Tomb Key; shuts after 4 s) ─ Burial Chamber ─ Rubble door (breakable) ─ Crypt
 *                              └─ Vault door (secret) ─ Treasury ─ Back door (one way, out) ─ Outside
 *
 * The Tomb Key lies in the Entrance Hall. Two objectives: find the key, reach
 * the crypt. Completing it sets Tomb plundered to yes.
 */
export interface Tomb {
  project: Project;
  id: string;
  massId: string;
  floorId: string;
  rooms: { hall: string; chamber: string; treasury: string; crypt: string };
  doors: { front: string; inner: string; vault: string; rubble: string; back: string };
  keyPickup: string;
  key: string;
  plundered: string;
}

const NOW = '2026-10-14T00:00:00.000Z';

export const withTomb = (project: Project, parentId?: string): Tomb => {
  const set = levelsOf(project);
  const parent = set.levels.find((l) => l.id === parentId) ?? set.levels.find((l) => (l.kind ?? 'level') === 'level') ?? set.levels[0]!;
  const ground = parent.floors.find((f) => Math.abs(f.elevation) < 0.01) ?? parent.floors[0]!;
  const made = createStructure(project, { parentId: parent.id, floorId: ground.id, at: { x: 120, y: 120 }, type: 'dungeon', name: 'Old Tomb', w: 40, d: 30, above: 1, below: 0, floorHeight: 3, roof: false, shape: 'rectangle', step: 0, traversal: 'mixed' });
  const level = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
  const g = level.floors.find((f) => floorCodes(level).get(f.id) === 'G')!.id;
  let p = made.project;
  const put = (asset: string, x: number, y: number, name: string) => {
    const r = placeAsset(p, made.id, g, asset, { x, y }, { name });
    p = r.project;
    return r.ids[0]!;
  };
  const hall = put('space.room', -11, 0, 'Entrance Hall');
  const chamber = put('space.room', -3, 0, 'Burial Chamber');
  const treasury = put('space.room', -11, 6, 'Treasury');
  const crypt = put('space.room', 5, 0, 'Crypt');
  const front = put('arch.door', -15, 0, 'Front door');
  const inner = put('arch.door', -7, 1, 'Inner door');
  const vault = put('arch.door', -11, 3, 'Vault door');
  const rubble = put('arch.door', 1, 1, 'Rubble door');
  const back = put('arch.door', -11, 9, 'Back door');
  const keyObject = makeObject('inventory', 'Tomb Key', NOW, { code: nextCode(p, { prefix: 'ITM-', pad: 2 }) });
  const plundered = makeObject('state', 'Tomb plundered', NOW, { states: ['no', 'yes'], initialState: 'no' });
  p = { ...p, objects: { ...p.objects, [keyObject.id]: keyObject, [plundered.id]: plundered } };
  const keyPickup = put('play.pickup', -12, -1.5, 'Tomb Key');
  p = setParam(p, keyPickup, 'item', keyObject.id);
  // The door rules: none opens by walking up (Interact does), so the checks say exactly when each opens.
  for (const d of [front, inner, vault, rubble, back]) p = setParam(p, d, 'autoOpen', false);
  p = setParam(setParam(setParam(p, inner, 'locked', true), inner, 'keyItem', keyObject.id), inner, 'openFor', 4);
  p = setParam(p, vault, 'secret', true);
  p = setParam(setParam(p, rubble, 'locked', true), rubble, 'destructible', true);
  // The back door opens from the Treasury only: from inside its room, if the Treasury is the room it is in, else from outside it.
  const backDoor = levelsOf(p).items.find((i) => i.id === back)!;
  p = setParam(p, back, 'oneWay', backDoor.host?.id === treasury ? 'inside its room' : 'outside its room');
  p = updateStructure(p, made.id, {
    purpose: 'A tomb to plunder: the engine checks walk it.',
    objectives: [
      { id: 'find_key', text: 'Find the Tomb Key', when: { match: 'all', items: [{ kind: 'item', ref: keyObject.id, op: 'has' }] } },
      { id: 'reach_crypt', text: 'Reach the crypt', at: crypt },
    ],
    onComplete: [{ kind: 'setFlag', ref: plundered.id, value: 'yes' }],
    persist: { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'keep' },
  });
  return { project: p, id: made.id, massId: made.massId, floorId: g, rooms: { hall, chamber, treasury, crypt }, doors: { front, inner, vault, rubble, back }, keyPickup, key: keyObject.id, plundered: plundered.id };
};

/** One step of the walk, and what the studio's Play Mode says after it. */
export interface TombStep {
  /** What happens: the player stands at `at` and asks what Interact would do to `guid`, uses it, or waits `seconds`. */
  do: 'offer' | 'interact' | 'wait' | 'remember';
  guid?: string;
  /** Where the player stands, in level space [x, y up, z]. */
  at: [number, number, number];
  seconds?: number;
  expect: {
    verb?: string;
    blocked?: string;
    /** Doors open now, by GUID. */
    open?: Record<string, boolean>;
    objectives?: string[];
    complete?: boolean;
    /** Story states (by key) and their values. */
    flags?: Record<string, string>;
  };
}

/**
 * The walk the engine checks replay: each door rule, the objectives and the
 * completion, then leaving and coming back. Run on the studio's own Play
 * Mode here, so what each engine must match is what the studio does.
 */
export const tombWalk = (tomb: Tomb, key: (id: string) => string): TombStep[] => {
  const p = tomb.project;
  const d = tomb.doors;
  const allDoors = Object.values(d);
  let s: LevelPlayState = startLevelPlay(p, tomb.id);
  const items = levelsOf(p).items;
  const item = (id: string) => items.find((i) => i.id === id)!;
  const out: TombStep[] = [];
  const snapshot = (): TombStep['expect'] => ({
    open: Object.fromEntries(allDoors.map((g) => [g, isOpen(p, s, item(g))])),
    objectives: Object.keys(s.structure?.objectives ?? {}).filter((k) => s.structure!.objectives[k]).sort(),
    complete: !!s.structure?.complete,
    flags: { [key(tomb.plundered)]: s.world.flags[tomb.plundered] ?? '' },
  });
  const plan = (x: number, y: number): [number, number, number] => [x, 0, y];
  const offer = (guid: string, at: [number, number, number]) => {
    const o = offerFor(p, s, item(guid), undefined, { x: at[0], y: at[2] });
    out.push({ do: 'offer', guid, at, expect: { verb: o?.verb ?? '', ...(o?.blocked ? { blocked: o.blocked } : {}) } });
  };
  const use = (guid: string, at: [number, number, number]) => {
    s = interactWith(p, s, guid, undefined, { x: at[0], y: at[2] });
    s = tick(p, s, 0.05, { x: at[0], y: at[2], z: at[1] });
    out.push({ do: 'interact', guid, at, expect: snapshot() });
  };
  const wait = (seconds: number, at: [number, number, number]) => {
    for (let t = 0; t < seconds - 1e-9; t += 0.25) s = tick(p, s, Math.min(0.25, seconds - t), { x: at[0], y: at[2], z: at[1] });
    out.push({ do: 'wait', seconds, at, expect: snapshot() });
  };
  const hall = plan(-11, 0);
  offer(d.inner, hall);
  offer(d.vault, hall);
  use(d.vault, hall);
  offer(d.vault, hall);
  use(tomb.keyPickup, hall);
  offer(d.inner, hall);
  use(d.inner, hall);
  // Away from the Inner door: it shuts again after its 4 seconds.
  wait(5, plan(-13, -1.5));
  use(d.inner, hall);
  const chamber = plan(-3, 0);
  offer(d.rubble, chamber);
  use(d.rubble, chamber);
  // In the crypt: the last objective, and the tomb is complete.
  wait(0.5, plan(5, 0));
  // The back door opens from the Treasury, not from outside.
  offer(d.back, plan(-11, 7.5));
  offer(d.back, plan(-11, 10.5));
  // Leaving and coming back: everything as left.
  const world = leaveLevel(p, s);
  s = startLevelPlay(p, tomb.id, { world });
  out.push({ do: 'remember', at: hall, expect: snapshot() });
  return out;
};
