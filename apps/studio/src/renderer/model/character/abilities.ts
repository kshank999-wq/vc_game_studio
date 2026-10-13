/**
 * The skills & powers library (Character Creator spec §4): standard abilities
 * by category, each with its defaults and an honest graybox state — "working"
 * when the studio's Play Mode simulates it, "stub" when it is shown, kept and
 * exported but not simulated yet (spec §4: never imply an unimplemented power
 * works). A character's ability cards draw on this library, on the project's
 * own skills, or are custom powers built from typed actions (no code).
 */

export type AbilityCategory = 'movement' | 'combat' | 'magic' | 'utility' | 'social' | 'defense';

export const ABILITY_CATEGORIES: { id: AbilityCategory; label: string }[] = [
  { id: 'movement', label: 'Movement' },
  { id: 'combat', label: 'Combat' },
  { id: 'magic', label: 'Magic' },
  { id: 'utility', label: 'Utility' },
  { id: 'social', label: 'Social & interaction' },
  { id: 'defense', label: 'Status & defense' },
];

export type AbilityTarget = 'self' | 'enemy' | 'ally' | 'area' | 'point';
export const TARGETS: { id: AbilityTarget; label: string }[] = [
  { id: 'self', label: 'Self' },
  { id: 'enemy', label: 'An enemy' },
  { id: 'ally', label: 'An ally' },
  { id: 'area', label: 'An area' },
  { id: 'point', label: 'A point' },
];

export type Resource = 'none' | 'stamina' | 'mana' | 'health';
export const RESOURCES: { id: Resource; label: string }[] = [
  { id: 'none', label: 'No cost' },
  { id: 'stamina', label: 'Stamina' },
  { id: 'mana', label: 'Mana' },
  { id: 'health', label: 'Health' },
];

/** What an ability does and costs, in engine-independent units (metres, seconds). */
export interface AbilityParams {
  description: string;
  cost: { resource: Resource; amount: number };
  /** Seconds before it can be used again. */
  cooldown: number;
  /** Metres. */
  range: number;
  target: AbilityTarget;
  /** Damage, healing, speed bonus… in the ability's own terms. */
  magnitude: number;
  /** Seconds it lasts (0 for instant). */
  duration: number;
  /** When it can be learned or used, in words (rank, level, a quest). */
  unlock: string;
  /** Placeholders the engine side fills: an animation cue, VFX and SFX. */
  cue: string;
  vfx: string;
  sfx: string;
  /** What happens when it can't be used (no stamina, out of range). */
  failure: string;
  /** When an AI uses it ("target in range and health below half"). */
  aiUse: string;
}

export type Graybox = 'working' | 'stub';

export interface AbilityTemplate {
  key: string;
  name: string;
  category: AbilityCategory;
  kind: 'active' | 'passive';
  graybox: Graybox;
  /** What the graybox does with it, or what is left to the engine. */
  note: string;
  defaults: AbilityParams;
}

const params = (p: Partial<AbilityParams>): AbilityParams => ({
  description: '',
  cost: { resource: 'none', amount: 0 },
  cooldown: 0,
  range: 0,
  target: 'self',
  magnitude: 0,
  duration: 0,
  unlock: '',
  cue: '',
  vfx: '',
  sfx: '',
  failure: '',
  aiUse: '',
  ...p,
});

const WORKING = 'Plays in the 3D graybox.';
const STUB = 'Graybox stub: kept and exported, not simulated in the studio yet; the engine side implements it.';

export const ABILITY_LIBRARY: AbilityTemplate[] = [
  // Movement
  { key: 'run', name: 'Running', category: 'movement', kind: 'passive', graybox: 'working', note: `${WORKING} The character controller's walk and run speed.`, defaults: params({ description: 'Moves at running speed.', magnitude: 4.5, cue: 'run' }) },
  { key: 'sprint', name: 'Sprinting', category: 'movement', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'A burst of speed that drains stamina.', cost: { resource: 'stamina', amount: 10 }, magnitude: 7, duration: 3, cue: 'sprint' }) },
  { key: 'jump', name: 'Jumping', category: 'movement', kind: 'active', graybox: 'working', note: `${WORKING} The character controller's jump height.`, defaults: params({ description: 'Jumps up onto ledges and over gaps.', magnitude: 1.2, cue: 'jump' }) },
  { key: 'fly', name: 'Flying', category: 'movement', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Leaves the ground and flies.', cost: { resource: 'mana', amount: 5 }, duration: 10, magnitude: 6, cue: 'fly' }) },
  { key: 'teleport', name: 'Teleport', category: 'movement', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Blinks to a point in sight.', cost: { resource: 'mana', amount: 20 }, cooldown: 8, range: 12, target: 'point', cue: 'cast', vfx: 'blink' }) },
  // Combat
  { key: 'melee', name: 'Melee attack', category: 'combat', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Strikes with the weapon in hand.', cooldown: 0.8, range: 1.5, target: 'enemy', magnitude: 10, cue: 'attack', sfx: 'swing', aiUse: 'Target within range.' }) },
  { key: 'ranged', name: 'Ranged attack', category: 'combat', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Shoots or throws at a target in sight.', cooldown: 1.2, range: 25, target: 'enemy', magnitude: 8, cue: 'shoot', sfx: 'shot', aiUse: 'Target in sight and beyond melee range.' }) },
  { key: 'block', name: 'Block', category: 'combat', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Raises a shield or weapon to stop a blow.', cost: { resource: 'stamina', amount: 5 }, magnitude: 0.7, duration: 1, cue: 'block', aiUse: 'An attack is coming.' }) },
  // Magic
  { key: 'fireball', name: 'Fireball', category: 'magic', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Hurls a ball of fire that bursts on impact.', cost: { resource: 'mana', amount: 15 }, cooldown: 3, range: 20, target: 'area', magnitude: 25, cue: 'cast', vfx: 'fireball', sfx: 'whoosh', aiUse: 'Two or more enemies close together.' }) },
  { key: 'heal', name: 'Healing', category: 'magic', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Restores health to self or an ally.', cost: { resource: 'mana', amount: 10 }, cooldown: 5, range: 8, target: 'ally', magnitude: 20, cue: 'cast', vfx: 'glow', aiUse: 'An ally below half health.' }) },
  { key: 'illusion', name: 'Illusion', category: 'magic', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Conjures a decoy that draws attention.', cost: { resource: 'mana', amount: 12 }, cooldown: 12, range: 10, target: 'point', duration: 6, cue: 'cast' }) },
  { key: 'elemental', name: 'Elemental bolt', category: 'magic', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'A bolt of frost, lightning or stone.', cost: { resource: 'mana', amount: 8 }, cooldown: 2, range: 18, target: 'enemy', magnitude: 15, cue: 'cast' }) },
  // Utility
  { key: 'stealth', name: 'Stealth', category: 'utility', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Moves unseen; halves how far others see.', magnitude: 0.5, duration: 10, cue: 'crouch' }) },
  { key: 'perception', name: 'Perception', category: 'utility', kind: 'passive', graybox: 'working', note: `${WORKING} An NPC's sight distance when it watches or chases.`, defaults: params({ description: 'Notices what moves nearby.', range: 12 }) },
  { key: 'lockpick', name: 'Lockpicking', category: 'utility', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Opens locks without the key.', range: 1.5, target: 'point', duration: 3, cue: 'interact' }) },
  // Social
  { key: 'persuade', name: 'Persuasion', category: 'social', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Talks someone round; opens dialogue options.', range: 3, target: 'ally' }) },
  { key: 'trade', name: 'Trade', category: 'social', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'Buys and sells with a vendor.', range: 3, target: 'ally' }) },
  // Defense
  { key: 'resist', name: 'Resistance', category: 'defense', kind: 'passive', graybox: 'stub', note: STUB, defaults: params({ description: 'Takes less damage of one kind.', magnitude: 0.25 }) },
  { key: 'shield', name: 'Shield', category: 'defense', kind: 'active', graybox: 'stub', note: STUB, defaults: params({ description: 'A barrier that soaks up damage.', cost: { resource: 'mana', amount: 15 }, cooldown: 10, magnitude: 40, duration: 8, cue: 'cast', vfx: 'barrier' }) },
];

export const abilityTemplate = (key: string): AbilityTemplate | undefined => ABILITY_LIBRARY.find((a) => a.key === key);

// ---------------------------------------------------------------- custom powers

/** A custom power is built from typed actions (spec §4): never code. */
export type ActionEffect = 'damage' | 'heal' | 'push' | 'stun' | 'buff' | 'debuff' | 'teleport' | 'spawn' | 'setFlag';
export const ACTION_EFFECTS: { id: ActionEffect; label: string; unit: string }[] = [
  { id: 'damage', label: 'Damage', unit: 'points' },
  { id: 'heal', label: 'Heal', unit: 'points' },
  { id: 'push', label: 'Push back', unit: 'metres' },
  { id: 'stun', label: 'Stun', unit: 'seconds' },
  { id: 'buff', label: 'Raise a stat', unit: '%' },
  { id: 'debuff', label: 'Lower a stat', unit: '%' },
  { id: 'teleport', label: 'Teleport', unit: 'metres' },
  { id: 'spawn', label: 'Spawn something', unit: 'count' },
  { id: 'setFlag', label: 'Set a story flag', unit: '' },
];

export type ActionCondition = 'always' | 'targetInRange' | 'healthBelow' | 'targetHealthBelow' | 'hasItem' | 'flagSet';
export const ACTION_CONDITIONS: { id: ActionCondition; label: string; takes: 'none' | 'percent' | 'text' }[] = [
  { id: 'always', label: 'Always', takes: 'none' },
  { id: 'targetInRange', label: 'Target in range', takes: 'none' },
  { id: 'healthBelow', label: 'Own health below', takes: 'percent' },
  { id: 'targetHealthBelow', label: "Target's health below", takes: 'percent' },
  { id: 'hasItem', label: 'Carrying an item', takes: 'text' },
  { id: 'flagSet', label: 'A story flag is set', takes: 'text' },
];

export type ActionTiming = 'instant' | 'overTime' | 'delayed';
export const ACTION_TIMINGS: { id: ActionTiming; label: string }[] = [
  { id: 'instant', label: 'At once' },
  { id: 'overTime', label: 'Over time' },
  { id: 'delayed', label: 'After a delay' },
];

export interface CustomAction {
  id: string;
  target: AbilityTarget;
  condition: ActionCondition;
  /** The condition's value: a percentage, an item or a flag. */
  conditionValue?: string;
  effect: ActionEffect;
  amount: number;
  timing: ActionTiming;
  /** Seconds for over time / delayed. */
  seconds: number;
  /** An event it sends when it happens ("orc_roared"), for the engine or a trigger. */
  event: string;
}

/** A custom action in words: "At once: Damage 10 points to an enemy, when target in range". */
export const describeAction = (a: CustomAction): string => {
  const effect = ACTION_EFFECTS.find((e) => e.id === a.effect)!;
  const target = TARGETS.find((t) => t.id === a.target)!.label.toLowerCase();
  const when = ACTION_CONDITIONS.find((c) => c.id === a.condition)!;
  const timing = a.timing === 'instant' ? 'At once' : a.timing === 'overTime' ? `Over ${a.seconds}s` : `After ${a.seconds}s`;
  const amount = effect.unit ? ` ${a.amount} ${effect.unit}` : '';
  const condition = a.condition === 'always' ? '' : `, when ${when.label.toLowerCase()}${a.conditionValue ? ` ${a.conditionValue}${when.takes === 'percent' ? '%' : ''}` : ''}`;
  return `${timing}: ${effect.label}${amount} → ${target}${condition}${a.event ? ` · sends “${a.event}”` : ''}`;
};

/** What is wrong with a custom action (spec §4: validated, typed). */
export const actionProblems = (a: CustomAction): string[] => {
  const out: string[] = [];
  const effect = ACTION_EFFECTS.find((e) => e.id === a.effect);
  if (!effect) out.push('An unknown effect.');
  if (effect?.unit && !(a.amount > 0)) out.push(`${effect.label} needs an amount above 0.`);
  if (a.timing !== 'instant' && !(a.seconds > 0)) out.push('Over time and after a delay need a number of seconds.');
  const condition = ACTION_CONDITIONS.find((c) => c.id === a.condition);
  if (condition?.takes === 'percent' && !(Number(a.conditionValue) > 0 && Number(a.conditionValue) <= 100)) out.push(`${condition.label} needs a percentage from 1 to 100.`);
  if (condition?.takes === 'text' && !a.conditionValue?.trim()) out.push(`${condition.label} needs a name.`);
  if (a.event && !/^[a-z][a-z0-9_]*$/.test(a.event)) out.push('An event is a lower-case key, like orc_roared.');
  return out;
};
