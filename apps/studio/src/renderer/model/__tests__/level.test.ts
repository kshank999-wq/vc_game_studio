import { describe, expect, it } from 'vitest';
import { frameOf, meshesFor, openingOf, sizeOf } from '../level/geometry';
import {
  addFloor,
  addLevel,
  alignItems,
  duplicateItems,
  groupItems,
  itemById,
  levelsOf,
  linkItem,
  linkedTo,
  mirrorItems,
  moveItems,
  placeAsset,
  removeItems,
  resetParam,
  resizeItem,
  rotateItems,
  saveToLibrary,
  setParam,
  withGroups,
} from '../level/level';
import { exportNameOf, levelExportName, pascal } from '../level/naming';
import { levelIssues } from '../level/validate';
import { createProject, removeObject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const start = (): { project: Project; levelId: string; floorId: string } => {
  const made = addLevel(createProject('Castle'), 'Castle');
  const level = made.project.levels!.levels[0]!;
  return { project: made.project, levelId: made.id, floorId: level.floors[0]!.id };
};

const room = (p: Project, levelId: string, floorId: string, name = 'Throne', at = { x: 0, y: 0 }) => {
  const placed = placeAsset(p, levelId, floorId, 'space.room', at, { name });
  return { project: placed.project, id: placed.ids[0]! };
};

describe('levels and rooms', () => {
  it('starts a level with a ground floor, and adds floors above', () => {
    const { project, levelId } = start();
    const withFloor = addFloor(project, levelId);
    const floors = withFloor.project.levels!.levels[0]!.floors;
    expect(floors.map((f) => [f.name, f.elevation])).toEqual([
      ['Ground floor', 0],
      ['Floor 2', 3],
    ]);
  });

  it('places a room as a footprint and a graybox, and resizing keeps its GUID', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const before = itemById(r.project, r.id)!;
    expect(sizeOf(r.project.levels!, before)).toEqual({ w: 8, d: 6, h: 3 });
    const walls = meshesFor(r.project.levels!, s.levelId).filter((m) => m.part === 'wall');
    expect(walls).toHaveLength(4);

    const resized = resizeItem(r.project, r.id, { w: 30, d: 40 });
    const after = itemById(resized, r.id)!;
    expect(after.id).toBe(before.id);
    expect(after.size).toEqual({ w: 30, d: 40 });
    const north = meshesFor(resized.levels!, s.levelId).find((m) => m.key === `${r.id}:wall0:0`)!;
    // The north wall runs the width plus the corners.
    expect(north.sx).toBeCloseTo(30.2);
    expect(north.z).toBeCloseTo(-20);
  });

  it('puts a door in the nearest wall, cuts the opening, and flags it when the wall gets too short', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    // Just inside the south wall (y = +3), a little east of centre.
    const d = placeAsset(r.project, s.levelId, s.floorId, 'arch.door', { x: 1, y: 2.8 });
    const door = itemById(d.project, d.ids[0]!)!;
    expect(door.host).toMatchObject({ id: r.id, wall: 2 });
    expect(door.host!.along).toBeCloseTo(5 / 8);
    const south = meshesFor(d.project.levels!, s.levelId).filter((m) => m.key.startsWith(`${r.id}:wall2:`));
    // Left of the door, above it, and right of it.
    expect(south).toHaveLength(3);
    expect(frameOf(d.project.levels!, door)).toMatchObject({ x: 1, y: 3 });

    // The room grows: the door stays at the same share of its wall.
    const grown = resizeItem(d.project, r.id, { w: 16 });
    expect(frameOf(grown.levels!, itemById(grown, door.id)!).x).toBeCloseTo(2);

    // Too narrow for the door: flagged, not deleted; wide again: fine.
    const narrow = resizeItem(d.project, r.id, { w: 0.9 });
    expect(itemById(narrow, door.id)!.invalid).toMatch(/no longer fits/);
    expect(openingOf(narrow.levels!, itemById(narrow, door.id)!)!.fits).toBe(false);
    const wide = resizeItem(narrow, r.id, { w: 8 });
    expect(itemById(wide, door.id)!.invalid).toBeUndefined();
  });

  it('slides a door along its wall, and into another wall when dragged there', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const d = placeAsset(r.project, s.levelId, s.floorId, 'arch.door', { x: 0, y: 3 });
    const slid = moveItems(d.project, d.ids, 2, 0);
    expect(itemById(slid, d.ids[0]!)!.host!.along).toBeCloseTo(0.75);
    // Dragged to the east wall.
    const moved = moveItems(d.project, d.ids, 4, -3);
    expect(itemById(moved, d.ids[0]!)!.host!.wall).toBe(1);
    // A room that moves takes its door along.
    const both = moveItems(d.project, [r.id], 10, 0);
    expect(frameOf(both.levels!, itemById(both, d.ids[0]!)!).x).toBeCloseTo(10);
  });

  it('flags a door dropped away from any wall', () => {
    const s = start();
    const d = placeAsset(s.project, s.levelId, s.floorId, 'arch.door', { x: 40, y: 40 });
    expect(itemById(d.project, d.ids[0]!)!.invalid).toMatch(/Not in a wall/);
  });
});

describe('export names', () => {
  it('follow TYPE_Context_Name_### with stable serials', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId, 'Throne');
    const orb = placeAsset(r.project, s.levelId, s.floorId, 'logic.interaction', { x: 1, y: 1 }, { name: 'Magic orb' });
    const set = orb.project.levels!;
    expect(levelExportName(set, set.levels[0]!)).toBe('LVL_Castle_01');
    expect(exportNameOf(set, itemById(orb.project, r.id)!)).toBe('RM_Castle_Throne_001');
    expect(exportNameOf(set, itemById(orb.project, orb.ids[0]!)!)).toBe('INT_Throne_MagicOrb_001');
    // Removing the first room doesn't renumber the next one.
    const second = room(orb.project, s.levelId, s.floorId, 'Hall', { x: 20, y: 0 });
    const gone = removeItems(second.project, [r.id]);
    expect(exportNameOf(gone.levels!, itemById(gone, second.id)!)).toBe('RM_Castle_Hall_002');
  });

  it('use the project’s prefixes and pattern', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId, 'Throne');
    const set = { ...r.project.levels!, settings: { ...r.project.levels!.settings, template: '{Name}-{TYPE}{##}', prefixes: { ...r.project.levels!.settings.prefixes, room: 'ROOM' } } };
    expect(exportNameOf(set, set.items[0]!)).toBe('Throne-ROOM01');
    expect(pascal('the vault’s key!')).toBe('TheVaultsKey');
  });
});

describe('library values and overrides', () => {
  it('stores only what an instance changes, and resets to the library', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const thick = setParam(r.project, r.id, 'wallThickness', 0.5);
    expect(itemById(thick, r.id)!.params).toEqual({ wallThickness: 0.5 });
    const same = setParam(thick, r.id, 'wallThickness', 0.2);
    expect(itemById(same, r.id)!.params).toEqual({});
    expect(itemById(resetParam(thick, r.id, 'wallThickness'), r.id)!.params).toEqual({});
  });

  it('saves a room and its door as an assembly and places copies with new GUIDs', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const d = placeAsset(r.project, s.levelId, s.floorId, 'arch.door', { x: 0, y: 3 });
    const saved = saveToLibrary(d.project, [r.id], 'Guard room');
    const asset = saved.project.levels!.assets.find((a) => a.id === saved.assetId)!;
    expect(asset.kind).toBe('assembly');
    expect(asset.parts).toHaveLength(2);
    const placed = placeAsset(saved.project, s.levelId, s.floorId, saved.assetId, { x: 30, y: 0 });
    expect(placed.ids).toHaveLength(2);
    const [newRoom, newDoor] = placed.ids.map((id) => itemById(placed.project, id)!);
    expect(newRoom!.id).not.toBe(r.id);
    expect(newRoom!.groupId).toBe(newDoor!.groupId);
    expect(newDoor!.host?.id).toBe(newRoom!.id);
    expect(withGroups(placed.project, [newRoom!.id]).sort()).toEqual([...placed.ids].sort());
  });
});

describe('editing several items', () => {
  it('duplicates a room with its door, mirrors doors across, and aligns edges', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const d = placeAsset(r.project, s.levelId, s.floorId, 'arch.door', { x: 3.9, y: 0 });
    expect(itemById(d.project, d.ids[0]!)!.host!.wall).toBe(1);
    const copy = duplicateItems(d.project, [r.id], { x: 20, y: 0 });
    const doors = copy.project.levels!.items.filter((i) => i.assetId === 'arch.door');
    expect(doors).toHaveLength(2);
    expect(doors.map((x) => x.host!.id).sort()).toEqual([r.id, copy.ids[0]!].sort());

    const mirrored = mirrorItems(d.project, [r.id], 'x');
    expect(itemById(mirrored, d.ids[0]!)!.host!.wall).toBe(3);

    const two = room(d.project, s.levelId, s.floorId, 'Hall', { x: 20, y: 5 });
    const aligned = alignItems(two.project, [r.id, two.id], 'top');
    expect(itemById(aligned, two.id)!.y).toBe(0);
    const turned = rotateItems(two.project, [two.id], 90);
    expect(itemById(turned, two.id)!.rotation).toBe(90);
    expect(groupItems(two.project, [r.id, two.id]).levels!.items.filter((i) => i.groupId).length).toBe(2);
  });
});

describe('the story', () => {
  it('links items to story elements, finds them from the element, and drops links when it is deleted', () => {
    let p = sunkenVault();
    const made = addLevel(p, 'Sunken Vault');
    p = made.project;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const r = placeAsset(p, made.id, floorId, 'space.room', { x: 0, y: 0 }, { name: 'Vault Chamber' });
    const scene = Object.values(p.objects).find((o) => o.name === 'The Vault Door')!.id;
    const linked = linkItem(r.project, r.ids[0]!, scene);
    expect(linkedTo(linked, scene).items.map((i) => i.id)).toContain(r.ids[0]);
    const deleted = removeObject(linked, scene);
    expect(itemById(deleted, r.ids[0]!)!.links).toEqual([]);
  });
});

describe('validation', () => {
  it('asks for a player start, something to spawn, and different export names', () => {
    const s = start();
    const r = room(s.project, s.levelId, s.floorId);
    const spawner = placeAsset(r.project, s.levelId, s.floorId, 'spawn.enemy', { x: 1, y: 1 });
    const twin = placeAsset(spawner.project, s.levelId, s.floorId, 'prop.crate', { x: 2, y: 2 });
    const clash = twin.project.levels!.items.map((i) => (i.id === twin.ids[0] ? { ...i, exportName: 'RM_Castle_Throne_001' } : i));
    const p = { ...twin.project, levels: { ...twin.project.levels!, items: clash } };
    const messages = levelIssues(p).map((i) => i.message);
    expect(messages).toContain('Castle has no player start.');
    expect(messages).toContain('Enemy spawn has nothing to spawn.');
    expect(messages.some((m) => m.includes('both exported as RM_Castle_Throne_001'))).toBe(true);

    const withStart = placeAsset(p, s.levelId, s.floorId, 'actor.player', { x: 0, y: 0 });
    expect(levelIssues(withStart.project).map((i) => i.message)).not.toContain('Castle has no player start.');
  });
});

describe('reading levels from a file', () => {
  it('fills in what an older or hand-edited file leaves out, and gives the same object back each time', () => {
    const p = { ...createProject('Old'), levels: { levels: [], items: [] } } as unknown as Project;
    const a = levelsOf(p);
    expect(a.settings.prefixes.room).toBe('RM');
    expect(a.assets).toEqual([]);
    expect(levelsOf(p)).toBe(a);
  });
});
