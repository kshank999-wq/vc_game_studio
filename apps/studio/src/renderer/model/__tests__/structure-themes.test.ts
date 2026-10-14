import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, proposeDressing, proposeLayout, type Proposal } from '../level/generate';
import { assetOf, contains, frameOf } from '../level/geometry';
import { addLevel, levelsOf, placeAsset, updateItem } from '../level/level';
import { createStructure, structureIssues } from '../level/structure';
import { DRESSING, THEMES, defaultTheme } from '../level/themes';
import { createProject } from '../project';
import type { Project } from '../types';
import type { GeneratorSettings, StructureType } from '../level/types';

const make = (type: StructureType) => {
  const base = addLevel(createProject('Test'), 'Ancient Civilization');
  const lv = levelsOf(base.project).levels[0]!;
  const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type, seed: 5 });
  return { p: made.project, id: made.id };
};
const level = (p: Project, id: string) => levelsOf(p).levels.find((l) => l.id === id)!;
const ground = (p: Project, id: string) => [...level(p, id).floors].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0]!.id;
const propose = (p: Project, id: string, settings: Partial<GeneratorSettings> = {}, seed = 11): Proposal =>
  proposeLayout(p, { levelId: id, floorIds: [ground(p, id)], seed, settings: { ...defaultGenerator(level(p, id).structure?.type), ...settings } });
const items = (p: Project) => levelsOf(p).items;
const dressing = (p: Project) => items(p).filter((i) => i.tags?.includes(DRESSING));
const spaces = (pr: Proposal) => items(pr.project).filter((i) => pr.made.includes(i.id) && assetOf(levelsOf(pr.project), i).kind === 'space');

describe('procedural themes (structure spec V2)', () => {
  it('each kind of structure starts from a theme of its own', () => {
    expect(defaultTheme('pyramid')).toBe('ancient');
    expect(defaultTheme('office')).toBe('modern');
    expect(defaultTheme('dungeon')).toBe('ruin');
    expect(defaultGenerator('office').theme).toBe('modern');
    expect(THEMES.map((t) => t.id)).toEqual(['none', 'ancient', 'gothic', 'modern', 'residential', 'industrial', 'scifi', 'ruin']);
  });

  it('dresses an office as an office: desks and chairs, ceiling lamps, by what each room is for', () => {
    const { p, id } = make('office');
    const pr = propose(p, id);
    const d = dressing(pr.project);
    expect(pr.dressing!.props).toBeGreaterThan(10);
    expect(pr.dressing!.lights).toBeGreaterThan(5);
    expect(d.some((i) => i.assetId === 'prop.desk')).toBe(true);
    expect(d.some((i) => i.assetId === 'light.practical' && i.name === 'Lamp')).toBe(true);
    // Everything it put in is part of the run, so regenerating replaces it.
    for (const i of d) expect(i.generated).toBe(pr.run.id);
    expect(pr.run.settings.theme).toBe('modern');
  });

  it('the same seed dresses the same way, and changing the theme never moves a wall', () => {
    const { p, id } = make('office');
    const walls = (pr: Proposal) => spaces(pr).map((i) => [i.name, i.x, i.y, i.size?.w, i.size?.d]);
    const a = propose(p, id);
    const b = propose(p, id);
    expect(dressing(a.project).map((i) => [i.assetId, i.x, i.y])).toEqual(dressing(b.project).map((i) => [i.assetId, i.x, i.y]));
    const none = propose(p, id, { theme: 'none' });
    const scifi = propose(p, id, { theme: 'scifi' });
    expect(dressing(none.project)).toEqual([]);
    expect(walls(scifi)).toEqual(walls(none));
    expect(walls(a)).toEqual(walls(none));
  });

  it('puts things inside their room, out of the doorways, and leaves the structure playable', () => {
    const { p, id } = make('dungeon');
    const pr = propose(p, id);
    const set = levelsOf(pr.project);
    const rooms = spaces(pr);
    const doors = items(pr.project).filter((i) => assetOf(set, i).role === 'door');
    for (const i of dressing(pr.project)) {
      expect(rooms.some((r) => r.floorId === i.floorId && contains(frameOf(set, r), { x: i.x, y: i.y })), i.name).toBe(true);
      for (const dr of doors) {
        const f = frameOf(set, dr);
        expect(Math.hypot(f.x - i.x, f.y - i.y), `${i.name} in ${dr.name}`).toBeGreaterThan(1);
      }
    }
    expect(structureIssues(set, id).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('ruin and traps go as far as asked: rubble, barricades and traps in most rooms', () => {
    const { p, id } = make('dungeon');
    const calm = propose(p, id, { decay: 0, traps: 0 });
    expect(calm.dressing!.ruin + calm.dressing!.traps).toBe(0);
    const wrecked = propose(p, id, { decay: 1, traps: 1 });
    expect(wrecked.dressing!.ruin).toBeGreaterThan(wrecked.counts.rooms * 0.5);
    expect(wrecked.dressing!.traps).toBeGreaterThan(wrecked.counts.rooms * 0.5);
    const trap = dressing(wrecked.project).find((i) => i.assetId === 'play.trap')!;
    expect(trap.params).toMatchObject({ activeFor: 1 });
  });

  it('dresses rooms drawn by hand, and dressing again replaces only what nobody has changed', () => {
    const { p, id } = make('fortress');
    const fl = ground(p, id);
    const hall = placeAsset(p, id, fl, 'space.room', { x: 0, y: 0 }, { name: 'Great Hall' });
    let q = updateItem(hall.project, hall.ids[0]!, { size: { w: 12, d: 9, h: 4 } });
    const room = hall.ids[0]!;
    const first = proposeDressing(q, { levelId: id, roomIds: [room], theme: 'gothic', seed: 3 });
    expect(first.dressing!.props).toBeGreaterThan(1);
    expect(dressing(first.project).some((i) => i.assetId === 'prop.table')).toBe(true);
    expect(items(first.project).find((i) => i.id === room)!.params?.material).toBe('stone');
    q = acceptLayout(first);
    // Move one table by hand: it stays when the room is dressed again; the rest is replaced.
    const table = dressing(q).find((i) => i.assetId === 'prop.table')!;
    q = updateItem(q, table.id, { x: table.x + 0.25 });
    const again = proposeDressing(q, { levelId: id, roomIds: [room], theme: 'gothic', seed: 4 });
    expect(again.kept.map((k) => k.id)).toEqual([table.id]);
    expect(again.removed.length).toBe(dressing(q).length - 1);
    expect(items(again.project).some((i) => i.id === table.id)).toBe(true);
    // Bare again with no theme: only the moved table is left.
    const bare = proposeDressing(acceptLayout(again), { levelId: id, roomIds: [room], theme: 'none', seed: 4 });
    expect(dressing(bare.project).map((i) => i.id)).toEqual([table.id]);
  });

  it('regenerating the layout leaves the dressing of a room drawn by hand alone', () => {
    const { p, id } = make('fortress');
    const fl = ground(p, id);
    const hall = placeAsset(p, id, fl, 'space.room', { x: 0, y: 0 }, { name: 'Great Hall' });
    const q = acceptLayout(proposeDressing(updateItem(hall.project, hall.ids[0]!, { size: { w: 12, d: 9, h: 4 } }), { levelId: id, roomIds: [hall.ids[0]!], theme: 'gothic', seed: 3 }));
    const dressed = dressing(q).map((i) => i.id);
    const pr = propose(q, id);
    for (const did of dressed) expect(items(pr.project).some((i) => i.id === did)).toBe(true);
  });
});
