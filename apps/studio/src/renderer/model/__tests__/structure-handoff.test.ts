import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { levelChanges, levelRevisions } from '../handoff/levels';
import { meshesFor } from '../level/geometry';
import { levelsOf, placeAsset, setParam } from '../level/level';
import { interactWith, leaveLevel, startLevelPlay, startPoint, tick } from '../level/play';
import { withTomb } from '../level/sample-structure';
import { floorLift, graphLines, stackMeshes } from '../level/stack';
import { addRoof, structureGraph } from '../level/structure';
import { sunkenVault } from '../sample';

const tomb = () => withTomb(sunkenVault());

describe('stacked floors in 3D (structure spec §12)', () => {
  it('cuts away the floors above and the ceiling of the floor being worked on, or spreads the floors apart', () => {
    const t = tomb();
    const roofed = addRoof(t.project, t.id);
    const terrace = placeAsset(roofed.project, t.id, roofed.id, 'space.room', { x: 0, y: 0 }, { name: 'Terrace' });
    const set = levelsOf(terrace.project);
    const level = set.levels.find((l) => l.id === t.id)!;
    const all = meshesFor(set, t.id, { ceilings: true });
    const roofItems = new Set(set.items.filter((i) => i.floorId === roofed.id).map((i) => i.id));
    expect(all.some((m) => roofItems.has(m.itemId))).toBe(true);
    const cut = stackMeshes(set, t.id, all, t.floorId, 'cutaway');
    expect(cut.some((m) => roofItems.has(m.itemId))).toBe(false);
    expect(cut.some((m) => m.part === 'ceiling')).toBe(false);
    expect(cut.some((m) => m.part === 'wall')).toBe(true);
    // Spread apart: the ground floor stays, the roof goes up a floor's height and more.
    expect(floorLift(level, t.floorId, 'exploded')).toBe(0);
    expect(floorLift(level, roofed.id, 'exploded')).toBe(3);
    const spread = stackMeshes(set, t.id, all, t.floorId, 'exploded');
    const roofMesh = all.find((m) => roofItems.has(m.itemId))!;
    expect(spread.find((m) => m.key === roofMesh.key)!.y).toBeCloseTo(roofMesh.y + 3);
  });

  it('draws the structure graph in 3D: a line for every connection, one way doors and the outside included', () => {
    const t = tomb();
    const set = levelsOf(t.project);
    const lines = graphLines(set, t.id, t.floorId, 'all');
    expect(lines).toHaveLength(structureGraph(set, t.id).edges.length);
    const back = lines.find((l) => l.id.startsWith(`${t.doors.back}:`))!;
    expect(back.oneWay).toBe(true);
    // The outside end is out beyond the door, north of the Treasury.
    expect(Math.max(back.from[2], back.to[2])).toBeGreaterThan(9);
    expect(lines.find((l) => l.id.startsWith(`${t.doors.vault}:`))!.secret).toBe(true);
  });
});

describe('rough play through a structure (structure spec §12, §16)', () => {
  it('goes in from its mass on the parent map, and back out beside it, with state kept both ways', () => {
    const t = tomb();
    const set = levelsOf(t.project);
    const mass = set.items.find((i) => i.id === t.massId)!;
    // A coin on the parent map, beside the tomb.
    const coin = placeAsset(t.project, mass.levelId, mass.floorId, 'play.pickup', { x: 95, y: 120 }, { name: 'Coin' });
    const p = coin.project;
    let s = startLevelPlay(p, mass.levelId);
    s = interactWith(p, s, coin.ids[0]!);
    expect(s.gone[coin.ids[0]!]).toBe(true);
    // Enter, from the west of the mass: just inside the Front door, facing in.
    s = interactWith(p, s, t.massId, undefined, { x: 98, y: 120 });
    expect(s.goTo).toBe(t.id);
    expect(s.arrival).toMatchObject({ floorId: t.floorId });
    expect(s.arrival!.x).toBeCloseTo(-13.5);
    expect(s.arrival!.y).toBeCloseTo(0);
    expect(s.arrival!.yaw).toBeCloseTo(Math.PI / 2);
    // Inside: take the key, then walk out of the front door and past the footprint.
    let inside = startLevelPlay(p, t.id, { world: leaveLevel(p, s) });
    inside = interactWith(p, inside, t.keyPickup);
    inside = tick(p, inside, 0.1, { x: -19, y: 0, z: 0 });
    expect(inside.goTo).toBeUndefined();
    inside = tick(p, inside, 0.1, { x: -21.5, y: 0, z: 0 });
    expect(inside.goTo).toBe(mass.levelId);
    // Beside the mass on the parent, on the west, facing away.
    expect(inside.arrival!.x).toBeCloseTo(120 - 21.5);
    expect(inside.arrival!.y).toBeCloseTo(120);
    expect(inside.arrival!.yaw).toBeCloseTo(-Math.PI / 2);
    // Back on the parent map: the coin is still gone; and in the tomb again, the key is too.
    const back = startLevelPlay(p, mass.levelId, { world: leaveLevel(p, inside) });
    expect(back.gone[coin.ids[0]!]).toBe(true);
    const again = startLevelPlay(p, t.id, { world: leaveLevel(p, back) });
    expect(again.gone[t.keyPickup]).toBe(true);
    expect(again.world.places?.[t.id]?.visits).toBe(1);
  });

  it('starts a structure with no way in where it says, and a map with no memory as it starts', () => {
    const t = tomb();
    const s = startLevelPlay(t.project, t.id);
    expect(s.log.some((l) => l.text.startsWith('Back in'))).toBe(false);
    expect(startPoint(t.project, t.id).floorId).toBe(t.floorId);
  });
});

describe('the structure manifest (structure spec §13, §14)', () => {
  it('goes to the engines with the structure’s floors, rooms, connections, door rules and objectives, by id', () => {
    const t = tomb();
    const ir = buildIR(t.project);
    const level = ir.levels.find((l) => l.guid === t.id)!;
    const m = level.structure!;
    expect(m).toMatchObject({ type: 'dungeon', traversal: 'mixed', mass: t.massId, persist: { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'keep' } });
    expect(m.floors).toEqual([{ key: level.floors[0]!.key, code: 'G', kind: 'ground', elevation: 0, height: 3, footprint: [[-20, -15], [20, -15], [20, 15], [-20, 15]] }]);
    expect(m.spaces.map((s) => s.name).sort()).toEqual(['Burial Chamber', 'Crypt', 'Entrance Hall', 'Sanctum', 'Treasury']);
    expect(m.entrances.sort()).toEqual([t.doors.back, t.doors.front].sort());
    const keyKey = level.items.find((i) => i.guid === t.keyPickup)!.params.item;
    expect(m.doors.find((d) => d.guid === t.doors.inner)).toMatchObject({ locked: true, key: keyKey, open_for: 4, secret: false, breakable: false });
    expect(m.doors.find((d) => d.guid === t.doors.vault)).toMatchObject({ secret: true, locked: false });
    expect(m.doors.find((d) => d.guid === t.doors.rubble)).toMatchObject({ locked: true, breakable: true, break_with: null });
    expect(m.doors.find((d) => d.guid === t.doors.back)!.one_way).not.toBeNull();
    expect(m.connections.find((c) => c.via === t.doors.back)).toMatchObject({ to: 'outside', one_way: true });
    expect(m.objectives.map((o) => [o.id, o.at, !!o.when])).toEqual([
      ['find_key', null, true],
      ['reach_crypt', t.rooms.crypt, false],
    ]);
    expect(m.on_complete).toEqual([{ kind: 'setFlag', ref: expect.any(String), value: 'yes' }]);
    expect(m.walkthrough[0]).toBe('Come in from outside.');
    expect(m.walkthrough).toContain('Break Rubble door open.');
  });

  it('re-exports by id: a changed door rule changes the door and the structure manifest, nothing else', () => {
    const t = tomb();
    const before = levelRevisions(buildIR(t.project).levels);
    expect(before[`structure:${t.id}`]).toBeTruthy();
    const after = buildIR(setParam(t.project, t.doors.front, 'openFor', 10)).levels;
    const changes = levelChanges(after, before);
    expect(changes.changed.sort()).toEqual([t.doors.front, `structure:${t.id}`].sort());
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    // The same project again is the same export.
    expect(levelRevisions(buildIR(t.project).levels)).toEqual(before);
  });
});
