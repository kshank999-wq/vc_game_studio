import { describe, expect, it } from 'vitest';
import { paramOf, sizeOf } from '../level/geometry';
import { addLevel, itemById, levelsOf, placeAsset, resizeItem, saveToLibrary, setParam, updateAsset } from '../level/level';
import { canSaveToAsset, migrateAll, migrateItem, migrationFor, outdatedItems, saveToAsset } from '../level/migrate';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import type { Project } from '../types';

/** A project asset (a crate) with two items placed from it. */
const setup = () => {
  const made = addLevel(createProject('Store'), 'Store');
  const floorId = made.project.levels!.levels[0]!.floors[0]!.id;
  const crate = placeAsset(made.project, made.id, floorId, 'prop.crate', { x: 0, y: 0 });
  const saved = saveToLibrary(crate.project, crate.ids, 'Supply crate');
  let project = saved.project;
  const a = placeAsset(project, made.id, floorId, saved.assetId, { x: 4, y: 0 });
  const b = placeAsset(a.project, made.id, floorId, saved.assetId, { x: 8, y: 0 });
  project = b.project;
  return { project, assetId: saved.assetId, a: a.ids[0]!, b: b.ids[0]! };
};

const def = (p: Project, id: string) => levelsOf(p).assets.find((x) => x.id === id)!;

describe('library migration', () => {
  it('saves an item’s changes as the asset’s new defaults, and flags the others placed from it', () => {
    let { project, assetId, a, b } = setup();
    expect(canSaveToAsset(project, itemById(project, a)!)).toBe(false);
    project = setParam(project, a, 'material', 'metal');
    project = resizeItem(project, a, { w: 2 });
    expect(canSaveToAsset(project, itemById(project, a)!)).toBe(true);
    project = saveToAsset(project, a);
    expect(def(project, assetId)).toMatchObject({ version: 2, size: { w: 2 } });
    expect(def(project, assetId).history).toEqual([expect.objectContaining({ version: 1, size: expect.objectContaining({ w: 1 }) })]);
    // The item now inherits its own values back.
    const itemA = itemById(project, a)!;
    expect(itemA).toMatchObject({ assetVersion: 2 });
    expect(itemA.params).toBeUndefined();
    expect(paramOf(levelsOf(project), itemA, 'material')).toBe('metal');
    // The other one is from v1 and is told what it inherited changed.
    expect(migrationFor(project, itemA)).toBeNull();
    const m = migrationFor(project, itemById(project, b)!)!;
    expect(m).toMatchObject({ from: 1, to: 2, known: true });
    expect(m.changes).toEqual(
      expect.arrayContaining([
        { kind: 'inherited', key: 'material', label: 'Proxy material', from: 'neutral', to: 'metal' },
        { kind: 'inherited', key: 'size.w', label: 'Width', from: 1, to: 2 },
      ]),
    );
    expect(outdatedItems(project).map((x) => x.itemId)).toEqual([b]);
    expect(levelIssues(project).find((i) => i.id === b)?.message).toBe(`${itemById(project, b)!.name} is from v1 of Supply crate; the library is at v2.`);
  });

  it('keeps the old values it is told to keep, takes the rest, and stops being flagged', () => {
    let { project, assetId, a, b } = setup();
    project = saveToAsset(resizeItem(setParam(project, a, 'material', 'metal'), a, { w: 2 }), a);
    project = migrateItem(project, b, ['size.w']);
    const itemB = itemById(project, b)!;
    expect(itemB.assetVersion).toBe(2);
    expect(sizeOf(levelsOf(project), itemB).w).toBe(1);
    expect(paramOf(levelsOf(project), itemB, 'material')).toBe('metal');
    expect(migrationFor(project, itemB)).toBeNull();
    expect(outdatedItems(project)).toEqual([]);
    expect(def(project, assetId).version).toBe(2);
  });

  it('drops its own values the new version makes pointless, out of range, or no longer has', () => {
    let { project, assetId, b } = setup();
    project = setParam(project, b, 'material', 'wood');
    project = setParam(project, b, 'mass', 40);
    const itemB = itemById(project, b)!;
    project = { ...project, levels: { ...levelsOf(project), items: levelsOf(project).items.map((i) => (i.id === b ? { ...itemB, params: { ...itemB.params, oldKnob: 3 } } : i)) } };
    const d = def(project, assetId);
    project = updateAsset(project, assetId, {
      params: d.params.map((p) => (p.key === 'material' ? { ...p, default: 'wood' } : p.key === 'mass' ? { ...p, max: 30 } : p)),
    });
    const m = migrationFor(project, itemById(project, b)!)!;
    expect(m.changes.map((c) => [c.kind, c.key])).toEqual(expect.arrayContaining([['redundant', 'material'], ['invalid', 'mass'], ['dropped', 'oldKnob']]));
    project = migrateAll(project, assetId);
    expect(itemById(project, b)!.params).toBeUndefined();
    expect(outdatedItems(project)).toEqual([]);
  });

  it('still updates an item whose version was not recorded, without guessing what changed', () => {
    let { project, assetId, b } = setup();
    const set = levelsOf(project);
    project = { ...project, levels: { ...set, assets: set.assets.map((x) => (x.id === assetId ? { ...x, version: 5 } : x)) } };
    const m = migrationFor(project, itemById(project, b)!)!;
    expect(m).toMatchObject({ known: false, changes: [] });
    expect(migrationFor(migrateItem(project, b), itemById(migrateItem(project, b), b)!)).toBeNull();
  });
});
