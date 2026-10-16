import { describe, expect, it } from 'vitest';
import { applyChanges, changesFrom, describeChange, parseChanges, type EngineChanges } from '../handoff/changes';
import { buildIR } from '../handoff/ir';
import { itemById, levelsOf } from '../level/level';
import { exportNameOf } from '../level/naming';
import { sunkenVault } from '../sample';

/** What an engine's exporter writes for a project untouched in the engine. */
const asSent = (p = sunkenVault()): EngineChanges => ({
  format: 'vcgs-changes',
  version: 1,
  engine: 'godot',
  levels: buildIR(p).levels.map((l) => ({ guid: l.guid, items: l.items.map((i) => ({ guid: i.guid, name: i.export_name, position: i.position, turn: i.turn })), added: [] })),
});

describe('bringing engine-side changes back', () => {
  it('an untouched level comes back with nothing to take', () => {
    const p = sunkenVault();
    expect(changesFrom(p, asSent(p))).toEqual([]);
  });

  it('reads the file, and says what is wrong with one that isn’t', () => {
    expect(parseChanges('nope')).toBe('This isn’t a JSON file.');
    expect(parseChanges('{"format":"other"}')).toMatch(/isn’t a vcgs-changes.json/);
    expect(parseChanges(JSON.stringify({ format: 'vcgs-changes', version: 2, levels: [] }))).toMatch(/version 2/);
    const ok = parseChanges(JSON.stringify(asSent()));
    expect(typeof ok).toBe('object');
  });

  it('finds what moved, was renamed, deleted or added, and takes what is chosen', () => {
    const p = sunkenVault();
    const file = asSent(p);
    const vault = file.levels.find((l) => levelsOf(p).levels.find((x) => x.id === l.guid)?.name === 'Sunken Vault')!;
    const set = levelsOf(p);
    const free = vault.items.filter((i) => !set.items.find((x) => x.id === i.guid)!.host);
    const [moved, renamed, gone] = [free[0]!, free[1]!, free[2]!];
    moved.position = [moved.position[0] + 2, moved.position[1], moved.position[2] - 1];
    moved.turn += 90;
    // An engine name keeps only letters, digits and underscores; a _2 to keep names apart isn't a rename.
    free[3]!.name = `${free[3]!.name}_2`;
    renamed.name = 'LeverMain';
    vault.items = vault.items.filter((i) => i !== gone);
    vault.added = [{ name: 'CameraHint', position: [1, 0, 2], turn: 45 }];
    const changes = changesFrom(p, file);
    expect(changes.map((c) => c.kind).sort()).toEqual(['added', 'deleted', 'moved', 'renamed']);
    expect(changes.map(describeChange).join(' | ')).toMatch(/moved 2\.24 m, turned to/);
    const q = applyChanges(p, changes);
    const m = itemById(q, moved.guid)!;
    expect([m.x, m.y]).toEqual([moved.position[0], moved.position[2]]);
    expect(exportNameOf(levelsOf(q), itemById(q, renamed.guid)!)).toBe('LeverMain');
    expect(itemById(q, gone.guid)).toBeUndefined();
    expect(levelsOf(q).items.some((i) => i.name === 'CameraHint' && i.assetId === 'nav.waypoint')).toBe(true);
    // Taken, the engine's copy and the studio's agree.
    const after = changesFrom(q, { ...file, levels: file.levels.map((l) => (l === vault ? { ...l, added: [] } : l)) });
    // (The waypoint made from what was added isn't in this file: the engine's copy of it has no GUID until the next handoff.)
    expect(after.filter((c) => c.kind !== 'added' && c.name !== 'CameraHint')).toEqual([]);
  });

  it('a door stays in its wall', () => {
    const p = sunkenVault();
    const file = asSent(p);
    const set = levelsOf(p);
    const door = file.levels.flatMap((l) => l.items).find((i) => set.items.find((x) => x.id === i.guid)?.host)!;
    door.position = [door.position[0] + 3, door.position[1], door.position[2]];
    expect(changesFrom(p, file).filter((c) => c.id === door.guid)).toEqual([]);
  });
});

describe('the exporters in the handoff', () => {
  it('Godot gets VCGSChanges and the script to run it', async () => {
    const { planHandoff, setTarget } = await import('../handoff');
    const files = planHandoff(setTarget(sunkenVault(), { engine: 'godot' })).output!.files;
    expect(files.find((f) => f.path.endsWith('/changes.gd'))!.content).toContain('class_name VCGSChanges');
    expect(files.find((f) => f.path.endsWith('/export_changes.gd'))!.content).toContain('VCGSChanges.write("res://vcgs/generated/levels", "res://vcgs/generated/vcgs-changes.json")');
  });
});
