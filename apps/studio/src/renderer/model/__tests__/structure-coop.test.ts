import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../files';
import { applyMerge, claim, claimOf, handOut, mergePlan, release, workingCopyOf, type MergePlan } from '../level/coop';
import { levelsOf, placeAsset, removeItems, updateItem } from '../level/level';
import { withTomb } from '../level/sample-structure';
import { makeObject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const tomb = () => withTomb(sunkenVault());
const item = (p: Project, id: string) => levelsOf(p).items.find((i) => i.id === id);
const AT = '2026-10-14T09:00:00.000Z';
/** Handed out, saved by the teammate and opened again here, as the files would be. */
const roundTrip = (p: Project): Project => parse(serialize(p))!;

describe('cooperative editing (structure spec V2)', () => {
  it('a claim says who is working on a structure, until it is released', () => {
    const t = tomb();
    const p = claim(t.project, t.id, 'Sam', AT, 'Doing the crypt');
    expect(claimOf(p, t.id)).toEqual({ by: 'Sam', at: AT, note: 'Doing the crypt' });
    expect(claimOf(release(p, t.id), t.id)).toBeUndefined();
  });

  it('handing out makes a working copy that opens as a project file, and claims the structure for them', () => {
    const t = tomb();
    const out = handOut(t.project, t.id, 'Sam', 'Kim', AT)!;
    expect(claimOf(out.project, t.id)).toMatchObject({ by: 'Sam', at: AT });
    const copy = roundTrip(out.copy);
    const info = workingCopyOf(copy)!;
    expect(info).toMatchObject({ levelId: t.id, levelName: 'Old Tomb', by: 'Kim', to: 'Sam', from: t.project.name });
    expect(info.base.items.length).toBe(levelsOf(t.project).items.filter((i) => i.levelId === t.id).length);
    expect(copy.name).toBe(`${t.project.name} — Old Tomb (working copy)`);
  });

  it('merges back three-way: their changes come in, mine stay, and both-sides changes are conflicts to choose', () => {
    const t = tomb();
    const out = handOut(t.project, t.id, 'Sam', 'Kim', AT)!;
    // Theirs: the chest moves, a statue goes in, the trap goes, the lever is renamed, and a new key item for a new pickup.
    let theirs = roundTrip(out.copy);
    theirs = updateItem(theirs, t.parts.chest, { x: item(theirs, t.parts.chest)!.x + 1 });
    const statue = placeAsset(theirs, t.id, t.floorId, 'prop.statue', { x: 2, y: 2 }, { name: 'Guardian' });
    theirs = statue.project;
    theirs = removeItems(theirs, [t.parts.trap]);
    theirs = updateItem(theirs, t.parts.lever, { name: 'Old lever' });
    const relic = makeObject('inventory', 'Relic Shard', AT);
    theirs = { ...theirs, objects: { ...theirs.objects, [relic.id]: relic } };
    const shard = placeAsset(theirs, t.id, t.floorId, 'play.pickup', { x: 3, y: 2 }, { name: 'Shard' });
    theirs = updateItem(shard.project, shard.ids[0]!, { params: { item: relic.id } });
    theirs = roundTrip(theirs);
    // Mine meanwhile: the lever renamed differently (a conflict), the plate moved (mine alone).
    let mine = updateItem(out.project, t.parts.lever, { name: 'Rusty lever' });
    mine = updateItem(mine, t.parts.plate, { x: item(mine, t.parts.plate)!.x + 0.5 });
    const plan = mergePlan(mine, theirs) as MergePlan;
    expect(plan.problems).toEqual([]);
    const by = (id: string) => plan.entries.find((e) => e.id === id);
    expect(by(t.parts.chest)).toMatchObject({ mine: 'same', theirs: 'changed', take: 'theirs' });
    expect(by(statue.ids[0]!)).toMatchObject({ theirs: 'added', take: 'theirs' });
    expect(by(t.parts.trap)).toMatchObject({ theirs: 'removed', take: 'theirs' });
    expect(by(t.parts.plate)).toBeUndefined();
    expect(plan.conflicts.map((c) => [c.name, c.fields])).toEqual([['Old lever', ['name']]]);
    expect(plan.objects).toEqual([relic.id]);
    // Keep mine on the conflict.
    const kept = applyMerge(mine, theirs);
    expect(item(kept.project, t.parts.lever)!.name).toBe('Rusty lever');
    expect(item(kept.project, t.parts.chest)!.x).toBe(item(theirs, t.parts.chest)!.x);
    expect(item(kept.project, statue.ids[0]!)!.name).toBe('Guardian');
    expect(item(kept.project, t.parts.trap)).toBeUndefined();
    expect(item(kept.project, t.parts.plate)!.x).toBe(item(mine, t.parts.plate)!.x);
    expect(kept.project.objects[relic.id]?.name).toBe('Relic Shard');
    expect(claimOf(kept.project, t.id)).toBeUndefined();
    expect(kept.kept).toBe(1);
    // Or take theirs.
    expect(item(applyMerge(mine, theirs, { [t.parts.lever]: 'theirs' }).project, t.parts.lever)!.name).toBe('Old lever');
  });

  it('a thing removed on one side and changed on the other is a conflict, not lost silently', () => {
    const t = tomb();
    const out = handOut(t.project, t.id, 'Sam', 'Kim', AT)!;
    const theirs = roundTrip(updateItem(out.copy, t.parts.chest, { name: 'Gilded chest' }));
    const mine = removeItems(out.project, [t.parts.chest]);
    const plan = mergePlan(mine, theirs) as MergePlan;
    expect(plan.conflicts).toEqual([expect.objectContaining({ id: t.parts.chest, mine: 'removed', theirs: 'changed' })]);
    expect(item(applyMerge(mine, theirs).project, t.parts.chest)).toBeUndefined();
    expect(item(applyMerge(mine, theirs, { [t.parts.chest]: 'theirs' }).project, t.parts.chest)!.name).toBe('Gilded chest');
  });

  it('floors and the structure’s settings merge too; a copy of another project, or not a copy at all, is refused', () => {
    const t = tomb();
    const out = handOut(t.project, t.id, 'Sam', 'Kim', AT)!;
    const set = levelsOf(out.copy);
    const theirs = { ...out.copy, levels: { ...set, levels: set.levels.map((l) => (l.id === t.id ? { ...l, name: 'The Old Tomb', floors: l.floors.map((f) => ({ ...f, name: `${f.name} (lit)` })) } : l)) } } as Project;
    const plan = mergePlan(out.project, theirs) as MergePlan;
    expect(plan.entries.map((e) => e.what).sort()).toEqual(['floor', 'settings']);
    const merged = applyMerge(out.project, theirs).project;
    const lv = levelsOf(merged).levels.find((l) => l.id === t.id)!;
    expect(lv.name).toBe('The Old Tomb');
    expect(lv.floors[0]!.name).toMatch(/\(lit\)$/);
    expect(mergePlan(out.project, t.project)).toEqual({ problems: ['That isn’t a working copy: it was saved from a project, not handed out from one.'] });
    expect((mergePlan(sunkenVault(), out.copy) as { problems: string[] }).problems[0]).toMatch(/isn’t in this project/);
  });

  it('warns when the structure was handed out again since this copy', () => {
    const t = tomb();
    const first = handOut(t.project, t.id, 'Sam', 'Kim', AT)!;
    const second = handOut(first.project, t.id, 'Ana', 'Kim', AT)!;
    const plan = mergePlan(second.project, first.copy) as MergePlan;
    expect(plan.problems[0]).toMatch(/handed out again since \(to Ana\)/);
    // Merging the older copy leaves Ana's claim in place.
    expect(claimOf(applyMerge(second.project, first.copy).project, t.id)?.by).toBe('Ana');
  });
});
