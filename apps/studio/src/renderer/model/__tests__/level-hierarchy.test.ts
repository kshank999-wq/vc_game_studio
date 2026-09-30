import { describe, expect, it } from 'vitest';
import { formatLength } from '../../components/level/units';
import {
  addChildMap,
  boundsOf,
  childOfItem,
  createWorld,
  descendantsOf,
  duplicateMap,
  filterTree,
  isWorldScale,
  mapsOwnedBy,
  moveMap,
  navigatorTree,
  openChildMap,
  pathTo,
  removalOfMap,
  removeMap,
  statusOf,
  WORLD_PRESETS,
} from '../level/hierarchy';
import { addFloor, levelsOf, mapGrid, placeAsset, resizeItem, snap } from '../level/level';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const world = (p: Project = sunkenVault(), preset: 'small' | 'medium' | 'large' | 'custom' = 'small') => createWorld(p, { preset, name: 'The Drowned Coast' });

describe('the spatial hierarchy (Level Designer spec V2 §4)', () => {
  it('starts a world from a size preset, or a custom one', () => {
    expect(WORLD_PRESETS.map((p) => [p.id, p.size])).toEqual([['small', 10_000], ['medium', 40_000], ['large', 100_000], ['custom', 5_000]]);
    const made = world(undefined, 'medium');
    const w = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
    expect(w).toMatchObject({ name: 'The Drowned Coast', kind: 'world', width: 40_000, depth: 40_000, grid: 250, boundary: 'continuous' });
    const custom = createWorld(sunkenVault(), { preset: 'custom', width: 3_000, depth: 1_500, origin: { x: 100, y: -50 } });
    expect(levelsOf(custom.project).levels.find((l) => l.id === custom.id)).toMatchObject({ width: 3_000, depth: 1_500, grid: 50, origin: { x: 100, y: -50 } });
    expect(isWorldScale(levelsOf(made.project), w)).toBe(true);
  });

  it('opens an item as its own map, the next scale down, the item’s size, and keeps it in step', () => {
    let { project, id: worldId } = world();
    const floorId = levelsOf(project).levels.find((l) => l.id === worldId)!.floors[0]!.id;
    const placed = placeAsset(project, worldId, floorId, 'space.exterior', { x: 1200, y: -800 });
    project = resizeItem(placed.project, placed.ids[0]!, { w: 3000, d: 2000 });
    const zone = placed.ids[0]!;
    const opened = openChildMap(project, zone);
    expect(opened.made).toBe(true);
    project = opened.project;
    let set = levelsOf(project);
    const region = set.levels.find((l) => l.id === opened.id)!;
    expect(region).toMatchObject({ kind: 'region', parentId: worldId, anchorId: zone, boundary: 'streamed', grid: 50 });
    expect(boundsOf(set, region)).toEqual({ w: 3000, d: 2000 });
    expect(childOfItem(set, zone)?.id).toBe(region.id);
    // Opening it again goes to the same map.
    expect(openChildMap(project, zone)).toMatchObject({ id: region.id, made: false });
    // The zone grows on the world: the region grows with it.
    project = resizeItem(project, zone, { w: 4000 });
    expect(boundsOf(levelsOf(project), levelsOf(project).levels.find((l) => l.id === region.id)!)).toEqual({ w: 4000, d: 2000 });
    // A room opens as an interior, one floor.
    const room = placeAsset(project, region.id, region.floors[0]!.id, 'space.room', { x: 0, y: 0 });
    const inner = openChildMap(room.project, room.ids[0]!);
    set = levelsOf(inner.project);
    expect(set.levels.find((l) => l.id === inner.id)).toMatchObject({ kind: 'interior', boundary: 'continuous', floors: [expect.objectContaining({ name: 'Ground floor' })] });
    expect(pathTo(set, inner.id).map((l) => l.name)).toEqual(['The Drowned Coast', 'Exterior zone', 'Room']);
    expect(descendantsOf(set, worldId).map((l) => l.kind)).toEqual(['region', 'interior']);
  });

  it('snaps on each map’s own grid, and reads long distances in kilometres', () => {
    const { project, id } = world();
    const set = levelsOf(project);
    expect(mapGrid(set, id)).toBe(100);
    expect(snap(set, 1234, true, id)).toBe(1200);
    expect(snap(set, 1.3, true)).toBe(1.5);
    expect([formatLength(1500, 'm'), formatLength(12.5, 'm'), formatLength(3218.688, 'ft')]).toEqual(['1.5 km', '12.5 m', '2 mi']);
  });

  it('works out how far along each map is', () => {
    const p = sunkenVault();
    const set = levelsOf(p);
    expect(statusOf(set, set.levels[0]!)).toBe('gameplay');
    const made = addChildMap(p, set.levels[0]!.id);
    const s2 = levelsOf(made.project);
    expect(statusOf(s2, s2.levels.find((l) => l.id === made.id)!)).toBe('empty');
    expect(statusOf(s2, { ...s2.levels[0]!, status: 'final' })).toBe('final');
  });

  it('lists World › Region › Level › Building › Floor › Room in the navigator, and finds by name', () => {
    let { project, id: worldId } = world();
    const vault = levelsOf(project).levels[0]!;
    project = moveMap(project, vault.id, worldId);
    let set = levelsOf(project);
    const tree = navigatorTree(set);
    expect(tree.map((n) => [n.name, n.mapKind])).toEqual([['The Drowned Coast', 'world']]);
    const [vaultNode] = tree[0]!.children;
    expect(vaultNode).toMatchObject({ kind: 'map', name: 'Sunken Vault', mapKind: 'level', status: 'gameplay' });
    expect(vaultNode!.children.map((c) => c.kind)).toContain('room');
    // More than one floor: floors, each with its rooms.
    project = addFloor(project, vault.id).project;
    set = levelsOf(project);
    const floors = navigatorTree(set)[0]!.children[0]!.children;
    expect(floors.map((f) => [f.kind, f.name])).toEqual([['floor', 'Floor 2'], ['floor', 'Ground floor']]);
    expect(floors[1]!.children.length).toBeGreaterThan(0);
    const found = filterTree(navigatorTree(set), 'silt');
    expect(found[0]!.children[0]!.children[0]!.children.map((r) => r.name)).toEqual(['Silt Camp']);
    // A map can't go inside one of its own.
    expect(moveMap(project, worldId, vault.id)).toBe(project);
  });

  it('warns what deleting takes with it, and duplicates a map with new GUIDs', () => {
    let { project, id: worldId } = world();
    const floorId = levelsOf(project).levels.find((l) => l.id === worldId)!.floors[0]!.id;
    const placed = placeAsset(project, worldId, floorId, 'space.exterior', { x: 0, y: 0 });
    const opened = openChildMap(placed.project, placed.ids[0]!);
    project = placeAsset(opened.project, opened.id, levelsOf(opened.project).levels.find((l) => l.id === opened.id)!.floors[0]!.id, 'prop.crate', { x: 1, y: 1 }).project;
    let set = levelsOf(project);
    expect(mapsOwnedBy(set, placed.ids).map((m) => m.id)).toEqual([opened.id]);
    expect(removalOfMap(set, worldId)).toMatchObject({ maps: [expect.objectContaining({ id: worldId }), expect.objectContaining({ id: opened.id })], items: 2 });
    const copy = duplicateMap(project, opened.id);
    set = levelsOf(copy.project);
    const twin = set.levels.find((l) => l.id === copy.id)!;
    expect(twin).toMatchObject({ name: 'Exterior zone copy', parentId: worldId });
    expect(twin.anchorId).toBeUndefined();
    expect(set.items.filter((i) => i.levelId === twin.id).map((i) => i.name)).toEqual(['Crate']);
    expect(set.items.filter((i) => i.levelId === twin.id)[0]!.id).not.toBe(set.items.find((i) => i.levelId === opened.id)!.id);
    const gone = levelsOf(removeMap(copy.project, worldId));
    expect(gone.levels.map((l) => l.id)).not.toContain(opened.id);
    expect(gone.items.some((i) => i.levelId === opened.id)).toBe(false);
  });
});

describe('the preflight at every scale', () => {
  it('asks for a player start only where the game loads a map on its own', async () => {
    const { levelIssues } = await import('../level/validate');
    const { updateMap } = await import('../level/hierarchy');
    let { project, id: worldId } = world(sunkenVault());
    const noStart = (p: Project, id: string) => levelIssues(p).some((i) => i.id === id && /no player start/.test(i.message));
    expect(noStart(project, worldId)).toBe(false);
    const city = addChildMap(project, worldId, 'level', 'Harbour');
    project = city.project;
    // Inside the world and streamed in: the player walks there.
    expect(noStart(updateMap(project, city.id, { boundary: 'streamed' }), city.id)).toBe(false);
    // Loaded by a transition: it needs somewhere to put the player.
    expect(noStart(updateMap(project, city.id, { boundary: 'transition' }), city.id)).toBe(true);
    expect(noStart(updateMap(project, city.id, { boundary: 'mapOnly' }), city.id)).toBe(false);
  });
});
