import { describe, expect, it } from 'vitest';
import { assetOf, frameOf } from '../level/geometry';
import { syncBuildings } from '../level/hierarchy';
import { addFloor, levelsOf, placeAsset, resizeItem, setParam, updateFloor } from '../level/level';
import { addBasement, addRoof, createStructure, floorCodes, footprintOf, OUTSIDE, structureGraph, structureIssues, updateStructure, STRUCTURE_PRESETS } from '../level/structure';
import { createProject } from '../project';
import { addLevel } from '../level/level';
import type { Project } from '../types';

const base = () => {
  const made = addLevel(createProject('Test'), 'Ancient Civilization');
  const set = levelsOf(made.project);
  return { project: made.project, levelId: made.id, floorId: set.levels[0]!.floors[0]!.id };
};

const map = (p: Project, id: string) => levelsOf(p).levels.find((l) => l.id === id)!;
const floorByCode = (p: Project, id: string, code: string) => {
  const codes = floorCodes(map(p, id));
  return map(p, id).floors.find((f) => codes.get(f.id) === code)!;
};
const put = (p: Project, levelId: string, floorId: string, asset: string, x: number, y: number, name?: string) => {
  const made = placeAsset(p, levelId, floorId, asset, { x, y }, { name });
  return { p: made.project, id: made.ids[0]! };
};

describe('making a structure (structure spec §2, §5)', () => {
  it('has a preset for each kind of structure the spec names', () => {
    expect(STRUCTURE_PRESETS.map((s) => s.id)).toEqual(['pyramid', 'temple', 'fortress', 'office', 'apartment', 'industrial', 'bunker', 'dungeon', 'custom']);
  });

  it('adds a pyramid to a level: its mass, its map, basements to the top, a stepped footprint on every floor', () => {
    const { project, levelId, floorId } = base();
    const made = createStructure(project, { parentId: levelId, floorId, at: { x: 100, y: 50 }, type: 'pyramid', name: 'Pyramid A', seed: 42 });
    const p = made.project;
    const set = levelsOf(p);
    const mass = set.items.find((i) => i.id === made.massId)!;
    expect(mass).toMatchObject({ levelId, assetId: 'struct.pyramid', name: 'Pyramid A', size: { w: 60, d: 60, h: 18 }, params: { floors: 3, floorHeight: 6 } });
    const pyramid = map(p, made.id);
    expect(pyramid).toMatchObject({ kind: 'building', parentId: levelId, anchorId: made.massId, structure: { type: 'pyramid', traversal: 'mixed', seed: 42 } });
    const sorted = [...pyramid.floors].sort((a, b) => a.elevation - b.elevation);
    expect(sorted.map((f) => [f.name, f.elevation, floorCodes(pyramid).get(f.id)])).toEqual([
      ['Basement 1', -6, 'B1'],
      ['Ground floor', 0, 'G'],
      ['Floor 2', 6, '2'],
      ['Floor 3', 12, '3'],
    ]);
    // Each floor up is drawn in 8 m on every side.
    const widths = sorted.map((f) => {
      const fp = set.items.find((i) => i.levelId === made.id && i.floorId === f.id && assetOf(set, i).role === 'footprint')!;
      return frameOf(set, fp).w;
    });
    expect(widths).toEqual([60, 60, 44, 28]);
    expect(footprintOf(set, pyramid, sorted[2]!.id)).toHaveLength(4);
  });

  it('gives a fortress a U-shaped footprint, and an office a roof over five floors and a car park', () => {
    const { project, levelId, floorId } = base();
    const fort = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'fortress' });
    const set = levelsOf(fort.project);
    const fp = set.items.find((i) => i.levelId === fort.id && assetOf(set, i).role === 'footprint')!;
    expect(fp.outline).toHaveLength(8);
    const office = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'office', name: 'Tower' });
    const codes = floorCodes(map(office.project, office.id));
    expect([...map(office.project, office.id).floors].sort((a, b) => a.elevation - b.elevation).map((f) => codes.get(f.id))).toEqual(['B1', 'G', '2', '3', '4', '5', 'R']);
  });

  it('keeps the mass in step with the storeys only: basements and the roof stand outside the count', () => {
    const { project, levelId, floorId } = base();
    const made = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'office' });
    // A floor added in the building goes under the roof; the roof goes up; the mass counts six storeys.
    const added = addFloor(made.project, made.id);
    const after = syncBuildings(made.project, added.project);
    const office = map(after, made.id);
    const roof = office.floors.find((f) => f.kind === 'roof')!;
    const sixth = office.floors.find((f) => f.id === added.id)!;
    expect([sixth.name, sixth.elevation, sixth.kind]).toEqual(['Floor 6', 17.5, 'upper']);
    expect(roof.elevation).toBe(21);
    const mass = levelsOf(after).items.find((i) => i.id === made.massId)!;
    expect([mass.params?.floors, mass.size?.h]).toEqual([6, 21]);
    // Raising the mass's Floors adds storeys under the roof too.
    const raised = syncBuildings(after, setParam(after, made.massId, 'floors', 8));
    const tall = map(raised, made.id);
    expect(tall.floors.filter((f) => f.kind === 'upper' || f.kind === 'ground')).toHaveLength(8);
    expect(tall.floors.find((f) => f.kind === 'roof')!.elevation).toBe(28);
    expect(tall.floors.filter((f) => f.kind === 'basement')).toHaveLength(1);
  });

  it('adds basements below and one roof on top', () => {
    const { project, levelId, floorId } = base();
    const made = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'custom', above: 2, below: 0, floorHeight: 3, roof: false });
    let p = addBasement(made.project, made.id).project;
    p = addBasement(p, made.id).project;
    const roofed = addRoof(p, made.id);
    expect(addRoof(roofed.project, made.id).id).toBe(roofed.id);
    const s = map(roofed.project, made.id);
    const codes = floorCodes(s);
    expect([...s.floors].sort((a, b) => a.elevation - b.elevation).map((f) => [codes.get(f.id), f.elevation])).toEqual([
      ['B2', -6],
      ['B1', -3],
      ['G', 0],
      ['2', 3],
      ['R', 6],
    ]);
  });

  it('records what the structure is for, and its scene', () => {
    const { project, levelId, floorId } = base();
    const made = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'temple' });
    const p = updateStructure(made.project, made.id, { purpose: 'The sun cult’s hall', traversal: 'accessible', scene: 'scene-1' });
    expect(map(p, made.id).structure).toMatchObject({ type: 'temple', purpose: 'The sun cult’s hall', traversal: 'accessible', scene: 'scene-1' });
    expect(map(updateStructure(p, made.id, { scene: '' }), made.id).structure!.scene).toBeUndefined();
  });
});

/** A small building: two rooms and an entrance on the ground, a room upstairs by the stairs, and a sealed room. */
const building = () => {
  const { project, levelId, floorId } = base();
  const made = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'custom', w: 30, d: 20, above: 2, below: 0, floorHeight: 3, roof: false });
  const id = made.id;
  const g = floorByCode(made.project, id, 'G').id;
  const up = floorByCode(made.project, id, '2').id;
  let p = made.project;
  let r = put(p, id, g, 'space.room', -11, 0, 'Entrance Hall');
  p = r.p;
  const hall = r.id;
  r = put(p, id, g, 'space.room', -3, 0, 'False Tomb');
  p = r.p;
  const tomb = r.id;
  r = put(p, id, g, 'arch.door', -15, 0, 'Front door');
  p = r.p;
  const front = r.id;
  r = put(p, id, g, 'arch.door', -7, 1, 'Inner door');
  p = r.p;
  const inner = r.id;
  r = put(p, id, g, 'arch.stairs', -9, 0, 'Stairs up');
  p = r.p;
  const stairs = r.id;
  r = put(p, id, up, 'space.room', -11, -1, 'Relic Chamber');
  p = r.p;
  const relic = r.id;
  r = put(p, id, up, 'space.room', 10, 5, 'Sealed Room');
  p = r.p;
  const sealed = r.id;
  return { p, id, g, up, hall, tomb, front, inner, stairs, relic, sealed };
};

describe('the structure graph (structure spec §8, §13)', () => {
  it('joins rooms by their doors, the outside by an entrance, and floors by the stairs', () => {
    const b = building();
    const graph = structureGraph(levelsOf(b.p), b.id);
    expect(graph.nodes.map((n) => n.name).sort()).toEqual(['Entrance Hall', 'False Tomb', 'Relic Chamber', 'Sealed Room']);
    const pair = (e: { from: string; to: string }) => [e.from, e.to].sort().join('|');
    const via = (id: string) => graph.edges.find((e) => e.via === id)!;
    expect(pair(via(b.front))).toBe([b.hall, OUTSIDE].sort().join('|'));
    expect(pair(via(b.inner))).toBe([b.hall, b.tomb].sort().join('|'));
    expect(via(b.stairs)).toMatchObject({ from: b.hall, to: b.relic, kind: 'stairs', vertical: true });
    expect(graph.start).toBe(OUTSIDE);
    expect(graph.unreachable).toEqual([b.sealed]);
  });

  it('counts only the ways between floors the traversal style allows', () => {
    const b = building();
    const stepFree = updateStructure(b.p, b.id, { traversal: 'accessible' });
    const graph = structureGraph(levelsOf(stepFree), b.id);
    expect(graph.edges.some((e) => e.kind === 'stairs')).toBe(false);
    expect(graph.unreachable.sort()).toEqual([b.relic, b.sealed].sort());
    // A lift joins them again.
    const lift = put(stepFree, b.id, b.g, 'arch.elevator', -13, -2, 'Lift');
    const lifted = structureGraph(levelsOf(lift.p), b.id);
    expect(lifted.edges.find((e) => e.via === lift.id)).toMatchObject({ from: b.hall, to: b.relic, kind: 'elevator' });
    expect(lifted.unreachable).toEqual([b.sealed]);
  });

  it('marks a locked door as gated, and a ladder as a way up', () => {
    const b = building();
    const locked = setParam(b.p, b.inner, 'keyItem', 'item-key');
    expect(structureGraph(levelsOf(locked), b.id).edges.find((e) => e.via === b.inner)!.gated).toBe(true);
    const ladder = put(b.p, b.id, b.up, 'arch.ladder', 10, 5, 'Rope');
    // A ladder on floor 2 rises to no floor (there is none above): it joins nothing.
    expect(structureGraph(levelsOf(ladder.p), b.id).edges.some((e) => e.via === ladder.id)).toBe(false);
  });
});

describe('structure validation (structure spec §8, §15)', () => {
  it('reports unreachable rooms, rooms outside the footprint, stairs that reach no floor, and overlapping floors', () => {
    const b = building();
    let issues = structureIssues(levelsOf(b.p), b.id);
    expect(issues.map((i) => i.message)).toEqual(['No way to reach Sealed Room on Floor 2 (2) (with stairs only).']);
    // The sealed room pushed out past the footprint's edge (the footprint is 30 × 20, centred).
    let p = resizeItem(b.p, b.sealed, { w: 14 });
    issues = structureIssues(levelsOf(p), b.id);
    expect(issues.some((i) => i.id === b.sealed && i.message.includes('outside the footprint of Floor 2 (2)'))).toBe(true);
    // Stairs a metre short.
    p = resizeItem(p, b.stairs, { h: 2 });
    issues = structureIssues(levelsOf(p), b.id);
    expect(issues.find((i) => i.id === b.stairs)!.message).toBe('Stairs up rises 2 m and reaches no floor: line its height up with the floor above.');
    expect(issues.some((i) => i.message.startsWith('No way to reach Relic Chamber'))).toBe(true);
    // Floors whose heights overlap.
    p = updateFloor(p, b.id, b.up, { elevation: 2 });
    expect(structureIssues(levelsOf(p), b.id).find((i) => i.severity === 'error')!.message).toBe('Floor 2 starts 1 m inside Ground floor: their heights overlap.');
  });

  it('says when there is no way in at all', () => {
    const { project, levelId, floorId } = base();
    const made = createStructure(project, { parentId: levelId, floorId, at: { x: 0, y: 0 }, type: 'custom' });
    const g = floorByCode(made.project, made.id, 'G').id;
    const p = put(made.project, made.id, g, 'space.room', 0, 0, 'Vault').p;
    expect(structureIssues(levelsOf(p), made.id).map((i) => i.message)).toContain('Blank structure has no way in: put a door in an outside wall, a portal, or a player start.');
  });
});

describe('a structure in the export (until MVP 4 gives it its own manifest)', () => {
  it('goes to every engine as a building map with its floors and footprints, no errors', async () => {
    const { planHandoff, setTarget } = await import('../handoff');
    const { sunkenVault } = await import('../sample');
    let p = sunkenVault();
    const set = levelsOf(p);
    const level = set.levels.find((l) => !l.parentId)!;
    const made = createStructure(p, { parentId: level.id, floorId: level.floors[0]!.id, at: { x: 200, y: 200 }, type: 'pyramid', name: 'Royal Pyramid' });
    p = made.project;
    const g = floorByCode(p, made.id, 'G').id;
    p = put(p, made.id, g, 'space.room', -26, 0, 'Entrance Hall').p;
    p = put(p, made.id, g, 'arch.door', -30, 0, 'Way in').p;
    for (const engine of ['godot', 'unity', 'unreal', 'custom'] as const) {
      const plan = planHandoff(setTarget(p, { engine }));
      expect(plan.output, engine).toBeTruthy();
      expect(plan.levels.some((l) => l.name === 'Royal Pyramid'), engine).toBe(true);
    }
    expect(structureIssues(levelsOf(p), made.id).filter((i) => i.severity !== 'info')).toEqual([]);
  });
});
