import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, GENERATOR_VERSION, LAYOUT_RULES, proposeLayout, type Proposal } from '../level/generate';
import { assetOf, frameOf } from '../level/geometry';
import { addLevel, levelsOf, placeAsset, setParam, updateItem } from '../level/level';
import { createStructure, floorCodes, structureGraph, structureIssues, type NewStructure } from '../level/structure';
import { addTravel } from '../level/travel';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import type { Project } from '../types';
import type { GeneratorSettings, LayoutRules, StructureType } from '../level/types';

const make = (type: StructureType, extra: Partial<NewStructure> = {}) => {
  const base = addLevel(createProject('Test'), 'Ancient Civilization');
  const lv = levelsOf(base.project).levels[0]!;
  const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type, seed: 5, ...extra });
  return { p: made.project, id: made.id };
};
const level = (p: Project, id: string) => levelsOf(p).levels.find((l) => l.id === id)!;
const floor = (p: Project, id: string, code: string) => {
  const l = level(p, id);
  const codes = floorCodes(l);
  return l.floors.find((f) => codes.get(f.id) === code)!;
};
const all = (p: Project, id: string) => level(p, id).floors.map((f) => f.id);
const propose = (p: Project, id: string, settings: Partial<GeneratorSettings> = {}, seed = 11, floorIds = all(p, id), areaId?: string): Proposal =>
  proposeLayout(p, { levelId: id, floorIds, seed, settings: { ...defaultGenerator(level(p, id).structure?.type), ...settings }, ...(areaId ? { areaId } : {}) });
const made = (pr: Proposal) => levelsOf(pr.project).items.filter((i) => pr.made.includes(i.id));
const layout = (pr: Proposal) => made(pr).map((i) => [i.assetId, i.name, i.floorId, i.x, i.y, i.size?.w, i.size?.d]);
/** What would stop it playing: structure warnings and errors, and the structure's preflight. */
const trouble = (pr: Proposal, id: string) => [
  ...structureIssues(levelsOf(pr.project), id).filter((i) => i.severity !== 'info').map((i) => i.message),
  ...levelIssues(pr.project).filter((i) => i.levelId === id).map((i) => i.message),
];

describe('the generator (structure spec §6)', () => {
  it('gives the same layout for the same seed and settings, and another for another seed', () => {
    const { p, id } = make('office');
    const a = propose(p, id, {}, 42);
    const b = propose(p, id, {}, 42);
    expect(layout(a)).toEqual(layout(b));
    expect(a.counts).toEqual(b.counts);
    expect(layout(propose(p, id, {}, 43))).not.toEqual(layout(a));
    expect(a.run).toMatchObject({ seed: 42, algorithmVersion: GENERATOR_VERSION, floorIds: all(p, id) });
  });

  it('lays out a five-storey office with every rule preset: every room reached, stairs through every floor, nothing to fix', () => {
    const { p, id } = make('office');
    for (const rules of LAYOUT_RULES.map((r) => r.id) as LayoutRules[]) {
      const pr = propose(p, id, { rules });
      expect(trouble(pr, id), rules).toEqual([]);
      expect(pr.counts.rooms, rules).toBeGreaterThan(10);
      // Basement to roof: six joins, each a flight of stairs in the core, lined up through the floors.
      const stairs = made(pr).filter((i) => i.assetId === 'arch.stairs');
      expect(stairs.map((x) => x.name), `${rules}: ${pr.problems.join(' | ')}`).toHaveLength(6);
      expect(new Set(stairs.map((s) => `${s.x},${s.y}`)).size, rules).toBe(1);
      const graph = structureGraph(levelsOf(pr.project), id);
      // The office is step-free: the walk between floors is by the lift, which stops at all seven.
      expect(graph.edges.filter((e) => e.kind === 'elevator'), rules).toHaveLength(6);
      expect(graph.edges.some((e) => e.from === 'outside' || e.to === 'outside'), rules).toBe(true);
    }
  });

  it('fits L, U, cross and octagon footprints, and keeps rooms inside them', () => {
    for (const [type, shape] of [['apartment', 'l'], ['fortress', 'u'], ['dungeon', 'cross'], ['temple', 'octagon']] as const) {
      const { p, id } = make(type, { shape });
      const pr = propose(p, id);
      expect(trouble(pr, id), `${type} ${shape}`).toEqual([]);
      expect(pr.counts.rooms, `${type} ${shape}`).toBeGreaterThan(3);
    }
  });

  it('uses a lift through every floor for a step-free structure, and ladders where ladders are the way', () => {
    const office = make('office');
    const pr = propose(office.p, office.id);
    const lift = made(pr).find((i) => i.assetId === 'arch.elevator')!;
    expect(lift).toBeTruthy();
    expect(lift.floorId).toBe(floor(office.p, office.id, 'B1').id);
    expect(trouble(pr, office.id)).toEqual([]);
    const bunker = make('bunker');
    const b = propose(bunker.p, bunker.id);
    expect(made(b).filter((i) => i.assetId === 'arch.ladder')).toHaveLength(3);
    expect(trouble(b, bunker.id)).toEqual([]);
  });

  it('thins a floor out by density, and grows rooms to fill it when full', () => {
    const { p, id } = make('office');
    const g = [floor(p, id, 'G').id];
    const full = propose(p, id, { rules: 'maze', density: 1 }, 3, g);
    const thin = propose(p, id, { rules: 'maze', density: 0.4 }, 3, g);
    const area = (pr: Proposal) => made(pr).filter((i) => assetOf(levelsOf(pr.project), i).kind === 'space').reduce((n, i) => n + (i.size?.w ?? 0) * (i.size?.d ?? 0), 0);
    expect(area(thin)).toBeLessThan(area(full) * 0.7);
  });
});

describe('path-first (structure spec §6, §18 Pyramid Quest)', () => {
  const pyramid = () => {
    const { p, id } = make('pyramid');
    let q = addTravel(p, { levelId: id, floorId: floor(p, id, 'G').id, kind: 'progression', points: [{ x: -22, y: 22 }, { x: -22, y: -10 }, { x: 8, y: -10 }, { x: 10, y: 14 }] }).project;
    q = addTravel(q, { levelId: id, floorId: floor(p, id, 'B1').id, kind: 'progression', points: [{ x: 10, y: 14 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }).project;
    return { p: q, id, floors: [floor(p, id, 'G').id, floor(p, id, 'B1').id] };
  };

  it('builds chambers at the route’s points and passages between them, a way in, dead ends and a secret branch', () => {
    const { p, id, floors } = pyramid();
    const pr = propose(p, id, {}, 3, floors);
    const items = made(pr);
    const ground = items.filter((i) => i.floorId === floors[0]);
    expect(ground.filter((i) => i.assetId === 'space.room').map((i) => i.name)).toEqual(expect.arrayContaining(['Entrance Hall', 'Chamber 1', 'Chamber 2', 'Relic Chamber']));
    // Each chamber is on its point.
    const hall = ground.find((i) => i.name === 'Entrance Hall')!;
    expect(Math.hypot(hall.x + 22, hall.y - 22)).toBeLessThan(3);
    expect(ground.filter((i) => i.assetId === 'space.corridor').length).toBeGreaterThanOrEqual(3);
    expect(items.some((i) => i.name === 'Dead End')).toBe(true);
    const secret = items.find((i) => i.name === 'Secret door')!;
    expect(secret.tags).toEqual(['secret']);
    expect(items.some((i) => i.name === 'Hidden Chamber')).toBe(true);
    // The way in is on an outside wall, through the entrance hall (by a passage out if it doesn't reach one).
    expect(ground.filter((i) => i.name === 'Way in')).toHaveLength(1);
    // The basement's first chamber sits under the ground floor's last: a shaft with a ladder joins them.
    const shaft = items.find((i) => i.assetId === 'arch.ladder')!;
    expect(shaft.floorId).toBe(floors[1]);
    expect(trouble(pr, id)).toEqual([]);
    expect(structureGraph(levelsOf(pr.project), id).unreachable).toEqual([]);
  });

  it('lays out nothing on a floor with no route, and says so', () => {
    const { p, id } = make('pyramid');
    const pr = propose(p, id, {}, 3, [floor(p, id, 'G').id]);
    expect(pr.problems).toContain('Ground floor has no route drawn, so nothing was laid out there. Draw a Progression path on it, or lay it out plan-first.');
    expect(pr.counts.rooms).toBe(0);
    // Plan-first lays it out.
    expect(propose(p, id, { mode: 'plan' }, 3, [floor(p, id, 'G').id]).counts.rooms).toBeGreaterThan(5);
  });
});

describe('never overwriting the designer’s work (structure spec §3, §6)', () => {
  it('keeps rooms placed by hand, lays out round them, and joins them to the new layout', () => {
    const { p, id } = make('office');
    const g = floor(p, id, 'G').id;
    const mine = placeAsset(p, id, g, 'space.room', { x: -11, y: 6 }, { name: 'My Lab' });
    const pr = propose(mine.project, id, {}, 7, [g]);
    expect(levelsOf(pr.project).items.some((i) => i.id === mine.ids[0])).toBe(true);
    expect(trouble(pr, id)).toEqual([]);
    expect(pr.run.lockedElementIds).toContain(mine.ids[0]);
  });

  it('replaces only what it made and nobody changed; keeps locked and edited rooms, and says why', () => {
    const { p, id } = make('custom', { w: 30, d: 20, above: 1, below: 0, roof: false });
    const g = floor(p, id, 'G').id;
    const first = propose(p, id, { rules: 'maze' }, 1, [g]);
    let q = acceptLayout(first, '2026-10-14T00:00:00Z');
    expect(level(q, id).generation).toHaveLength(1);
    expect(level(q, id).generation![0]).toMatchObject({ seed: 1, acceptedAt: '2026-10-14T00:00:00Z' });
    const rooms = made(first).filter((i) => i.assetId === 'space.room');
    const locked = rooms[0]!;
    const edited = rooms[1]!;
    q = updateItem(q, locked.id, { locked: true });
    q = updateItem(q, edited.id, { name: 'The Vault' });
    const again = propose(q, id, { rules: 'maze' }, 2, [g]);
    const ids = new Set(levelsOf(again.project).items.map((i) => i.id));
    expect(ids.has(locked.id)).toBe(true);
    expect(ids.has(edited.id)).toBe(true);
    expect(again.kept.map((k) => k.why)).toEqual(expect.arrayContaining([`${locked.name} is locked.`, 'The Vault was changed since it was generated.']));
    // Everything else from the first run is gone and made again.
    for (const r of rooms.slice(2)) expect(ids.has(r.id)).toBe(false);
    expect(trouble(again, id)).toEqual([]);
  });

  it('regenerates one floor and leaves the others as they are, the stairs still meeting', () => {
    const { p, id } = make('office');
    const whole = acceptLayout(propose(p, id, {}, 9));
    const f3 = floor(whole, id, '3').id;
    const others = levelsOf(whole).items.filter((i) => i.levelId === id && i.floorId !== f3).map((i) => i.id).sort();
    const pr = propose(whole, id, { rules: 'hub' }, 10, [f3]);
    expect(levelsOf(pr.project).items.filter((i) => i.levelId === id && i.floorId !== f3).map((i) => i.id).sort()).toEqual(others);
    expect(made(pr).every((i) => i.floorId === f3)).toBe(true);
    expect(trouble(pr, id)).toEqual([]);
  });

  it('lays out the inside of a generated room on its own (a wing), joined to its neighbours', () => {
    const { p, id } = make('custom', { w: 30, d: 20, above: 1, below: 0, roof: false });
    const g = floor(p, id, 'G').id;
    const first = acceptLayout(propose(p, id, { rules: 'linear', roomMax: 12, roomMin: 8 }, 4, [g]));
    const big = levelsOf(first).items.filter((i) => i.levelId === id && i.generated && i.assetId === 'space.room').sort((a, b) => (b.size!.w! * b.size!.d!) - (a.size!.w! * a.size!.d!))[0]!;
    const pr = propose(first, id, { rules: 'maze', roomMin: 3, roomMax: 5 }, 5, [g], big.id);
    expect(pr.removed).toContain(big.id);
    const f = frameOf(levelsOf(first), big);
    for (const i of made(pr).filter((x) => x.assetId === 'space.room')) {
      expect(Math.abs(i.x - f.x)).toBeLessThanOrEqual(f.w / 2);
      expect(Math.abs(i.y - f.y)).toBeLessThanOrEqual(f.d / 2);
    }
    expect(trouble(pr, id)).toEqual([]);
  });
});

describe('impossible requests are reported, not left broken (structure spec §6)', () => {
  it('reports a footprint too small for its rooms instead of making disconnected spaces', () => {
    const { p, id } = make('custom', { w: 3, d: 3, above: 2, below: 0 });
    const pr = propose(p, id, { roomMin: 4, roomMax: 6 });
    expect(pr.problems.length).toBeGreaterThan(0);
    expect(structureGraph(levelsOf(pr.project), id).unreachable).toEqual([]);
  });

  it('says when a route point is outside the footprint', () => {
    const { p, id } = make('pyramid');
    const q = addTravel(p, { levelId: id, floorId: floor(p, id, 'G').id, kind: 'progression', points: [{ x: -20, y: 20 }, { x: 80, y: 0 }] }).project;
    const pr = propose(q, id, {}, 1, [floor(p, id, 'G').id]);
    expect(pr.problems.some((m) => m.includes('outside the footprint'))).toBe(true);
  });

  it('marks generated items, so a door changed by hand is the designer’s from then on', () => {
    const { p, id } = make('custom', { above: 1, below: 0 });
    const pr = propose(p, id);
    expect(made(pr).every((i) => i.generated === pr.run.id)).toBe(true);
    const door = made(pr).find((i) => i.assetId === 'arch.door')!;
    const accepted = setParam(acceptLayout(pr), door.id, 'startsOpen', true);
    const again = propose(accepted, id, {}, 99);
    expect(again.kept.some((k) => k.id === door.id)).toBe(true);
  });
});
