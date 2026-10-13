import { describe, expect, it } from 'vitest';
import { aiProblems, aiStep, defaultAI, startMemory, type AIMemory, type AIProfile, type AIWorld } from '../character/ai';
import { characterIssues, createCharacter, patchAI, patchRole, profileOf, promoteExtra, replaceCharacter, retireCharacter, setVariants, updateVariant, usesOf } from '../character/profile';
import { differencesOf, difficultyOf, encounterCost, generateVariants, resolveVariant } from '../character/variants';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;

/** Run the machine until a state (or a step limit), returning the states it went through with why. */
const run = (ai: AIProfile, world: AIWorld, steps: number, until?: (m: AIMemory) => boolean, move?: (w: AIWorld, i: number) => void) => {
  let m = startMemory(world, ai, 100);
  const trail: string[] = [];
  for (let i = 0; i < steps; i++) {
    move?.(world, i);
    const r = aiStep(ai, 4, m, world, 0.1);
    m = r.memory;
    if (r.reason) trail.push(r.reason);
    if (until?.(m)) break;
  }
  return { m, trail };
};

describe('the enemy AI profile and state machine (spec §6.2)', () => {
  it('patrols, sees the player in its cone, reacts, chases, attacks, and says why', () => {
    const ai = defaultAI();
    // The orc's post at the origin, patrolling east; the player ahead of it, 8 m away.
    const world: AIWorld = { patrol: [{ x: 0, y: 0 }, { x: 10, y: 0 }], walls: [], target: { x: 8, y: 0, noisy: false, alive: true } };
    const { m, trail } = run(ai, world, 200, (x) => x.attacks > 0);
    expect(trail[0]).toMatch(/^Patrol → Alert: Sees it 8\.0 m away/);
    expect(trail[1]).toMatch(/^Alert → Chase: Sees it/);
    expect(trail[2]).toMatch(/^Chase → Attack: In attack range/);
    expect(m.state).toBe('attack');
    expect(m.attacks).toBe(1);
  });

  it('doesn’t see behind it or through walls, but hears a noisy player, and senses one right beside it', () => {
    const ai = defaultAI();
    const behind: AIWorld = { patrol: [{ x: 0, y: 0 }, { x: 10, y: 0 }], walls: [], target: { x: -5, y: 0, noisy: false, alive: true } };
    expect(run(ai, behind, 5).trail).toEqual([]);
    behind.target.noisy = true;
    expect(run(ai, behind, 5).trail[0]).toMatch(/^Patrol → Investigate: Hears it/);
    const walled: AIWorld = { patrol: [{ x: 0, y: 0 }, { x: 10, y: 0 }], walls: [[{ x: 4, y: -3 }, { x: 4, y: 3 }]], target: { x: 8, y: 0, noisy: false, alive: true } };
    expect(run(ai, walled, 5).trail).toEqual([]);
    const near: AIWorld = { patrol: [{ x: 0, y: 0 }], walls: [], target: { x: -1, y: 0, noisy: false, alive: true } };
    expect(run({ ...ai, start: 'idle' }, near, 2).trail[0]).toMatch(/Idle → Chase: It is 1\.0 m away, inside its 2 m proximity radius/);
  });

  it('disengages at its configured distance from its post, then returns', () => {
    const ai: AIProfile = { ...defaultAI(), disengageDistance: 15, chaseTimeout: 100 };
    const world: AIWorld = { patrol: [{ x: 0, y: 0 }, { x: 1, y: 0 }], walls: [], target: { x: 6, y: 0, noisy: false, alive: true } };
    // The player runs away east, faster than the orc.
    const { trail } = run(ai, world, 400, (m) => m.state === 'return', (w) => (w.target.x += 0.6));
    expect(trail.at(-1)).toMatch(/^Chase → Return: 15\.\d m from its post, past its 15 m disengage distance/);
  });

  it('gives up a chase it can’t see for its chase timeout, searches, and goes back', () => {
    const ai: AIProfile = { ...defaultAI(), chaseTimeout: 1, searchSeconds: 1 };
    const world: AIWorld = { patrol: [{ x: 0, y: 0 }, { x: 10, y: 0 }], walls: [], target: { x: 8, y: 0, noisy: false, alive: true } };
    let lost = false;
    const { trail } = run(ai, world, 300, (m) => lost && m.state === 'patrol', (w, i) => {
      if (i === 15) w.target.alive = false;
      lost = i > 15;
    });
    expect(trail.some((t) => t.startsWith('Chase → Search: Hasn’t seen it for 1 s'))).toBe(true);
    expect(trail.some((t) => t.startsWith('Search → Return:'))).toBe(true);
    expect(trail.at(-1)).toMatch(/^Return → Patrol: Back at its post/);
  });

  it('checks the machine: unreachable states, dead ends, nothing to attack with', () => {
    const ai = defaultAI();
    expect(aiProblems(ai, { hasAttack: true })).toEqual([]);
    const cut: AIProfile = { ...ai, transitions: ai.transitions.filter((t) => t.to !== 'search') };
    expect(aiProblems(cut, { hasAttack: false }).map((x) => x.text)).toEqual(expect.arrayContaining(['Nothing leads to Search.', 'It has an Attack state but no combat or magic ability to attack with.']));
    expect(aiProblems({ ...ai, start: 'idle', states: ai.states.filter((s) => s !== 'idle') }, { hasAttack: true })[0]!.text).toBe('It starts in Idle, but that state is off.');
  });
});

describe('enemy variants (spec §6.2)', () => {
  it('generates Orc → Orc Guard → Orc Elite, each inheriting the base and listing what differs, with distinct loadouts', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Orc', roles: ['enemy'], archetype: 'orc' });
    p = made.project;
    const knife = byName(p, 'Diving Knife').id;
    const pistol = byName(p, 'Flare Pistol').id;
    const base0 = profileOf(p.objects[made.id]!);
    // The base carries the weaker weapon.
    expect(base0.inventory.equipment.find((e) => e.slot === 'Hand')).toEqual({ slot: 'Hand' });
    const variants = generateVariants(p, { ...base0, inventory: { ...base0.inventory, items: [{ item: pistol, qty: 1 }], equipment: base0.inventory.equipment.map((e) => (e.slot === 'Hand' ? { slot: 'Hand', item: pistol } : e)) } }, 'Orc', 2);
    expect(variants.map((v) => v.name)).toEqual(['Orc Guard', 'Orc Elite']);
    p = setVariants(p, made.id, variants);
    const base = profileOf(p.objects[made.id]!);
    const [guard, elite] = base.variants as [typeof variants[0], typeof variants[0]];
    expect(guard.levels).toEqual({ min: 5, max: 8 });
    expect(elite.levels).toEqual({ min: 9, max: 12 });
    const g = resolveVariant(base, guard);
    const e = resolveVariant(base, elite);
    // Same archetype, harder.
    expect(g.archetype).toBe('Orc');
    expect(e.archetype).toBe('Orc');
    expect(e.stats.health).toBeGreaterThan(g.stats.health);
    expect(g.stats.health).toBeGreaterThan(base.stats.health);
    expect(e.ai.viewDistance).toBeGreaterThan(base.ai.viewDistance);
    expect(e.ai.reaction).toBeLessThan(base.ai.reaction);
    expect(e.abilities.some((a) => a.name === 'Block')).toBe(true);
    expect(g.abilities.some((a) => a.name === 'Block')).toBe(false);
    expect(difficultyOf(e)).toBeGreaterThan(difficultyOf(g));
    // Inherits what it doesn't change: the base's radius.
    expect(g.stats.radius).toBe(base.stats.radius);
    const diffs = differencesOf(p, base, guard).map((d) => d.label);
    expect(diffs).toEqual(expect.arrayContaining(['Health', 'Speed', 'Damage', 'Sight distance', 'Reaction time']));
    // Distinct loadouts by hand: the level-5 guard with the knife, the elite with the pistol.
    p = updateVariant(p, made.id, guard.id, { equipment: [{ slot: 'Hand', item: knife }] });
    p = updateVariant(p, made.id, elite.id, { equipment: [{ slot: 'Hand', item: pistol }] });
    const after = profileOf(p.objects[made.id]!);
    expect(resolveVariant(after, after.variants[0]!).inventory.equipment.find((x) => x.slot === 'Hand')!.item).toBe(knife);
    expect(resolveVariant(after, after.variants[1]!).inventory.equipment.find((x) => x.slot === 'Hand')!.item).toBe(pistol);
    // A change to the base reaches a variant that doesn't override it.
    p = patchAI(p, made.id, { hearingRadius: 9 });
    const b2 = profileOf(p.objects[made.id]!);
    expect(resolveVariant(b2, b2.variants[0]!).ai.hearingRadius).toBe(9);
  });

  it('keeps to its guardrails: growth, attackers, patrol area and the spawn budget', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Orc', roles: ['enemy'], archetype: 'orc' });
    p = made.project;
    const base = profileOf(p.objects[made.id]!);
    const [v] = generateVariants(p, base, 'Orc', 1);
    p = setVariants(p, made.id, [{ ...v!, stats: { health: 999 }, groupSize: 8, ai: { ...v!.ai, disengageDistance: 50 } }]);
    const texts = characterIssues(p, made.id).filter((i) => i.area === 'variants').map((i) => i.text);
    expect(texts.some((t) => t.includes('health grows 8.3× the base, past the 3× limit'))).toBe(true);
    expect(texts.some((t) => t.includes('groups of 8, but only 3 may attack at once'))).toBe(true);
    expect(texts.some((t) => t.includes('past its 30 m patrol area'))).toBe(true);
    expect(texts.some((t) => t.includes('past the encounter budget of 40'))).toBe(true);
    expect(encounterCost(base, { ...v!, groupSize: 1 })).toBeLessThan(40);
  });
});

describe('role settings and the registry’s integrity (spec §6.3–6.5, §12)', () => {
  it('validates an NPC’s services, topics and links', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Fen', roles: ['npc'], archetype: 'villager' });
    p = made.project;
    p = patchRole(p, made.id, 'npc', { services: ['vendor', 'info'], topics: [{ id: 't1', name: 'The vault', knowledge: 'It floods at high tide', lines: ['line_gone'] }] });
    const texts = characterIssues(p, made.id).filter((i) => i.area === 'dialogue').map((i) => i.text);
    expect(texts).toEqual(expect.arrayContaining(['A vendor with nothing to sell.', 'A vendor without the Trade ability: add it so the engines know to open a shop.', 'The vault: 1 of its lines is no longer in the script.']));
    expect(profileOf(p.objects[made.id]!).npc.prompt).toBe('Talk to Fen');
  });

  it('promotes an extra to an NPC without losing it, retires, and replaces a character everywhere', () => {
    let p = sunkenVault();
    const extra = createCharacter(p, { name: 'Villager', roles: ['extra'], archetype: 'villager' });
    p = promoteExtra(extra.project, extra.id);
    expect(profileOf(p.objects[extra.id]!).roles).toEqual(['npc']);
    p = retireCharacter(p, extra.id);
    expect(profileOf(p.objects[extra.id]!).enabled).toBe(false);
    const mara = byName(p, 'Mara').id;
    const before = usesOf(p, mara);
    expect(before.lines).toBeGreaterThan(0);
    p = replaceCharacter(p, mara, extra.id);
    expect(p.objects[mara]).toBeUndefined();
    const after = usesOf(p, extra.id);
    expect(after.lines).toBe(before.lines);
    expect(after.scenes.length).toBe(before.scenes.length);
    expect(after.actors).toEqual(before.actors);
  });
});
