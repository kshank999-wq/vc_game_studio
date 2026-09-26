import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINES, planHandoff, recordExport, setTarget, targetOf } from '../handoff';
import { gd } from '../handoff/godot';
import { buildIR, identifiers, toKey, toType } from '../handoff/ir';
import { zip } from '../handoff/zip';
import { renameObject } from '../project';
import { sunkenVault } from '../sample';

describe('the handoff model', () => {
  it('names every element once, in engine-safe words', () => {
    expect(toKey('The Vault Door')).toBe('the_vault_door');
    expect(toKey('Brother’s journal')).toBe('brothers_journal');
    expect(toType('sc_05_the_vault_door')).toBe('Sc05TheVaultDoor');
    expect(toKey('3 keys')).toBe('n_3_keys');
    const p = sunkenVault();
    const keys = [...identifiers(p).entries()].map(([id, i]) => `${p.objects[id]!.type}:${i.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flattens the story the engines need', () => {
    const ir = buildIR(sunkenVault());
    expect(ir.spine.map((n) => n.kind)).toEqual(['begin', 'scene', 'choice', 'plotPoint', 'scene', 'scene', 'cinematic', 'choice', 'end']);
    const door = ir.scenes.find((s) => s.name === 'The Vault Door')!;
    expect(door.main.map((e) => e.kind)).toEqual(['cinematic', 'dialogue', 'action', 'dialogue', 'freePlay', 'choice']);
    expect(door.branches).toEqual([expect.objectContaining({ label: 'Force it', from: 5, rejoin: 4 })]);
    expect(ir.objects.find((o) => o.name === 'Rusted Lever')!.interactions).toEqual([
      { verb: 'Pull', when: 'down', becomes: 'up', sets: { flag: 'door_solved', value: 'yes' }, fires: 'seam_drains' },
    ]);
    // A spine choice carries on along the spine as well as down its branch.
    expect(ir.choices.find((c) => c.name === 'Take the lantern')!.options.map((o) => o.label)).toEqual(['Carry on', 'Crawl through']);
  });
});

describe('the Godot adapter', () => {
  it('writes GDScript literals Godot reads', () => {
    expect(gd('say "hi"\n')).toBe('"say \\"hi\\"\\n"');
    expect(gd({ a: 1, b: [true, null] })).toBe('{\n\t"a": 1,\n\t"b": [\n\t\ttrue,\n\t\tnull,\n\t],\n}');
    expect(gd({ flag: 'x', value: 'y' })).toBe('{ "flag": "x", "value": "y" }');
  });

  it('generates the runtime once and a file for every element', () => {
    const plan = planHandoff(sunkenVault());
    const paths = plan.output!.files.map((f) => f.path);
    expect(paths).toContain('addons/vcgs_runtime/game_state.gd');
    expect(paths).toContain('vcgs/generated/scenes/sc_03_the_vault_door.gd');
    expect(paths).toContain('vcgs/generated/characters/mara.tres');
    expect(paths).toContain('vcgs/generated/objects/rusted_lever.gd');
    expect(paths).toContain('vcgs/generated/production/.gdignore');
    expect(new Set(paths).size).toBe(paths.length);
    const mara = plan.output!.files.find((f) => f.path.endsWith('mara.tres'))!.content;
    expect(mara).toMatch(/^\[gd_resource type="Resource" script_class="VCGSCharacter" load_steps=2 format=3\]/);
    expect(mara).toContain('role = "Main"');
    expect(plan.blocking).toEqual([]);
  });

  it('follows the output folder the target names', () => {
    const p = setTarget(sunkenVault(), { outputPath: 'res://game/story' });
    expect(planHandoff(p).output!.files.some((f) => f.path === 'game/story/logic/rules.gd')).toBe(true);
  });
});

describe('export status', () => {
  it('is changed until sent, ready after, and changed again for what is edited', () => {
    let p = sunkenVault();
    const first = planHandoff(p);
    expect(first.rows.every((r) => r.status === 'changed')).toBe(true);
    p = recordExport(p, first);
    const after = planHandoff(p);
    expect(after.changed).toBe(0);
    const lever = Object.values(p.objects).find((o) => o.name === 'Rusted Lever')!;
    p = renameObject(p, lever.id, 'Old Lever');
    const edited = planHandoff(p);
    // The lever, the scene that lists it, and the flag it sets (which records what sets it).
    expect(edited.rows.filter((r) => r.status !== 'ready').map((r) => r.label).sort()).toEqual(['Old Lever', 'SC-03 The Vault Door', 'door_solved']);
    expect(edited.rows.find((r) => r.label === 'Mara')!.status).toBe('ready');
  });

  it('lists the engines to come, with Godot ready now', () => {
    expect(ENGINES.map((e) => [e.id, e.available])).toEqual([
      ['godot', true],
      ['unity', false],
      ['unreal', false],
      ['custom', false],
    ]);
    const p = setTarget(sunkenVault(), { engine: 'unity' });
    expect(targetOf(p).outputPath).toBe('Assets/VCGS/Generated');
    expect(planHandoff(p).output).toBeNull();
  });
});

describe('the zip download', () => {
  it('is a valid zip of every file', () => {
    const plan = planHandoff(sunkenVault());
    const bytes = zip(plan.output!.files);
    const dir = mkdtempSync(join(tmpdir(), 'vcgs-'));
    const file = join(dir, 'handoff.zip');
    writeFileSync(file, bytes);
    const listing = execFileSync('unzip', ['-t', file]).toString();
    expect(listing).toContain('No errors detected');
    expect(listing).toContain('vcgs/generated/characters/mara.tres');
  });
});
