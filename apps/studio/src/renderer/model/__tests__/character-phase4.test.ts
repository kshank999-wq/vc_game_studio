import { describe, expect, it } from 'vitest';
import { groupsOf } from '../character/groups';
import { addSampleCast } from '../character/samples';
import { generateVariants } from '../character/variants';
import { characterIssues, characters, patchBinding, patchPlaceholder, profileOf, updateProfile } from '../character/profile';
import { castReport, runScenario, type IrCast } from '../handoff/cast';
import { castSchema } from '../handoff/cast-files';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { addLevel, placeAsset, resizeItem, setParam } from '../level/level';
import { createProject, renameObject } from '../project';
import type { EngineId, Project } from '../types';

// ---------------------------------------------------------------- a small JSON Schema 2020-12 checker (the subset castSchema uses)

type Schema = Record<string, unknown>;

const validate = (root: Schema, value: unknown): string[] => {
  const errors: string[] = [];
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const check = (s: Schema, v: unknown, at: string): boolean => {
    const before = errors.length;
    if (typeof s.$ref === 'string') return check((root.$defs as Record<string, Schema>)[s.$ref.replace('#/$defs/', '')]!, v, at);
    if (s.anyOf) {
      const ok = (s.anyOf as Schema[]).some((sub) => {
        const n = errors.length;
        const good = check(sub, v, at);
        errors.length = n;
        return good;
      });
      if (!ok) errors.push(`${at}: matches none of anyOf`);
      return errors.length === before;
    }
    if ('const' in s && v !== s.const) errors.push(`${at}: should be ${String(s.const)}`);
    if (s.enum && !(s.enum as unknown[]).includes(v)) errors.push(`${at}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`);
    if (s.type) {
      const want = s.type as string;
      const got = typeOf(v);
      if (!(want === got || (want === 'number' && got === 'number') || (want === 'integer' && Number.isInteger(v)))) errors.push(`${at}: should be ${want}, is ${got}`);
    }
    if (typeof v === 'string' && typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) errors.push(`${at}: "${v}" doesn't match ${s.pattern}`);
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems) errors.push(`${at}: too few items`);
      if (typeof s.maxItems === 'number' && v.length > s.maxItems) errors.push(`${at}: too many items`);
      if (s.items) v.forEach((item, i) => check(s.items as Schema, item, `${at}[${i}]`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const props = (s.properties ?? {}) as Record<string, Schema>;
      for (const k of (s.required ?? []) as string[]) if (!(k in o)) errors.push(`${at}: missing ${k}`);
      for (const [k, val] of Object.entries(o)) {
        if (props[k]) check(props[k]!, val, `${at}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${at}: unexpected ${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties as Schema, val, `${at}.${k}`);
      }
    }
    return errors.length === before;
  };
  check(root, value, '$');
  return errors;
};

// ---------------------------------------------------------------- the project: the sample cast, a market and a placed sentry

const setup = () => {
  let p: Project = addLevel(createProject('Test'), 'Square').project;
  p = addSampleCast(p).project;
  const level = p.levels!.levels[0]!;
  const floor = level.floors[0]!.id;
  const area = placeAsset(p, level.id, floor, 'actor.group', { x: 0, y: 0 });
  p = setParam(area.project, area.ids[0]!, 'group', groupsOf(area.project).find((g) => g.name === 'Village Market')!.id);
  p = resizeItem(p, area.ids[0]!, { w: 12, d: 12 });
  const orc = placeAsset(p, level.id, floor, 'actor.enemy', { x: 10, y: 10 });
  const sentry = characters(orc.project).find((c) => c.name === 'Orc Sentry')!;
  p = setParam(orc.project, orc.ids[0]!, 'character', sentry.id);
  p = updateProfile(p, sentry.id, (prof) => ({ ...prof, variants: generateVariants(p, profileOf(sentry), 'Orc Sentry', 2) }));
  return { p, sentryId: sentry.id, areaId: area.ids[0]!, orcItem: orc.ids[0]! };
};

const exportFor = (p: Project, engine: EngineId) => planHandoff(setTarget(p, { engine })).output!;
const fileOf = (out: ReturnType<typeof exportFor>, end: string) => out.files.find((f) => f.path.endsWith(end));
const castOf = (p: Project): IrCast => buildIR(p).cast!;

describe('characters.json (character spec §10, §14)', () => {
  it('is valid against its own schema, in every engine, with characters, variants, groups and placements', () => {
    const { p } = setup();
    for (const engine of ['godot', 'unity', 'unreal', 'custom'] as EngineId[]) {
      const out = exportFor(p, engine);
      const data = JSON.parse(fileOf(out, '/characters.json')!.content);
      const schema = JSON.parse(fileOf(out, '/characters.schema.json')!.content);
      expect(validate(schema, data), engine).toEqual([]);
      expect(data.characters.length).toBe(characters(p).length);
      expect(data.characters.find((c: { key: string }) => c.key === 'orc_sentry').variants).toHaveLength(2);
      expect(data.groups.map((g: { name: string }) => g.name)).toEqual(['Village Market', 'Orc Patrol']);
      expect(data.placements.map((x: { kind: string }) => x.kind).sort()).toEqual(['actor', 'group']);
      // One manifest per character and group, and a report.
      expect(fileOf(out, '/characters/orc_sentry.json')).toBeTruthy();
      expect(fileOf(out, '/groups/village_market.json')).toBeTruthy();
      expect(fileOf(out, '/CHARACTERS.md')!.content).toContain('# Characters in');
    }
  });

  it('catches what the schema forbids', () => {
    const { p } = setup();
    const cast = castOf(p);
    const bad = JSON.parse(JSON.stringify(cast));
    bad.characters[0].stats.speed = 'fast';
    bad.characters[0].roles = ['wizard'];
    bad.characters[0].extra_field = 1;
    const errors = validate(castSchema(), bad);
    expect(errors.some((e) => e.includes('speed'))).toBe(true);
    expect(errors.some((e) => e.includes('roles[0]'))).toBe(true);
    expect(errors.some((e) => e.includes('unexpected extra_field'))).toBe(true);
  });

  it('keeps story.json without the cast: it is characters.json’s', () => {
    const { p } = setup();
    // Godot writes the story as resources, not story.json.
    for (const engine of ['unity', 'unreal', 'custom'] as EngineId[]) {
      const story = fileOf(exportFor(p, engine), '/story.json');
      expect(story, engine).toBeTruthy();
      expect(JSON.parse(story!.content).cast, engine).toBeUndefined();
    }
  });

  it('places the group’s people where the studio put them, with stable ids and the level’s turn', () => {
    const { p, areaId, orcItem } = setup();
    const a = castOf(p);
    const b = castOf(p);
    const market = a.placements.find((x) => x.kind === 'group')!;
    expect(market.item).toBe(areaId);
    expect(market.members.length).toBeGreaterThan(0);
    expect(market.members.every((m, i) => m.id === `${areaId}#${i}` || m.id.startsWith(`${areaId}#`))).toBe(true);
    expect(b.placements).toEqual(a.placements);
    const orc = a.placements.find((x) => x.kind === 'actor')!;
    expect(orc.members[0]!.id).toBe(orcItem);
    expect(orc.members[0]!.position).toEqual([10, expect.any(Number), 10]);
  });
});

describe('stable ids and asset bindings (spec §11)', () => {
  it('swapping the art changes nothing but the binding: same key, id, inventory, dialogue and AI', () => {
    const { p, sentryId } = setup();
    const before = castOf(p).characters.find((c) => c.id === sentryId)!;
    const bound = patchBinding(p, sentryId, { finalModel: 'res://art/orc.glb', rig: 'humanoid', animations: ['idle', 'walk', 'attack'] });
    const after = castOf(bound).characters.find((c) => c.id === sentryId)!;
    expect(after.binding.final_model).toBe('res://art/orc.glb');
    const { binding: _a, revision: _ra, ...restBefore } = before;
    const { binding: _b, revision: _rb, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
  });

  it('keeps the key when the character is renamed', () => {
    const { p, sentryId } = setup();
    const renamed = renameObject(p, sentryId, 'Orc Watchman');
    const c = castOf(renamed).characters.find((x) => x.id === sentryId)!;
    expect(c.name).toBe('Orc Watchman');
    expect(c.key).toBe('orc_sentry');
    expect(c.story_key).toBe('orc_watchman');
    expect(castOf(renamed).ids[sentryId]).toBe('orc_sentry');
  });

  it('reports a rig mismatch, ability cues with no animation, and missing idle or walk', () => {
    const { p } = setup();
    const hound = characters(p).find((c) => c.name === 'Loyal Hound')!;
    let q = patchPlaceholder(p, hound.id, { silhouette: 'beast' });
    q = patchBinding(q, hound.id, { finalModel: 'res://art/hound.glb', rig: 'humanoid', animations: ['run'] });
    const text = characterIssues(q, hound.id)
      .filter((i) => i.area === 'art')
      .map((i) => i.text)
      .join('\n');
    expect(text).toContain('humanoid rig on a four-legged');
    expect(text).toContain('no “idle” animation');
    expect(text).toContain('no “walk” animation');
    const sentry = characters(q).find((c) => c.name === 'Orc Sentry')!;
    const cued = profileOf(sentry).abilities.find((a) => a.enabled);
    expect(cued).toBeTruthy();
    const r = patchBinding(q, sentry.id, { finalModel: 'res://art/orc.glb', rig: 'none', animations: ['idle', 'walk'], sockets: { hand: '', offHand: '', head: '' } });
    const orcText = characterIssues(r, sentry.id)
      .map((i) => i.text)
      .join('\n');
    expect(orcText).toContain('no rig, but the character moves');
    expect(orcText).toContain('no hand socket');
  });

  it('says nothing about bindings while the placeholder stands in', () => {
    const { p, sentryId } = setup();
    expect(characterIssues(p, sentryId).filter((i) => i.area === 'art' && i.severity !== 'info')).toEqual([]);
  });
});

describe('the export report: no false assurances (spec §10)', () => {
  it('lists what the starter runtime does and leaves the rest as TODOs, per engine', () => {
    const { p } = setup();
    const cast = castOf(p);
    for (const engine of ['godot', 'unity', 'unreal'] as EngineId[]) {
      const report = castReport(cast, engine);
      const todo = report.filter((r) => r.severity === 'todo').map((r) => r.about);
      expect(todo, engine).toEqual(expect.arrayContaining(['Navigation', 'Animation', 'Effects']));
      expect(report.find((r) => r.about === 'Runtime' && r.severity === 'info'), engine).toBeTruthy();
    }
    // The JSON adapter has no runtime: it says so instead of claiming one.
    const json = castReport(cast, 'custom');
    expect(json.find((r) => r.about === 'Runtime')!.severity).toBe('todo');
    expect(json.some((r) => r.text.includes('run in the starter runtime'))).toBe(false);
  });

  it('names stub abilities and scheduled groups as TODOs, and bound art as mapped', () => {
    const { p, sentryId } = setup();
    const bound = patchBinding(p, sentryId, { finalModel: '/Game/Art/SK_Orc', rig: 'humanoid', animations: ['idle', 'walk'] });
    const cast = castOf(bound);
    const report = castReport(cast, 'unreal');
    const stubs = cast.characters.flatMap((c) => c.abilities.filter((a) => a.enabled && a.graybox === 'stub' && a.source === 'library').map((a) => a.name));
    for (const name of stubs) expect(report.some((r) => r.severity === 'todo' && r.text.startsWith(`${name} is a stub`))).toBe(true);
    expect(report.find((r) => r.about === 'Orc Sentry' && r.text.includes('/Game/Art/SK_Orc'))!.severity).toBe('info');
    for (const g of cast.groups.filter((x) => x.schedule !== 'always')) expect(report.some((r) => r.about === g.name && r.severity === 'todo')).toBe(true);
  });
});

describe('the engines get the runtime and a row per character and group', () => {
  it('writes each engine’s components beside the data', () => {
    const { p } = setup();
    const want: Record<string, string[]> = {
      godot: ['characters/cast.gd', 'characters/character.gd', 'characters/perception.gd', 'characters/behavior.gd', 'characters/abilities.gd', 'characters/inventory.gd', 'characters/equipment.gd', 'characters/dialogue.gd', 'characters/spawn_group.gd'],
      unity: ['Characters/VcgsCast.cs', 'Characters/VcgsActor.cs', 'Characters/VcgsActorPerception.cs', 'Characters/VcgsActorBehavior.cs', 'Characters/VcgsActorAbilities.cs', 'Characters/VcgsActorInventory.cs', 'Characters/VcgsActorEquipment.cs', 'Characters/VcgsActorDialogue.cs', 'Characters/VcgsSpawnGroup.cs'],
      unreal: ['Public/VcgsCast.h', 'Public/VcgsActorComponents.h', 'Public/VcgsCharacterActor.h', 'Public/VcgsSpawnGroup.h', 'Private/VcgsActorComponents.cpp', 'Private/VcgsCharacterActor.cpp', 'Private/VcgsSpawnGroup.cpp'],
    };
    for (const [engine, ends] of Object.entries(want)) {
      const out = exportFor(p, engine as EngineId);
      for (const end of ends) expect(fileOf(out, end), `${engine} ${end}`).toBeTruthy();
      // Unity: every file has its .meta.
      if (engine === 'unity') for (const end of ends) expect(fileOf(out, `${end}.meta`), end).toBeTruthy();
      const rows = out.elements.map((e) => e.id);
      for (const c of characters(p)) expect(rows).toContain(`cast:${c.id}`);
      for (const g of groupsOf(p)) expect(rows).toContain(`group:${g.id}`);
    }
  });

  it('writes nothing for characters when there is no cast', () => {
    const p = addLevel(createProject('Bare'), 'Square').project;
    for (const engine of ['godot', 'unity', 'unreal', 'custom'] as EngineId[]) {
      const out = exportFor(p, engine);
      expect(fileOf(out, '/characters.json'), engine).toBeUndefined();
      expect(out.elements.some((e) => e.id.startsWith('cast:')), engine).toBe(false);
    }
  });
});

describe('the AI scenarios the engine ports replay', () => {
  it('runs the studio’s machine on a character from the export, deterministically', () => {
    const { p } = setup();
    const orc = castOf(p).characters.find((c) => c.key === 'orc_sentry')!;
    const scenario = { name: 'sees', patrol: [[0, 0], [10, 0]] as [number, number][], walls: [] as [[number, number], [number, number]][], dt: 0.1, target: { x: 8, y: 0, vx: 0, vy: 0, noisy: false }, steps: 60 };
    const a = runScenario(orc, scenario);
    expect(a.trail[0]).toMatch(/^Patrol → Alert: Sees it 8\.0 m away/);
    expect(a.final.state).toBe('attack');
    expect(a.final.attacks).toBeGreaterThan(0);
    expect(runScenario(orc, scenario)).toEqual(a);
    // Behind a wall it never sees the target.
    const blind = runScenario(orc, { ...scenario, name: 'wall', walls: [[[4, -3], [4, 3]]], steps: 20 });
    expect(blind.trail.some((t) => t.includes('Sees it'))).toBe(false);
  });
});
