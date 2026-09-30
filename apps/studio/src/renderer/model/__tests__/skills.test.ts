import { describe, expect, it } from 'vitest';
import { checkPath, pathOf } from '../paths';
import { applyStoryEffects, learn, learnSkillIn, playToDecision, startPlay, startWorld } from '../play';
import { describeCondition, describeEffect, evaluate } from '../rules';
import { learnCheck, skillsOf } from '../skills';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;

describe('skills, abilities and upgrades (spec §8)', () => {
  it('are learned rank by rank, after what they need, when their rule holds, paying their cost', () => {
    const p = sunkenVault();
    const breath = byName(p, 'Deep Breath').id;
    const hood = byName(p, 'Lantern Hood').id;
    const salvage = byName(p, 'Salvage').id;
    const oil = byName(p, 'Lantern oil').id;
    expect(skillsOf(p).map((o) => o.name)).toEqual(['Deep Breath', 'Lantern Hood']);
    let world = startWorld(p);
    // The hood needs Deep Breath first.
    expect(learnCheck(p, world, hood)).toMatchObject({ ok: false, needs: 'Learn Deep Breath first.' });
    // Deep Breath is free, two ranks.
    let r = learnSkillIn(p, world, breath);
    expect(r.log).toEqual([{ kind: 'skill', text: 'Deep Breath', rank: 1, ranks: 2 }]);
    world = r.world;
    expect(learnCheck(p, world, hood).needs).toBe('Needs Lantern oil is available.');
    world = learnSkillIn(p, world, breath).world;
    expect(learnCheck(p, world, breath)).toMatchObject({ ok: false, rank: 2, ranks: 2, needs: 'All 2 ranks learned.' });
    world = { ...world, mechanics: { [oil]: true } };
    expect(learnCheck(p, world, hood).needs).toBe('Costs 2 × Salvage (you have 0).');
    // Winning against the eels leaves two salvage: enough.
    world = applyStoryEffects(p, world, byName(p, 'Eel swarm').data.effects as never).world;
    expect(world.items[salvage]).toBe(2);
    r = learnSkillIn(p, world, hood);
    expect(r.log.map((e) => e.text)).toEqual(['pay 2 × Salvage', 'Lantern Hood']);
    expect(r.world.items[salvage]).toBe(0);
    expect(r.world.skills[hood]).toBe(1);
    expect(learnSkillIn(p, r.world, hood).needs).toBe('Learned.');
  });

  it('can be asked about by conditions, given by an effect, and do what learning them does', () => {
    let p = sunkenVault();
    const breath = byName(p, 'Deep Breath').id;
    const door = byName(p, 'door_solved').id;
    p = { ...p, objects: { ...p.objects, [breath]: { ...p.objects[breath]!, data: { ...p.objects[breath]!.data, effects: [{ kind: 'setFlag', ref: door, value: 'yes' }] } } } };
    const twice = { kind: 'skill' as const, ref: breath, op: 'atLeast' as const, value: 2 };
    const learned = { kind: 'skill' as const, ref: breath, op: 'atLeast' as const, value: 1 };
    expect(describeCondition(p, learned)).toBe('Deep Breath is learned');
    expect(describeCondition(p, twice)).toBe('Deep Breath at rank 2+');
    expect(describeCondition(p, { ...learned, op: 'below' })).toBe('Deep Breath is not learned');
    expect(describeEffect(p, { kind: 'learnSkill', ref: breath })).toBe('give a rank of Deep Breath');
    const given = applyStoryEffects(p, startWorld(p), [{ kind: 'learnSkill', ref: breath }]);
    expect(evaluate({ match: 'all', items: [learned] }, given.world)).toBe(true);
    expect(evaluate({ match: 'all', items: [twice] }, given.world)).toBe(false);
    // Learning it did what it does.
    expect(given.world.flags[door]).toBe('yes');
    // An effect gives ranks only up to the skill's ranks.
    const capped = applyStoryEffects(p, given.world, [{ kind: 'learnSkill', ref: breath }, { kind: 'learnSkill', ref: breath }]);
    expect(capped.world.skills[breath]).toBe(2);
  });

  it('are decisions on a path, replayed when the path is checked', () => {
    const p = sunkenVault();
    const breath = byName(p, 'Deep Breath').id;
    let play = playToDecision(p, startPlay(p));
    play = learn(p, play, breath);
    expect(play.decisions!.at(-1)).toEqual({ kind: 'learn', at: breath });
    expect(play.world.skills[breath]).toBe(1);
    const path = pathOf(play, 'Learns to breathe', undefined, 1);
    expect(checkPath(p, path)).toMatchObject({ ok: true });
    // Deep Breath is gone: the path can't learn it.
    const { [breath]: _, ...rest } = p.objects;
    expect(checkPath({ ...p, objects: rest }, path).problem).toMatch(/can't be learned: Not a skill\.$/);
  });
});

describe('skills in the handoff', () => {
  it('go to every engine with their ranks, cost, what they need first, when and what they do', async () => {
    const { buildIR } = await import('../handoff/ir');
    const { json, storySchema } = await import('../handoff/json');
    const { generateGodot } = await import('../handoff/godot');
    const { generateUnity } = await import('../handoff/unity');
    const { generateUnreal } = await import('../handoff/unreal');
    const ir = buildIR(sunkenVault());
    expect(ir.skills.map((k) => [k.ident.key, k.ranks, k.cost, k.requires, k.learnWhenText ?? null, k.fields.kind, k.fields.tree])).toEqual([
      ['deep_breath', 2, null, [], null, 'Skill', 'Diving'],
      ['lantern_hood', 1, { item: 'salvage', name: 'Salvage', amount: 2 }, ['deep_breath'], 'Lantern oil is available', 'Upgrade', 'Diving'],
    ]);
    expect(ir.encounters[0]!.onWin!.filter((e) => e.ref === 'salvage')).toEqual([{ kind: 'give', ref: 'salvage' }, { kind: 'give', ref: 'salvage' }]);
    const story = JSON.parse(json.generate!(ir, 'vcgs').files[0]!.content);
    expect(story.skills).toHaveLength(2);
    expect(storySchema().properties.skills).toBeTruthy();
    expect(generateGodot(ir, 'res://vcgs/generated').files.map((f) => f.path)).toEqual(expect.arrayContaining(['vcgs/generated/skills/deep_breath.tres', 'addons/vcgs_runtime/skill.gd']));
    expect(generateUnity(ir, 'Assets/VCGS/Generated').files.find((f) => f.path.endsWith('StoryKeys.cs'))!.content).toContain('public static partial class Skills');
    expect(generateUnreal(ir, 'Content/VCGS/Generated').files.find((f) => f.path.endsWith('DataTables/Skills.csv'))!.content).toContain('deep_breath');
  });
});
