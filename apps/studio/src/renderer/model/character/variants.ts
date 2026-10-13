import { equipmentOf } from '../equipment';
import { newId } from '../project';
import type { Project } from '../types';
import { abilityTemplate } from './abilities';
import type { AIProfile, AISkill, Tactics } from './ai';
import type { AbilityCard, CharacterProfile, CharacterStats } from './profile';

/**
 * Enemy variants (Character Creator spec §6.2): escalating versions of one
 * character (Orc → Orc Guard → Orc Elite) by level or encounter tier. A
 * variant keeps the base's archetype and lists only what differs: stats,
 * damage, ability ranks (and abilities added or taken away), loadout, AI
 * and how many come together. Everything else is inherited, so a change to
 * the base reaches every variant that doesn't override it.
 *
 * Guardrails keep the chain honest: how far stats may grow past the base,
 * how many may attack at once, how far from its patrol area it may chase,
 * and the encounter's spawn budget in difficulty points.
 */

export interface EnemyVariant {
  id: string;
  name: string;
  tier: number;
  /** The levels it may appear at. */
  levels: { min: number; max: number };
  stats: Partial<Pick<CharacterStats, 'speed' | 'health' | 'jump' | 'turn'>>;
  /** Multiplies the magnitude of its combat and magic abilities; 1 is the base’s. */
  damage: number;
  /** Ability card id → rank. */
  ranks: Record<string, number>;
  /** Library abilities it has that the base doesn’t. */
  add: string[];
  /** Base ability cards it doesn’t have. */
  remove: string[];
  /** Starting items it carries besides (or instead of) the base’s: a quantity of 0 takes one away. */
  items: { item: string; qty: number }[];
  /** Slot → what it has there instead. */
  equipment: { slot: string; item?: string }[];
  ai: Partial<Pick<AIProfile, 'viewDistance' | 'visionAngle' | 'hearingRadius' | 'reaction' | 'chaseTimeout' | 'disengageDistance' | 'tactics'>> & { skill?: Partial<AISkill> };
  /** How many come together. */
  groupSize: number;
  notes: string;
}

export interface VariantRules {
  /** How far any stat may grow past the base: 3 is up to three times. */
  maxGrowth: number;
  /** How many may attack the player at once. */
  maxAttackers: number;
  /** Metres: how far from its patrol area it may chase. */
  patrolRadius: number;
  /** Difficulty points one encounter may spend on these. */
  spawnBudget: number;
}

export const defaultVariantRules = (): VariantRules => ({ maxGrowth: 3, maxAttackers: 3, patrolRadius: 30, spawnBudget: 40 });

export const TIER_NAMES = ['Guard', 'Elite', 'Champion', 'Warlord', 'Legend'];

export const blankVariant = (name: string, tier: number): EnemyVariant => ({ id: newId('var'), name, tier, levels: { min: 1, max: 99 }, stats: {}, damage: 1, ranks: {}, add: [], remove: [], items: [], equipment: [], ai: {}, groupSize: 1, notes: '' });

const fights = (c: AbilityCard) => c.category === 'combat' || c.category === 'magic';

/** The variant as a whole character: the base with the variant's differences applied. */
export const resolveVariant = (base: CharacterProfile, v: EnemyVariant): CharacterProfile => {
  const stats = { ...base.stats, ...v.stats };
  const kept = base.abilities.filter((a) => !v.remove.includes(a.id)).map((a) => ({ ...a, rank: v.ranks[a.id] ?? a.rank }));
  const added: AbilityCard[] = v.add.flatMap((key) => {
    const t = abilityTemplate(key);
    return t && !kept.some((a) => a.source.kind === 'library' && a.source.key === key) ? [{ id: `${v.id}:${key}`, source: { kind: 'library' as const, key }, name: t.name, category: t.category, kind: t.kind, rank: v.ranks[`${v.id}:${key}`] ?? 1, enabled: true, overrides: {} }] : [];
  });
  const abilities = [...kept, ...added].map((a) => {
    if (v.damage === 1 || !fights(a)) return a;
    const base = (a.overrides.magnitude ?? (a.source.kind === 'library' ? abilityTemplate(a.source.key)?.defaults.magnitude : 0) ?? 0) as number;
    return { ...a, overrides: { ...a.overrides, magnitude: Math.round(base * v.damage * 10) / 10 } };
  });
  const items = [...base.inventory.items];
  for (const it of v.items) {
    const at = items.findIndex((x) => x.item === it.item);
    if (it.qty <= 0) {
      if (at >= 0) items.splice(at, 1);
    } else if (at >= 0) items[at] = { item: it.item, qty: it.qty };
    else items.push({ ...it });
  }
  const equipment = base.inventory.equipment.map((e) => {
    const o = v.equipment.find((x) => x.slot === e.slot);
    return o ? (o.item ? { slot: e.slot, item: o.item } : { slot: e.slot }) : e;
  });
  for (const e of equipment) if (e.item && !items.some((i) => i.item === e.item)) items.push({ item: e.item, qty: 1 });
  const ai: AIProfile = { ...base.ai, ...(v.ai as Partial<AIProfile>), skill: { ...base.ai.skill, ...(v.ai.skill ?? {}) } };
  return { ...base, stats, abilities, inventory: { ...base.inventory, items, equipment }, ai, variants: [] };
};

/** A rough difficulty in points (spec §6.2's budget): health, speed, damage, perception and skill. */
export const difficultyOf = (p: CharacterProfile): number => {
  const hit = p.abilities
    .filter((a) => a.enabled && fights(a))
    .reduce((n, a) => n + Number(a.overrides.magnitude ?? (a.source.kind === 'library' ? abilityTemplate(a.source.key)?.defaults.magnitude : 5) ?? 5) * (1 + (a.rank - 1) * 0.25), 0);
  const skill = Object.values(p.ai.skill).reduce((n, v) => n + v, 0) / 7;
  return Math.round((p.stats.health / 25 + p.stats.speed + hit / 5 + p.ai.viewDistance / 6 + skill / 20) * 10) / 10;
};

export interface Difference {
  label: string;
  base: string;
  value: string;
}

const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v ?? '—'));

/** What a variant changes, beside the base's value (spec §6.2: explicit differences). */
export const differencesOf = (project: Project, base: CharacterProfile, v: EnemyVariant): Difference[] => {
  const out: Difference[] = [];
  for (const [k, val] of Object.entries(v.stats)) if (val !== undefined && val !== base.stats[k as keyof CharacterStats]) out.push({ label: k[0]!.toUpperCase() + k.slice(1), base: fmt(base.stats[k as keyof CharacterStats]), value: fmt(val) });
  if (v.damage !== 1) out.push({ label: 'Damage', base: '×1', value: `×${fmt(v.damage)}` });
  for (const [id, rank] of Object.entries(v.ranks)) {
    const card = base.abilities.find((a) => a.id === id);
    if (card && rank !== card.rank) out.push({ label: `${card.name} rank`, base: String(card.rank), value: String(rank) });
  }
  for (const key of v.add) out.push({ label: abilityTemplate(key)?.name ?? key, base: '—', value: 'added' });
  for (const id of v.remove) out.push({ label: base.abilities.find((a) => a.id === id)?.name ?? 'An ability', base: 'has it', value: 'removed' });
  const name = (id?: string) => (id ? (project.objects[id]?.name ?? 'missing item') : 'empty');
  for (const it of v.items) out.push({ label: name(it.item), base: String(base.inventory.items.find((x) => x.item === it.item)?.qty ?? 0), value: String(it.qty) });
  for (const e of v.equipment) out.push({ label: `${e.slot} slot`, base: name(base.inventory.equipment.find((x) => x.slot === e.slot)?.item), value: name(e.item) });
  for (const [k, val] of Object.entries(v.ai)) {
    if (k === 'skill' || val === undefined) continue;
    out.push({ label: AI_LABEL[k] ?? k, base: fmt(base.ai[k as keyof AIProfile]), value: fmt(val) });
  }
  for (const [k, val] of Object.entries(v.ai.skill ?? {})) if (val !== undefined && val !== base.ai.skill[k as keyof AISkill]) out.push({ label: `${k[0]!.toUpperCase()}${k.slice(1)} skill`, base: fmt(base.ai.skill[k as keyof AISkill]), value: fmt(val) });
  if (v.groupSize !== 1) out.push({ label: 'Comes in groups of', base: '1', value: String(v.groupSize) });
  return out;
};

const AI_LABEL: Record<string, string> = { viewDistance: 'Sight distance', visionAngle: 'Vision cone', hearingRadius: 'Hearing', reaction: 'Reaction time', chaseTimeout: 'Chase timeout', disengageDistance: 'Disengage distance', tactics: 'Tactics' };

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Make a chain of variants, each a tier harder (spec §6.2): more health,
 * speed and damage, higher ranks, sharper perception and quicker reactions,
 * better tactics, bigger groups, a better weapon from the item library when
 * there is one for its hand, and Block from the second tier for a fighter
 * that lacks it. All within the guardrails; hand-tune them after.
 */
export const generateVariants = (project: Project, base: CharacterProfile, baseName: string, count: number, growth = 0.3): EnemyVariant[] => {
  const rules = base.variantRules;
  const cap = (n: number, b: number) => Math.min(n, b * rules.maxGrowth);
  const fighters = base.abilities.filter(fights);
  const hand = base.inventory.equipment.find((e) => e.slot === 'Hand');
  const weapons = Object.values(project.objects)
    .filter((o) => equipmentOf(o)?.slot.toLowerCase() === 'hand')
    .map((o) => ({ id: o.id, power: equipmentOf(o)!.stats.reduce((n, s) => n + s.value, 0) }))
    .sort((a, b) => a.power - b.power);
  const baseWeapon = weapons.findIndex((w) => w.id === hand?.item);
  const out: EnemyVariant[] = [];
  for (let i = 1; i <= count; i++) {
    const f = 1 + growth * i;
    const v = blankVariant(`${baseName} ${TIER_NAMES[i - 1] ?? `Tier ${i + 1}`}`, i + 1);
    v.levels = { min: 1 + i * 4, max: 4 + i * 4 };
    v.stats = { health: Math.round(cap(base.stats.health * f, base.stats.health)), speed: r1(cap(base.stats.speed * (1 + growth * i * 0.3), base.stats.speed)) };
    v.damage = r1(Math.min(f, rules.maxGrowth));
    for (const a of fighters) v.ranks[a.id] = a.rank + i;
    if (i >= 2 && fighters.some((a) => a.source.kind === 'library' && a.source.key === 'melee') && !base.abilities.some((a) => a.source.kind === 'library' && a.source.key === 'block')) v.add.push('block');
    const better = weapons[Math.min(weapons.length - 1, baseWeapon + i)];
    if (hand && better && better.id !== hand.item && weapons.length > 0) v.equipment.push({ slot: 'Hand', item: better.id });
    v.ai = {
      viewDistance: r1(cap(base.ai.viewDistance * (1 + growth * i * 0.5), base.ai.viewDistance)),
      reaction: r1(Math.max(0.1, base.ai.reaction * (1 - Math.min(0.6, growth * i * 0.4)))),
      skill: Object.fromEntries(Object.entries(base.ai.skill).map(([k, s]) => [k, Math.min(100, s + 12 * i)])) as Partial<AISkill>,
      ...(i >= 2 ? { tactics: 'defensive' as Tactics } : {}),
    };
    v.groupSize = Math.min(rules.maxAttackers + 1, 1 + i);
    out.push(v);
  }
  return out;
};

/** What breaks the guardrails or doesn't hold together. */
export const variantProblems = (project: Project, base: CharacterProfile, v: EnemyVariant, all: EnemyVariant[]): { severity: 'error' | 'warning'; text: string }[] => {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  const rules = base.variantRules;
  const say = (severity: 'error' | 'warning', text: string) => out.push({ severity, text: `${v.name}: ${text}` });
  if (!v.name.trim()) say('error', 'it needs a name.');
  for (const [k, val] of Object.entries(v.stats)) {
    const b = base.stats[k as keyof CharacterStats] as number;
    if (typeof val === 'number' && b > 0 && val > b * rules.maxGrowth) say('error', `${k} grows ${r1(val / b)}× the base, past the ${rules.maxGrowth}× limit.`);
  }
  if (v.damage > rules.maxGrowth) say('error', `damage ×${v.damage} is past the ${rules.maxGrowth}× limit.`);
  if (v.damage <= 0) say('error', 'damage must be above 0.');
  if (v.ai.viewDistance !== undefined && v.ai.viewDistance > base.ai.viewDistance * rules.maxGrowth) say('error', `sight distance is past the ${rules.maxGrowth}× limit.`);
  if (v.levels.min > v.levels.max) say('error', `its levels run from ${v.levels.min} to ${v.levels.max}.`);
  const overlap = all.find((o) => o.id !== v.id && o.levels.min <= v.levels.max && v.levels.min <= o.levels.max);
  if (overlap) say('warning', `its levels overlap ${overlap.name}’s; both may appear.`);
  if (v.groupSize > rules.maxAttackers) say('warning', `groups of ${v.groupSize}, but only ${rules.maxAttackers} may attack at once; the rest hold back.`);
  const resolved = resolveVariant(base, v);
  const cost = r1(difficultyOf(resolved) * Math.max(1, v.groupSize));
  if (cost > rules.spawnBudget) say('error', `a group costs ${cost} difficulty points, past the encounter budget of ${rules.spawnBudget}.`);
  const chase = v.ai.disengageDistance ?? base.ai.disengageDistance;
  if (chase > rules.patrolRadius) say('warning', `it chases ${chase} m from its post, past its ${rules.patrolRadius} m patrol area.`);
  for (const id of v.remove) if (!base.abilities.some((a) => a.id === id)) say('warning', 'it removes an ability the base no longer has.');
  for (const key of v.add) if (!abilityTemplate(key)) say('error', `${key} isn’t in the ability library.`);
  for (const it of v.items) if (project.objects[it.item]?.type !== 'inventory') say('error', 'an item it carries is no longer in the item library.');
  for (const e of v.equipment) {
    if (!e.item) continue;
    const eq = equipmentOf(project.objects[e.item]);
    if (!eq) say('error', `what it has in ${e.slot} isn’t equipment.`);
    else if (eq.slot.toLowerCase().replace(/[^a-z]/g, '') !== e.slot.toLowerCase().replace(/[^a-z]/g, '')) say('error', `${project.objects[e.item]!.name} goes in ${eq.slot}, not ${e.slot}.`);
  }
  return out;
};

export const encounterCost = (base: CharacterProfile, v: EnemyVariant): number => r1(difficultyOf(resolveVariant(base, v)) * Math.max(1, v.groupSize));
