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
    expect(door.main.map((e) => e.kind)).toEqual(['cinematic', 'dialogue', 'dialogue', 'action', 'freePlay', 'choice']);
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
    expect(door.main[5]!.effects).toEqual([{ kind: 'take', ref: 'vault_key' }, { kind: 'arc', ref: 'mara', amount: 1 }, { kind: 'completeQuest', ref: 'open_the_vault' }]);
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
    expect(out.files.map((f) => f.path)).toEqual(['vcgs/story.json', 'vcgs/story.schema.json', 'vcgs/README.md', 'vcgs/TASKS.md']);
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
    expect(file('Content/VCGS/Generated/DataTables/Locations.csv')).toContain('"codex: A drowned hall under the old city, its bronze door sealed by the Order.\nlighting: Lantern only\nambience: Dripping, a low echo"');
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
    expect(first.levelChanges.added).toHaveLength(first.levels.flatMap((l) => l.items).length);
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

  it('sends a freeform space as its outline, with slab floors that every engine builds', () => {
    const plan = planHandoff(sunkenVault());
    const chamber = plan.levels[0]!.items.find((i) => i.name === 'Vault Chamber')!;
    expect(chamber.outline).toHaveLength(8);
    const floor = chamber.pieces.find((p) => p.part === 'floor')!;
    expect(floor).toMatchObject({ shape: 'slab', turn: 0 });
    expect(floor.outline).toHaveLength(8);
    expect(floor.triangles).toHaveLength(6 * 3);
    // Eight walls, one per edge (the doors' walls in more than one piece).
    expect(new Set(chamber.pieces.filter((p) => p.part === 'wall').map((p) => p.turn)).size).toBeGreaterThanOrEqual(4);
    const tscn = plan.output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!.content;
    expect(tscn).toContain('type="CSGPolygon3D"');
    expect(tscn).toContain('[sub_resource type="ConcavePolygonShape3D"');
    const unreal = planHandoff(setTarget(sunkenVault(), { engine: 'unreal' })).output!.files;
    expect(JSON.parse(unreal.find((f) => f.path === 'Plugins/VCGS/VCGS.uplugin')!.content).Plugins).toEqual([{ Name: 'ProceduralMeshComponent', Enabled: true }]);
    const schema = JSON.parse(planHandoff(setTarget(sunkenVault(), { engine: 'custom' })).output!.files.find((f) => f.path.endsWith('story.schema.json'))!.content);
    expect(schema.$defs.piece.properties.shape.enum).toContain('slab');
  });

  it('sends a freeform volume as its outline, a convex prism per triangle where triggers must be convex', async () => {
    const { slabPrisms } = await import('../handoff/levels');
    const plan = planHandoff(sunkenVault());
    const echo = plan.levels[0]!.items.find((i) => i.name === 'Dripping echo')!;
    expect(echo.outline).toHaveLength(8);
    const zone = echo.pieces.find((p) => p.part === 'volume')!;
    expect(zone).toMatchObject({ shape: 'slab', size: [10, 4.5, 8] });
    const prisms = slabPrisms(zone);
    expect(prisms).toHaveLength(6);
    expect(prisms.every((p) => p.length === 6 && p.slice(0, 3).every((c) => c[1] === 2.25) && p.slice(3).every((c) => c[1] === -2.25))).toBe(true);
    const tscn = plan.output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!.content;
    expect(tscn.match(/\[sub_resource type="ConvexPolygonShape3D"/g)).toHaveLength(6);
  });

  it('flags engine-specific preflight on the level row', () => {
    const unreal = planHandoff(setTarget(sunkenVault(), { engine: 'unreal' }));
    const godot = planHandoff(sunkenVault());
    expect(unreal.issues.length).toBeGreaterThanOrEqual(godot.issues.length);
  });
});

describe('design definitions: lore, quests, mechanics and encounters', () => {
  const ir = () => buildIR(sunkenVault());

  it('are in the handoff model with their codes and fields, without studio-only lineage', () => {
    const { lore, quests, mechanics, encounters } = ir();
    expect([lore, quests, mechanics, encounters].map((l) => l.map((t) => `${t.code} ${t.ident.key}`))).toEqual([['LORE-01 the_drowned_order', 'LORE-02 the_last_expedition'], ['QST-01 open_the_vault'], ['MEC-01 lantern_oil'], ['ENC-01 eel_swarm']]);
    expect(mechanics[0]!.fields).toEqual({ controls: 'Hold to raise the lantern', tuning: 'About a minute of deep water on a full lantern' });
    const withLineage = { ...sunkenVault() };
    const id = Object.values(withLineage.objects).find((o) => o.type === 'mechanic')!.id;
    withLineage.objects = { ...withLineage.objects, [id]: { ...withLineage.objects[id]!, data: { ...withLineage.objects[id]!.data, fromNote: 'note_1' } } };
    expect(buildIR(withLineage).mechanics[0]!.fields).not.toHaveProperty('fromNote');
  });

  it('get a row on every engine and a file where the engine keeps element data', async () => {
    const { json, storySchema } = await import('../handoff/json');
    const { generateGodot } = await import('../handoff/godot');
    const { generateUnity } = await import('../handoff/unity');
    const { generateUnreal } = await import('../handoff/unreal');
    const outputs = { json: json.generate!(ir(), 'vcgs'), godot: generateGodot(ir(), 'vcgs/generated'), unity: generateUnity(ir(), 'Assets/VCGS/Generated'), unreal: generateUnreal(ir(), 'Content/VCGS/Generated') };
    for (const out of Object.values(outputs)) {
      expect(out.elements.filter((e) => ['lore', 'quest', 'mechanic', 'encounter'].includes(e.symbol)).map((e) => [e.label, e.group])).toEqual([
        ['LORE-01 The Drowned Order', 'World'],
        ['LORE-02 The Last Expedition', 'World'],
        ['QST-01 Open the vault', 'Story'],
        ['MEC-01 Lantern oil', 'Logic'],
        ['ENC-01 Eel swarm', 'World'],
      ]);
    }
    const file = (out: { files: { path: string; content: string }[] }, path: string) => out.files.find((f) => f.path === path)?.content;

    // JSON: in story.json and described by its schema.
    const story = JSON.parse(file(outputs.json, 'vcgs/story.json')!);
    expect(story.quests[0]).toMatchObject({ name: 'Open the vault', code: 'QST-01', fields: { goal: 'Reach the vault chamber and open the door' } });
    expect(Object.keys(storySchema().properties)).toEqual(expect.arrayContaining(['lore', 'quests', 'mechanics', 'encounters']));

    // Godot: a Resource class in the runtime and a .tres per definition.
    expect(file(outputs.godot, 'addons/vcgs_runtime/quest.gd')).toContain('class_name VCGSQuest');
    const eel = file(outputs.godot, 'vcgs/generated/encounters/eel_swarm.tres')!;
    expect(eel).toMatch(/script_class="VCGSEncounter"/);
    expect(eel).toContain('path="res://addons/vcgs_runtime/encounter.gd"');
    expect(eel).toContain('code = "ENC-01"');

    // Unity: a ScriptableObject class and an asset, each with a .meta; keys for code.
    expect(file(outputs.unity, 'Assets/VCGS/Runtime/VcgsLore.cs')).toContain('public sealed class VcgsLore : VcgsElement');
    expect(file(outputs.unity, 'Assets/VCGS/Generated/Lore/the_drowned_order.asset')).toContain('code: "LORE-01"');
    expect(file(outputs.unity, 'Assets/VCGS/Generated/Lore/the_drowned_order.asset.meta')).toBeDefined();
    expect(file(outputs.unity, 'Assets/VCGS/Generated/StoryKeys.cs')).toContain('public static partial class Mechanics');

    // Unreal: a DataTable CSV each, imported by the script, and keys.
    expect(file(outputs.unreal, 'Content/VCGS/Generated/DataTables/Mechanics.csv')!.split('\n').slice(1, 3).join('\n')).toBe('lantern_oil,lantern_oil,MEC-01,Lantern oil,The lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.,"controls: Hold to raise the lantern\ntuning: About a minute of deep water on a full lantern"');
    expect(file(outputs.unreal, 'Content/VCGS/Generated/import_datatables.py')).toContain('"Encounters": "/Script/VCGS.VcgsElementRow",');
    expect(file(outputs.unreal, 'Plugins/VCGS/Source/VCGS/Public/Generated/VcgsStoryKeys.h')).toContain('namespace Quests');
  });
});

describe('quests and encounters in the engines', () => {
  it('carry their rules in the handoff model, as the studio plays them', async () => {
    const ir = buildIR(sunkenVault());
    // The sample's quest starts, and completes, by effects: finding the key and turning it.
    expect(ir.quests[0]).toMatchObject({ byEffect: true });
    expect(ir.quests[0]).not.toHaveProperty('starts');
    expect(ir.quests[0]).not.toHaveProperty('completes');
    expect(ir.encounters[0]).toMatchObject({ ident: { key: 'eel_swarm' }, loss: 'retry' });
    const theKey = ir.scenes.find((s) => s.name === 'The Key')!;
    expect(theKey.main[0]).toMatchObject({ kind: 'encounter', ref: 'eel_swarm', label: 'Eel swarm' });
    const { storySchema } = await import('../handoff/json');
    // Read as plain JSON, the way a game would.
    const schema = JSON.parse(JSON.stringify(storySchema()));
    expect(schema.$defs.encounter.allOf[1].properties.loss.enum).toEqual(['retry', 'gameOver', 'carryOn']);
    expect(schema.$defs.event.properties.kind.enum).toContain('encounter');
  });

  it('are played by each runtime: quests settle with the rules, encounters wait for win or lose', async () => {
    const { generateGodot } = await import('../handoff/godot');
    const { RUNTIME_FILES } = await import('../handoff/unity-runtime');
    const { VCGS_CORE_H } = await import('../handoff/unreal-core');
    const godot = generateGodot(buildIR(sunkenVault()), 'vcgs/generated');
    const file = (path: string) => godot.files.find((f) => f.path === path)!.content;
    expect(file('vcgs/generated/logic/rules.gd')).toContain('const QUESTS := {\n\t"open_the_vault": {');
    expect(file('vcgs/generated/logic/rules.gd')).toContain('"loss": "retry"');
    expect(file('addons/vcgs_runtime/scene_flow.gd')).toContain('signal encounter_requested(encounter_key: String, can_win: bool)');
    // The placeholder scenes' player has a codex of the lore found.
    const player = file('addons/vcgs_runtime/debug_player.gd');
    expect(player).toContain('func codex_text(query := "", section := "", sort := "", cursor := "") -> String:');
    expect(player).toContain('game.lore_discovered.connect(_on_codex_news)');
    // P prints the notes: the same page as the studio's.
    expect(player).toContain('func print_codex_notes(path := "user://codex_notes.html", open := true) -> String:');
    expect(RUNTIME_FILES['VcgsCodex.cs']).toContain('public string PrintNotes(string path = null, bool open = true)');
    // M emails them: the same mail link as the studio's.
    expect(player).toContain('func email_codex_notes(open := true) -> Dictionary:');
    expect(RUNTIME_FILES['VcgsCodex.cs']).toContain('public string EmailNotes(bool open = true)');
    // T texts them: the same text-message link as the studio's.
    expect(player).toContain('func text_codex_notes(open := true) -> Dictionary:');
    expect(RUNTIME_FILES['VcgsCodex.cs']).toContain('public string TextNotes(bool open = true)');
    // F5 saves and F9 loads, in the same format everywhere, as each scene began.
    expect(player).toContain('func save_game(path := "user://savegame.json") -> String:');
    expect(file('addons/vcgs_runtime/scene_flow.gd')).toContain('game.checkpoint(scene_key())');
    expect(RUNTIME_FILES['GameState.cs']).toContain('public string LoadSave(string text)');
    expect(VCGS_CORE_H).toContain('bool LoadSave(const std::string& text, std::string& At)');
    expect(player).toContain('game.quest_started.connect(_on_codex_news)');
    // Unity and Unreal have one too: the same text, a screen to draw it.
    expect(RUNTIME_FILES['Codex.cs']).toContain('public string Text(string query = "", string section = "", string sort = "", string cursor = "")');
    expect(RUNTIME_FILES['VcgsCodex.cs']).toContain('public sealed class VcgsCodex : MonoBehaviour');
    expect(VCGS_CORE_H).toContain('class Codex');
    const { PLUGIN_FILES } = await import('../handoff/unreal');
    expect(PLUGIN_FILES['Source/VCGS/Public/VcgsCodexHUD.h']).toContain('class VCGS_API AVcgsCodexHUD : public AHUD');
    expect(PLUGIN_FILES['VCGS.Build.cs'] ?? PLUGIN_FILES['Source/VCGS/VCGS.Build.cs']).toContain('"InputCore"');
    expect(RUNTIME_FILES['ScenePlayer.cs']).toContain('public event Action<string, bool> EncounterRequested;');
    expect(RUNTIME_FILES['Rules.cs']).toContain('foreach (var q in game.Story.Quests)');
    expect(VCGS_CORE_H).toContain('std::function<void(const std::string&, bool)> OnEncounter;');
  });
});

describe('lore and mechanics in the engines', () => {
  it('carry their rules, and every runtime settles them', async () => {
    const ir = buildIR(sunkenVault());
    expect(ir.lore[0]).toMatchObject({ discoveredWhen: { match: 'all', items: [{ kind: 'visited', ref: 'sc_03_the_vault_door', op: 'visited' }] } });
    expect(ir.mechanics[0]).toMatchObject({ byEffect: true, fields: { tuning: 'About a minute of deep water on a full lantern' } });
    expect(ir.mechanics[0]).not.toHaveProperty('availableWhen');
    expect(ir.scenes.find((s) => s.name === 'The Cave Mouth')!.main[0]).toMatchObject({ kind: 'action', label: 'Light the lantern', effects: [{ kind: 'enableMechanic', ref: 'lantern_oil' }, { kind: 'give', ref: 'diving_knife' }] });
    const { generateGodot } = await import('../handoff/godot');
    const { RUNTIME_FILES } = await import('../handoff/unity-runtime');
    const { VCGS_CORE_H } = await import('../handoff/unreal-core');
    const rules = generateGodot(ir, 'vcgs/generated').files.find((f) => f.path === 'vcgs/generated/logic/rules.gd')!.content;
    expect(rules).toContain('const LORE := {\n\t"the_drowned_order": {');
    expect(rules).toContain('static func mechanic_detail(mechanic_key: String, field: String) -> String:');
    expect(RUNTIME_FILES['Rules.cs']).toContain('game.DiscoverLore(l.Key);');
    expect(RUNTIME_FILES['Story.cs']).toContain('public string MechanicDetail(string key, string field)');
    expect(VCGS_CORE_H).toContain('game.EnableMechanic(m.first);');
    const { storySchema } = await import('../handoff/json');
    const schema = JSON.parse(JSON.stringify(storySchema()));
    expect(schema.properties.lore.items).toEqual({ $ref: '#/$defs/lore' });
  });
});

describe('conditions on quests, lore and mechanics in the engines', () => {
  it('go to every engine as plain conditions, and the schema allows them', async () => {
    const ir = buildIR(sunkenVault());
    expect(ir.encounters[0]!.winWhen).toEqual({ match: 'all', items: [{ kind: 'mechanic', ref: 'lantern_oil', op: 'available' }] });
    const { storySchema } = await import('../handoff/json');
    const condition = JSON.parse(JSON.stringify(storySchema())).$defs.condition.properties;
    expect(condition.kind.enum).toEqual(expect.arrayContaining(['quest', 'lore', 'mechanic']));
    expect(condition.op.enum).toEqual(expect.arrayContaining(['done', 'notDone', 'active', 'notStarted', 'known', 'unknown', 'available', 'unavailable']));
  });
});

describe('effects that start quests and reveal lore, in the engines', () => {
  it('reach every rule engine, and the schema allows them', async () => {
    const { storySchema } = await import('../handoff/json');
    const { generateGodot } = await import('../handoff/godot');
    const { RUNTIME_FILES } = await import('../handoff/unity-runtime');
    const { VCGS_CORE_H } = await import('../handoff/unreal-core');
    const effect = JSON.parse(JSON.stringify(storySchema())).$defs.effect.properties;
    expect(effect.kind.enum).toEqual(expect.arrayContaining(['startQuest', 'revealLore', 'completeQuest', 'enableMechanic']));
    const engine = generateGodot(buildIR(sunkenVault()), 'vcgs/generated').files.find((f) => f.path === 'addons/vcgs_runtime/rule_engine.gd')!.content;
    expect(engine).toContain('"revealLore":');
    expect(RUNTIME_FILES['Rules.cs']).toContain('case "startQuest":');
    expect(VCGS_CORE_H).toContain('kind == "revealLore"');
    expect(engine).toContain('VCGSRules.complete_quest(ref, game)');
    expect(RUNTIME_FILES['Rules.cs']).toContain('case "enableMechanic": game.EnableMechanic(reference); break;');
    expect(VCGS_CORE_H).toContain('inline void CompleteQuest(const std::string& quest, GameState& game)');
  });
});
