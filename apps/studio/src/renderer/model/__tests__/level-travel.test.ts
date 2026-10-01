import { describe, expect, it } from 'vitest';
import { categoryAtScale, createWorld, opensAsMap, openChildMap, removeMap, scaleOf } from '../level/hierarchy';
import { findAsset, STARTER } from '../level/library';
import { levelsOf, moveItems, placeAsset, removeItems } from '../level/level';
import { addTravel, canTravel, moveTravelPoint, removeTravel, travelAt, travelLabel, travelLength, travelOf, travelPoints, updateTravel } from '../level/travel';
import { emptyState } from '../rules';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const worldWithTwoPlaces = () => {
  let { project, id } = createWorld(sunkenVault(), { preset: 'small', name: 'Coast' });
  const floorId = levelsOf(project).levels.find((l) => l.id === id)!.floors[0]!.id;
  const a = placeAsset(project, id, floorId, 'world.destination', { x: -2000, y: 0 }, { name: 'Harbour' });
  const b = placeAsset(a.project, id, floorId, 'town.city', { x: 2000, y: 1500 }, { name: 'Old City' });
  project = b.project;
  return { project, worldId: id, floorId, harbour: a.ids[0]!, city: b.ids[0]! };
};

describe('travel links (Level Designer spec V2 §5, §13)', () => {
  it('join places on a map, follow them when they move, and keep their ends when they go', () => {
    const { project: p0, worldId, floorId, harbour, city } = worldWithTwoPlaces();
    const made = addTravel(p0, { levelId: worldId, floorId, kind: 'road', points: [{ x: -2000, y: 0 }, { x: 0, y: 1000 }, { x: 2000, y: 1500 }], from: harbour, to: city });
    let project: Project = made.project;
    let set = levelsOf(project);
    const link = travelOf(set, worldId)[0]!;
    expect(link).toMatchObject({ kind: 'road', from: harbour, to: city, transition: 'walk' });
    expect(travelLabel(set, link)).toBe('Road: Harbour → Old City');
    expect(Math.round(travelLength(travelPoints(set, link)))).toBe(Math.round(Math.hypot(2000, 1000) + Math.hypot(2000, 500)));
    expect(travelAt(set, city).map((t) => t.id)).toEqual([made.id]);
    // The city moves: the road's end goes with it; the bend stays.
    project = moveItems(project, [city], 0, 500);
    set = levelsOf(project);
    expect(travelPoints(set, travelOf(set, worldId)[0]!)).toEqual([{ x: -2000, y: 0 }, { x: 0, y: 1000 }, { x: 2000, y: 2000 }]);
    // Dragging an end by hand lets go of its place.
    expect(travelOf(levelsOf(moveTravelPoint(project, made.id, 0, { x: -2500, y: 0 })), worldId)[0]).toMatchObject({ points: [{ x: -2500, y: 0 }, expect.anything(), expect.anything()] });
    expect(travelOf(levelsOf(moveTravelPoint(project, made.id, 0, { x: -2500, y: 0 })), worldId)[0]!.from).toBeUndefined();
    // The city is deleted: the road ends where it stood.
    project = removeItems(project, [city]);
    set = levelsOf(project);
    expect(travelOf(set, worldId)[0]!.to).toBeUndefined();
    expect(travelOf(set, worldId)[0]!.points.at(-1)).toEqual({ x: 2000, y: 2000 });
    expect(travelOf(levelsOf(removeTravel(project, [made.id])), worldId)).toEqual([]);
    // Deleting the map takes its links.
    expect(levelsOf(removeMap(project, worldId)).travel).toEqual([]);
  });

  it('can be locked until a rule holds, one way, and lead to another map', () => {
    const { project: p0, worldId, floorId, harbour, city } = worldWithTwoPlaces();
    const made = addTravel(p0, { levelId: worldId, floorId, kind: 'fastTravel', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], from: harbour, to: city });
    const vault = levelsOf(p0).levels[0]!;
    const key = Object.values(p0.objects).find((o) => o.name === 'Vault Key')!.id;
    let project = updateTravel(made.project, made.id, { locked: true, oneWay: true, toMap: vault.id, unlockWhen: { match: 'all', items: [{ kind: 'item', ref: key, op: 'has' }] } });
    const link = travelOf(levelsOf(project), worldId)[0]!;
    expect(link).toMatchObject({ transition: 'fade', oneWay: true, toMap: vault.id });
    expect(travelLabel(levelsOf(project), link)).toBe('Fast travel: Harbour → Sunken Vault');
    expect(canTravel(link, emptyState())).toBe(false);
    expect(canTravel(link, { ...emptyState(), items: { [key]: 1 } })).toBe(true);
    project = updateTravel(project, made.id, { unlockWhen: undefined });
    expect(canTravel(travelOf(levelsOf(project), worldId)[0]!, { ...emptyState(), items: { [key]: 1 } })).toBe(false);
    expect(canTravel({ ...link, locked: undefined }, emptyState())).toBe(true);
    // A map removed: links that led there lose the destination.
    expect(travelOf(levelsOf(removeMap(project, vault.id)), worldId)[0]!.toMap).toBeUndefined();
  });
});

describe('tools for the scale (spec V2 §7, §9)', () => {
  it('shows world tools on a world, town tools in a district, rooms and furniture in a building', () => {
    expect(['world', 'region', 'level', 'district', 'building', 'interior'].map((k) => scaleOf(k as never))).toEqual(['world', 'world', 'level', 'city', 'building', 'building']);
    expect(categoryAtScale('world', 'world')).toBe(true);
    expect(categoryAtScale('world', 'props')).toBe(false);
    expect(categoryAtScale('city', 'settlement')).toBe(true);
    expect(categoryAtScale('building', 'settlement')).toBe(false);
    expect(categoryAtScale('building', 'props')).toBe(true);
    expect(categoryAtScale('level', 'world')).toBe(false);
    expect(categoryAtScale('level', 'props')).toBe(true);
  });

  it('has world, town, structure and room presets with editable parameters', () => {
    const ids = STARTER.map((a) => a.id);
    for (const id of ['world.region', 'world.biome', 'world.streaming', 'world.destination', 'world.landmark', 'world.entrance', 'world.node', 'town.city', 'town.dungeon', 'town.block', 'town.road', 'town.terrain', 'town.vegetation', 'struct.mass', 'struct.house', 'struct.tower', 'struct.castle', 'struct.shop', 'struct.temple', 'struct.pyramid', 'struct.dungeonModule', 'space.corridor', 'space.lobby', 'space.warehouse', 'space.cave', 'space.greatHall'])
      expect(ids).toContain(id);
    expect(findAsset('world.destination')!.params.find((p) => p.key === 'classification')).toMatchObject({ default: 'Level', options: ['Level', 'Area', 'Hub', 'Landmark', 'Transition', 'Custom'] });
    expect(findAsset('struct.tower')!.params.find((p) => p.key === 'floors')).toMatchObject({ default: 6 });
    expect(findAsset('world.region')!.size).toMatchObject({ w: 5000, d: 5000 });
  });

  it('opens a place as the map it says: a region, a town as a district, a house as a building', () => {
    const { project, city, harbour } = worldWithTwoPlaces();
    const set = levelsOf(project);
    expect(opensAsMap(set, city)).toBe(true);
    const town = openChildMap(project, city);
    expect(levelsOf(town.project).levels.find((l) => l.id === town.id)).toMatchObject({ kind: 'district', name: 'Old City' });
    const dest = openChildMap(project, harbour);
    expect(levelsOf(dest.project).levels.find((l) => l.id === dest.id)!.kind).toBe('level');
    const lot = levelsOf(town.project).levels.find((l) => l.id === town.id)!;
    const house = placeAsset(town.project, lot.id, lot.floors[0]!.id, 'struct.house', { x: 0, y: 0 });
    const opened = openChildMap(house.project, house.ids[0]!);
    expect(levelsOf(opened.project).levels.find((l) => l.id === opened.id)!.kind).toBe('building');
  });
});
