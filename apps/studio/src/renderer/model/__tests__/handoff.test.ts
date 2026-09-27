import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineEdits, ENGINES, planHandoff, recordExport, setTarget, targetOf } from '../handoff';
import { moveItems } from '../level/level';
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
      { verb: 'Pull', when: 'down', becomes: 'up' },
    ]);
    // Conditions travel as data with engine keys in place of ids.
    expect(ir.triggers.find((t) => t.name === 'Seam drains')).toMatchObject({
      rule: { match: 'all', items: [{ kind: 'object', ref: 'rusted_lever', op: 'is', value: 'up' }] },
      effects: [{ kind: 'setFlag', ref: 'door_solved', value: 'yes' }],
    });
    expect(door.main[4]!.ends).toEqual({ match: 'all', items: [{ kind: 'flag', ref: 'door_solved', op: 'is', value: 'yes' }] });
    // The choice's own availability gates its event; its main option spends the key.
    expect(door.main[5]!.when!.items).toHaveLength(2);
    expect(door.main[5]!.effects).toEqual([{ kind: 'take', ref: 'vault_key' }, { kind: 'arc', ref: 'mara', amount: 1 }]);
    expect(ir.flags.find((f) => f.name === 'door_solved')!.setBy).toEqual(['seam_drains']);
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
    // The lever, the scene that lists it, and the trigger whose rule watches it.
    expect(edited.rows.filter((r) => r.status !== 'ready').map((r) => r.label).sort()).toEqual(['Old Lever', 'SC-03 The Vault Door', 'Seam drains', 'Sunken Vault']);
    expect(edited.rows.find((r) => r.label === 'Mara')!.status).toBe('ready');
  });

  it('lists the engines, every one ready', () => {
    expect(ENGINES.map((e) => [e.id, e.available])).toEqual([
      ['godot', true],
      ['unity', true],
      ['unreal', true],
      ['custom', true],
    ]);
    const p = setTarget(sunkenVault(), { engine: 'unity' });
    expect(targetOf(p).outputPath).toBe('Assets/VCGS/Generated');
    expect(planHandoff(p).output).not.toBeNull();
    expect(targetOf(setTarget(sunkenVault(), { engine: 'unreal' })).outputPath).toBe('Content/VCGS/Generated');
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

describe('Godot placeholder scenes', () => {
  it('writes a .tscn per scene with its elements, and one to play the story, unless turned off', async () => {
    const { generateGodot } = await import('../handoff/godot');
    const ir = buildIR(sunkenVault());
    const out = generateGodot(ir, 'res://vcgs/generated');
    const vault = out.files.find((f) => f.path === 'vcgs/generated/scenes/sc_03_the_vault_door.tscn')!.content;
    expect(vault).toContain('[gd_scene load_steps=');
    expect(vault).toContain('[node name="RustedLever" type="Node2D" parent="Objects"]');
    expect(vault).toContain('[node name="Interactable" type="Node" parent="Objects/RustedLever" groups=["vcgs_interactable"]]');
    expect(vault).toContain('path="res://vcgs/generated/objects/rusted_lever.gd"');
    expect(vault).toContain('flow_path = NodePath("../Flow")');
    // load_steps counts every external resource, plus one.
    expect(Number(/load_steps=(\d+)/.exec(vault)![1])).toBe((vault.match(/\[ext_resource /g) ?? []).length + 1);
    expect(out.files.some((f) => f.path === 'vcgs/generated/play_story.tscn')).toBe(true);
    expect(out.files.find((f) => f.path.endsWith('story_graph.gd'))!.content).toContain(`const START := "${ir.graph.find((n) => n.kind === 'begin')!.key}"`);
    const off = generateGodot(ir, 'res://vcgs/generated', { placeholderScenes: false });
    // Levels are scenes in their own right, not placeholders: they stay.
    expect(off.files.some((f) => f.path.endsWith('.tscn') && !f.path.includes('/levels/'))).toBe(false);
  });
});

describe('the JSON adapter', () => {
  it('writes the story, its schema and how to play it, one row per element', async () => {
    const { json, storySchema, JSON_FORMAT } = await import('../handoff/json');
    const ir = buildIR(sunkenVault());
    const out = json.generate!(ir, 'vcgs');
    expect(out.files.map((f) => f.path)).toEqual(['vcgs/story.json', 'vcgs/story.schema.json', 'vcgs/README.md']);
    const story = JSON.parse(out.files[0]!.content);
    expect(story).toMatchObject({ ...JSON_FORMAT, $schema: './story.schema.json', project: { name: 'The Sunken Vault' } });
    expect(story.scenes.find((s: { name: string }) => s.name === 'The Vault Door').main[4].ends).toEqual({ match: 'all', items: [{ kind: 'flag', ref: 'door_solved', op: 'is', value: 'yes' }] });
    // Every top-level key the schema requires is there.
    for (const key of storySchema().required) expect(story).toHaveProperty(key);
    expect(out.elements.find((e) => e.label === 'Rusted Lever')!.files).toEqual(['vcgs/story.json']);
  });
});

describe('the Unity adapter', () => {
  it('writes the runtime, story.json, keys and an asset per element, each with a stable .meta', async () => {
    const { generateUnity, guidFor } = await import('../handoff/unity');
    const out = generateUnity(buildIR(sunkenVault()), 'Assets/VCGS/Generated');
    const paths = out.files.map((f) => f.path);
    for (const f of paths.filter((x) => !x.endsWith('.meta'))) expect(paths).toContain(`${f}.meta`);
    expect(paths).toContain('Assets/VCGS.meta');
    const keys = out.files.find((f) => f.path.endsWith('StoryKeys.cs'))!.content;
    expect(keys).toContain('public const string Sc03TheVaultDoor = "sc_03_the_vault_door";');
    const mara = out.files.find((f) => f.path === 'Assets/VCGS/Generated/Characters/mara.asset')!.content;
    expect(mara).toContain(`m_Script: {fileID: 11500000, guid: ${guidFor('Assets/VCGS/Runtime/VcgsCharacter.cs')}, type: 3}`);
    expect(out.files.find((f) => f.path === 'Assets/VCGS/Runtime/VcgsCharacter.cs.meta')!.content).toContain(`guid: ${guidFor('Assets/VCGS/Runtime/VcgsCharacter.cs')}`);
    expect(guidFor('a')).toMatch(/^[0-9a-f]{32}$/);
    expect(guidFor('a')).toBe(guidFor('a'));
    const cin = out.files.find((f) => f.path.endsWith('Cinematics/door_in_the_dark.asset'))!.content;
    expect(cin).toContain('- framing: "Close-up"');
    expect(cin).toContain('seconds: 7.5');
  });
});

describe('the Unreal adapter', () => {
  it('writes the plugin, story.json, keys, DataTable CSVs and their import script', async () => {
    const { generateUnreal } = await import('../handoff/unreal');
    const out = generateUnreal(buildIR(sunkenVault()), 'Content/VCGS/Generated');
    const file = (path: string) => out.files.find((f) => f.path === path)!.content;
    expect(out.files.map((f) => f.path)).toEqual(expect.arrayContaining(['Plugins/VCGS/VCGS.uplugin', 'Plugins/VCGS/Source/VCGS/Public/VcgsCore.h', 'Content/VCGS/Generated/story.json']));
    expect(file('Plugins/VCGS/Source/VCGS/Public/Generated/VcgsStoryKeys.h')).toContain('constexpr const TCHAR* Sc03TheVaultDoor = TEXT("sc_03_the_vault_door");');
    const characters = file('Content/VCGS/Generated/DataTables/Characters.csv').split('\n');
    expect(characters[0]).toBe('---,Key,Code,DisplayName,Description,Role,Arc,Color');
    expect(characters.find((l) => l.startsWith('mara,'))).toContain('(R=0.851,G=0.376,B=0.478,A=1.000)');
    // A cell with a comma or a line break is quoted as CSV.
    expect(file('Content/VCGS/Generated/DataTables/Locations.csv')).toContain('"lighting: Lantern only\nambience: Dripping, a low echo"');
    expect(file('Content/VCGS/Generated/DataTables/Shots.csv').trim().split('\n')).toHaveLength(4);
    expect(file('Content/VCGS/Generated/import_datatables.py')).toContain('"Characters": "/Script/VCGS.VcgsCharacterRow",');
    expect(JSON.parse(file('Plugins/VCGS/VCGS.uplugin')).Modules[0]).toEqual({ Name: 'VCGS', Type: 'Runtime', LoadingPhase: 'Default' });
  });
});

describe('level export', () => {
  const engines = ['godot', 'unity', 'unreal', 'custom'] as const;

  it('gives every engine a row for the level and its items with GUIDs, placed the same way', () => {
    for (const engine of engines) {
      const plan = planHandoff(setTarget(sunkenVault(), { engine }));
      const level = plan.levels[0]!;
      expect(plan.rows.find((r) => r.id === level.guid)).toMatchObject({ label: 'Sunken Vault', symbol: 'environment' });
      expect(level.key).toBe('sunken_vault');
      expect(level.items.length).toBeGreaterThan(10);
      for (const item of level.items) {
        expect(item.guid).toMatch(/^[0-9a-f-]{36}$/);
        expect(item.export_name).toMatch(/^[A-Z]+_[A-Za-z0-9]+_[A-Za-z0-9]+_\d{3}$/);
      }
      expect(level.start).not.toBeNull();
    }
  });

  it('writes each engine its level files', () => {
    const paths = (engine: (typeof engines)[number]) => planHandoff(setTarget(sunkenVault(), { engine })).output!.files.map((f) => f.path);
    expect(paths('godot')).toEqual(expect.arrayContaining(['addons/vcgs_runtime/level.gd', 'vcgs/generated/levels/sunken_vault.tscn', 'vcgs/generated/levels/play_sunken_vault.tscn']));
    expect(paths('unity')).toEqual(expect.arrayContaining(['Assets/VCGS/Runtime/Levels/VcgsLevel.cs', 'Assets/VCGS/Editor/VcgsLevelBuilder.cs', 'Assets/VCGS/Generated/Levels/sunken_vault.json']));
    expect(paths('unreal')).toEqual(expect.arrayContaining(['Plugins/VCGS/Source/VCGS/Public/VcgsLevelDirector.h', 'Content/VCGS/Generated/Levels/build_level.py', 'Content/VCGS/Generated/Levels/sunken_vault.json']));
    const godot = planHandoff(sunkenVault());
    const tscn = godot.output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!.content;
    for (const item of godot.levels[0]!.items) expect(tscn).toContain(`metadata/vcgs_guid = "${item.guid}"`);
  });

  it('puts the levels in the JSON story and its schema', () => {
    const plan = planHandoff(setTarget(sunkenVault(), { engine: 'custom' }));
    const file = (end: string) => JSON.parse(plan.output!.files.find((f) => f.path.endsWith(end))!.content);
    expect(file('story.json').levels[0]).toMatchObject({ key: 'sunken_vault', name: 'Sunken Vault' });
    const schema = file('story.schema.json');
    expect(schema.properties.levels).toBeDefined();
    expect(schema.$defs.levelItem.required).toEqual(expect.arrayContaining(['guid', 'export_name', 'position', 'pieces']));
  });

  it('says which items are new, changed or removed since the last export', () => {
    let p = sunkenVault();
    const first = planHandoff(p);
    expect(first.levelChanges.added).toHaveLength(first.levels[0]!.items.length);
    p = recordExport(p, first);
    expect(planHandoff(p).levelChanges).toMatchObject({ added: [], changed: [], removed: [] });
    const items = first.levels[0]!.items;
    // Something standing on its own: not a door in a wall, and nothing hung on it.
    const moved = items.find((i) => !i.host && !items.some((o) => o.host?.guid === i.guid) && i.kind !== 'volume')!;
    p = moveItems(p, [moved.guid], 1, 0);
    const after = planHandoff(p);
    expect(after.levelChanges.changed).toEqual([moved.guid]);
    expect(after.rows.find((r) => r.id === after.levels[0]!.guid)!.status).toBe('changed');
  });

  it('points out generated files changed in the engine, and keeps pointing them out when kept', () => {
    let p = sunkenVault();
    const plan = planHandoff(p);
    p = recordExport(p, plan);
    const last = p.handoff!.last!;
    const tscn = plan.output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!;
    const onDisk = Object.fromEntries(plan.output!.files.map((f) => [f.path, f.content]));
    const again = planHandoff(p);
    expect(engineEdits(again, last, onDisk)).toEqual([]);
    // Missing files are not edits: they are simply written again.
    expect(engineEdits(again, last, { ...onDisk, [tscn.path]: null })).toEqual([]);
    const edited = { ...onDisk, [tscn.path]: tscn.content + '\n[node name="Mine" type="Node3D" parent="."]\n' };
    expect(engineEdits(again, last, edited)).toEqual([tscn.path]);
    // Keeping the engine's version keeps the old hash, so it is still an edit next time.
    const kept = recordExport(p, again, undefined, [tscn.path]);
    expect(engineEdits(planHandoff(kept), kept.handoff!.last, edited)).toEqual([tscn.path]);
    // Overwriting forgets it.
    const overwritten = recordExport(p, again);
    expect(engineEdits(planHandoff(overwritten), overwritten.handoff!.last, onDisk)).toEqual([]);
  });

  it('flags engine-specific preflight on the level row', () => {
    const unreal = planHandoff(setTarget(sunkenVault(), { engine: 'unreal' }));
    const godot = planHandoff(sunkenVault());
    expect(unreal.issues.length).toBeGreaterThanOrEqual(godot.issues.length);
  });
});
