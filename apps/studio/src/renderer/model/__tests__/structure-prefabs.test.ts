import { describe, expect, it } from 'vitest';
import { addLevel, levelsOf, placeAsset, saveToLibrary } from '../level/level';
import { interactWith, isOpen, startLevelPlay } from '../level/play';
import {
  fetchCatalog,
  fetchListed,
  makePrefab,
  makeStructurePrefab,
  placePrefab,
  prefabsOf,
  prefabText,
  readCatalog,
  readPrefab,
  removePrefab,
  safeUrl,
  savePrefab,
  sha256,
  starterPrefabs,
  type Fetcher,
} from '../level/prefabs';
import { withTomb } from '../level/sample-structure';
import { createStructure } from '../level/structure';
import { createProject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const tomb = () => withTomb(sunkenVault());
const items = (p: Project, ids: readonly string[]) => levelsOf(p).items.filter((i) => ids.includes(i.id));
const blank = () => {
  const made = addLevel(createProject('Other'), 'Elsewhere');
  const lv = levelsOf(made.project).levels[0]!;
  return { p: made.project, levelId: lv.id, floorId: lv.floors[0]!.id };
};
const serve = (files: Record<string, string>): Fetcher => async (url) => (files[url] !== undefined ? { ok: true, status: 200, text: async () => files[url]! } : { ok: false, status: 404, text: async () => '' });

describe('prefabs (structure spec V2)', () => {
  it('a room as a prefab takes its doors and what is in it, and the story objects they point at', () => {
    const t = tomb();
    const pre = makePrefab(t.project, [t.rooms.treasury], { name: 'Treasury' })!;
    const names = pre.items.map((i) => i.name);
    expect(names).toContain('Treasury');
    expect(names).toContain('Chest');
    // The chest's key and what it holds travel with it.
    expect(pre.objects.map((o) => o.name).sort()).toEqual(expect.arrayContaining(['Gold Idol', 'Tomb Key']));
    // Items are kept round the prefab's centre.
    expect(Math.abs(pre.items.find((i) => i.name === 'Treasury')!.x)).toBeLessThan(pre.size.w);
    expect(pre.items.every((i) => !('levelId' in i) && !('serial' in i))).toBe(true);
  });

  it('placed in another project: new GUIDs, the lever still works the copied gate, the key comes along and opens the chest', () => {
    const t = tomb();
    const pre = makePrefab(t.project, [t.parts.lever, t.parts.chest], { name: 'Lever, gate and chest' })!;
    expect(pre.items.map((i) => i.id)).toContain(t.doors.portcullis);
    const b = blank();
    const placed = placePrefab(b.p, b.levelId, b.floorId, pre, { x: 10, y: 5 });
    expect(placed.added.objects).toBeGreaterThanOrEqual(2);
    const made = items(placed.project, placed.ids);
    expect(made.every((i) => ![t.parts.lever, t.parts.chest, t.doors.portcullis].includes(i.id))).toBe(true);
    const lever = made.find((i) => i.assetId === 'logic.lever')!;
    const gate = made.find((i) => i.assetId === 'arch.gate')!;
    expect(lever.params?.works).toBe(gate.id);
    expect(lever.levelId).toBe(b.levelId);
    // Placing it again shares the story objects rather than doubling them.
    const again = placePrefab(placed.project, b.levelId, b.floorId, pre, { x: -10, y: 5 });
    expect(again.added.objects).toBe(0);
    expect(Object.keys(again.project.objects).length).toBe(Object.keys(placed.project.objects).length);
    expect(new Set(items(again.project, again.ids).map((i) => i.name)).size).toBe(again.ids.length);
  });

  it('carries the project assets it is made of: one saved to the library places in a project without it', () => {
    const t = tomb();
    const saved = saveToLibrary(t.project, [t.parts.chest], 'Lever kit');
    const placed = placeAsset(saved.project, t.id, t.floorId, saved.assetId!, { x: 30, y: 30 });
    const pre = makePrefab(placed.project, placed.ids, { name: 'Kit' })!;
    expect(pre.assets.map((a) => a.name)).toContain('Lever kit');
    const b = blank();
    const out = placePrefab(b.p, b.levelId, b.floorId, pre, { x: 0, y: 0 });
    expect(out.added.assets).toBe(1);
    expect(out.problems).toEqual([]);
  });

  it('a structure prefab lays every floor down by its code, and says which floors the target lacks', () => {
    const t = tomb();
    const pre = makeStructurePrefab(t.project, t.id, { name: 'Old Tomb' })!;
    expect(pre.kind).toBe('structure');
    expect(new Set(pre.items.map((i) => i.floor))).toEqual(new Set(['G']));
    const base = addLevel(createProject('X'), 'A');
    const lv = levelsOf(base.project).levels[0]!;
    const s = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type: 'temple', seed: 3 });
    const level = levelsOf(s.project).levels.find((l) => l.id === s.id)!;
    const out = placePrefab(s.project, s.id, level.floors[0]!.id, pre, { x: 0, y: 0 });
    expect(out.ids.length).toBe(pre.items.length);
    expect(items(out.project, out.ids).every((i) => level.floors.find((f) => f.id === i.floorId)?.kind === 'ground')).toBe(true);
    const odd = { ...pre, items: pre.items.map((i, n) => (n === 0 ? { ...i, floor: '9' } : i)) };
    expect(placePrefab(s.project, s.id, level.floors[0]!.id, odd, { x: 0, y: 0 }).problems[0]).toBe('This structure has no floor 9: what was on it was left out.');
  });

  it('a package round-trips as a file, and anything that isn’t one is refused', () => {
    const t = tomb();
    const pre = makePrefab(t.project, [t.rooms.treasury], { name: 'Treasury' })!;
    expect(readPrefab(prefabText(pre)).prefab).toEqual(pre);
    expect(readPrefab('nope').problems).toEqual(['Not a prefab: it isn’t JSON.']);
    expect(readPrefab('{"format":"zip"}').problems[0]).toMatch(/format isn’t vcgs-prefab/);
    expect(readPrefab(JSON.stringify({ ...pre, version: 9 })).problems[0]).toMatch(/newer studio/);
    expect(readPrefab(JSON.stringify({ ...pre, items: [{ id: 'x' }] })).problems[0]).toMatch(/missing what a piece must have/);
  });

  it('keeps the project’s prefabs, and the starter ones are ready to place', () => {
    const t = tomb();
    const pre = makePrefab(t.project, [t.rooms.treasury], { name: 'Treasury' })!;
    const p = savePrefab(t.project, pre);
    expect(prefabsOf(p).map((x) => x.name)).toEqual(['Treasury']);
    expect(prefabsOf(removePrefab(p, pre.id))).toEqual([]);
    const starters = starterPrefabs();
    expect(starters.map((s) => s.name)).toEqual(['Guard post', 'Lever and gate', 'Locked vault', 'Trapped passage']);
    // The vault: placed, its key opens its door.
    const vault = starters.find((s) => s.name === 'Locked vault')!;
    expect(vault.objects.map((o) => o.name)).toEqual(['Vault Key']);
    const b = blank();
    const out = placePrefab(b.p, b.levelId, b.floorId, vault, { x: 0, y: 0 });
    const made = items(out.project, out.ids);
    const door = made.find((i) => i.name === 'Vault door')!;
    expect(door.host).toBeDefined();
    let s = startLevelPlay(out.project, b.levelId);
    s = interactWith(out.project, s, made.find((i) => i.name === 'Vault Key')!.id);
    s = interactWith(out.project, s, door.id);
    expect(isOpen(out.project, s, door)).toBe(true);
  });

  it('marketplace hooks: a catalog lists prefabs, each downloaded only if its SHA-256 matches', async () => {
    const t = tomb();
    const text = prefabText(makePrefab(t.project, [t.rooms.treasury], { name: 'Treasury' })!);
    const sum = await sha256(text);
    expect(sum).toMatch(/^[0-9a-f]{64}$/);
    const index = JSON.stringify({
      format: 'vcgs-prefab-catalog',
      version: 1,
      name: 'Tomb kits',
      prefabs: [
        { id: 'treasury', name: 'Treasury', url: 'packs/treasury.json', sha256: sum, author: 'A. Maker', license: 'CC-BY-4.0' },
        { id: 'tampered', name: 'Tampered', url: 'packs/tampered.json', sha256: sum },
        { id: 'deluxe', name: 'Deluxe crypt', page: 'https://example.com/deluxe', price: '$4' },
        { id: 'plain-http', name: 'Insecure', url: 'http://example.com/x.json', sha256: sum },
        { id: 'unsigned', name: 'No checksum', url: 'packs/x.json' },
      ],
    });
    const fetcher = serve({ 'https://kits.example.com/index.json': index, 'https://kits.example.com/packs/treasury.json': text, 'https://kits.example.com/packs/tampered.json': text.replace('Treasury', 'Treasurx') });
    const got = await fetchCatalog('https://kits.example.com/index.json', fetcher);
    expect(got.catalog!.name).toBe('Tomb kits');
    expect(got.catalog!.entries.map((e) => e.id)).toEqual(['treasury', 'tampered', 'deluxe']);
    expect(got.problems[0]).toMatch(/^2 of its entries were left out/);
    const [ok, bad, sold] = got.catalog!.entries;
    expect((await fetchListed(ok!, fetcher)).prefab?.name).toBe('Treasury');
    expect((await fetchListed(bad!, fetcher)).problems[0]).toMatch(/SHA-256 differs/);
    expect(sold).toMatchObject({ price: '$4', page: 'https://example.com/deluxe' });
    expect((await fetchListed(sold!, fetcher)).problems).toEqual(['This one is got from its page.']);
    expect((await fetchCatalog('http://kits.example.com/index.json', fetcher)).problems).toEqual(['A catalog address must start with https://.']);
    expect((await fetchCatalog('https://kits.example.com/missing.json', fetcher)).problems).toEqual(['The catalog couldn’t be read (404).']);
    expect(readCatalog('https://x.example/i.json', '{"format":"other"}').problems[0]).toMatch(/Not a prefab catalog/);
    expect(safeUrl('http://localhost:8080/i.json')).toBe('http://localhost:8080/i.json');
    expect(safeUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('the starter lever and gate', () => {
  it('works where it is placed: the lever is reached first and lifts the portcullis', () => {
    const pre = starterPrefabs().find((s) => s.name === 'Lever and gate')!;
    const b = blank();
    const out = placePrefab(b.p, b.levelId, b.floorId, pre, { x: 0, y: 0 });
    const made = items(out.project, out.ids);
    const gate = made.find((i) => i.name === 'Portcullis')!;
    expect(gate.host?.id).toBeDefined();
    expect(made.find((i) => i.name === 'Lever')!.params?.works).toBe(gate.id);
    let s = startLevelPlay(out.project, b.levelId);
    s = interactWith(out.project, s, made.find((i) => i.name === 'Lever')!.id);
    expect(isOpen(out.project, s, gate)).toBe(true);
  });
});
