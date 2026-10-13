import { setData } from '../details';
import { equipmentOf } from '../equipment';
import { ENTRY_CODE, makeObject, newId, nextCode, removeObject } from '../project';
import type { Project, StoryObject } from '../types';
import { abilityTemplate, actionProblems, describeAction, type AbilityCategory, type AbilityParams, type CustomAction, type Graybox, type Resource } from './abilities';
import { aiProblems, normalizeAI, type AIProfile } from './ai';
import { allyProblems, defaultAlly, defaultExtra, defaultNpc, defaultPlayer, extraProblems, npcProblems, type AllyProfile, type ExtraProfile, type NpcProfile, type PlayerProfile } from './roles';
import { defaultVariantRules, variantProblems, type EnemyVariant, type VariantRules } from './variants';

/**
 * The character registry (Character Creator spec §1, §3, §11). A character
 * is the one `character` element the whole studio already shares (dialogue
 * speakers, scenes, the Bible, level actors); the Character Creator adds its
 * profile under `data.profile`: roles, identity, physical stats, art, ability
 * cards and an inventory profile. The element's id is the stable id (§3); a
 * rename never severs dialogue or placements, which point at the id. Every
 * change bumps the profile's revision, and the project's edit history keeps
 * what changed (template versioning, §15 phase 1).
 */

export type CharacterRole = 'player' | 'enemy' | 'npc' | 'ally' | 'extra';

export const ROLES: { id: CharacterRole; label: string; hint: string }[] = [
  { id: 'player', label: 'Player', hint: 'The main character the player controls' },
  { id: 'enemy', label: 'Enemy NPC', hint: 'Hostile: detects, chases and attacks' },
  { id: 'npc', label: 'Interactive NPC', hint: 'Talks, trades, gives quests or information' },
  { id: 'ally', label: 'Ally', hint: 'A companion who follows and helps' },
  { id: 'extra', label: 'Ambient extra', hint: 'Lightweight walk, idle, talk and work loops; no full dialogue or combat' },
];

export const roleLabel = (r: CharacterRole): string => ROLES.find((x) => x.id === r)?.label ?? r;

export type Movement = 'walk' | 'fly' | 'swim' | 'static';
export const MOVEMENTS: { id: Movement; label: string }[] = [
  { id: 'walk', label: 'Walks' },
  { id: 'fly', label: 'Flies' },
  { id: 'swim', label: 'Swims' },
  { id: 'static', label: 'Stays put' },
];

/** Core locomotion and physical parameters, in engine-independent units (spec §3). */
export interface CharacterStats {
  /** Metres per second. */
  speed: number;
  /** Metres. */
  jump: number;
  /** Degrees per second. */
  turn: number;
  /** Collision capsule, metres. */
  radius: number;
  height: number;
  health: number;
  resource: { kind: Resource; max: number };
  /** How close the player must be to talk or interact, metres. */
  interactionRadius: number;
  movement: Movement;
}

export const STAT_RANGES: Record<'speed' | 'jump' | 'turn' | 'radius' | 'height' | 'health' | 'interactionRadius', { label: string; unit: string; min: number; max: number; step: number }> = {
  speed: { label: 'Speed', unit: 'm/s', min: 0, max: 30, step: 0.1 },
  jump: { label: 'Jump height', unit: 'm', min: 0, max: 10, step: 0.1 },
  turn: { label: 'Turn rate', unit: '°/s', min: 0, max: 1080, step: 10 },
  radius: { label: 'Collision radius', unit: 'm', min: 0.05, max: 5, step: 0.05 },
  height: { label: 'Height', unit: 'm', min: 0.2, max: 10, step: 0.05 },
  health: { label: 'Health', unit: 'pts', min: 1, max: 100000, step: 1 },
  interactionRadius: { label: 'Interaction radius', unit: 'm', min: 0, max: 20, step: 0.1 },
};

export type Silhouette = 'humanoid' | 'stocky' | 'slender' | 'small' | 'beast' | 'flyer';
export const SILHOUETTES: { id: Silhouette; label: string }[] = [
  { id: 'humanoid', label: 'Humanoid' },
  { id: 'stocky', label: 'Stocky' },
  { id: 'slender', label: 'Slender' },
  { id: 'small', label: 'Small' },
  { id: 'beast', label: 'Four-legged' },
  { id: 'flyer', label: 'Winged' },
];

/** The dummy form that stands in until finished art is bound (spec §8). */
export interface Placeholder {
  silhouette: Silhouette;
  tint: string;
  /** A short label shown on the dummy. */
  label: string;
  /** Proportions relative to the stats' height (1 = as tall as it says). */
  scale: number;
  /** A placeholder prop in hand. */
  prop: 'none' | 'sword' | 'shield' | 'bow' | 'staff';
}

export interface ArtRef {
  id: string;
  kind: 'portrait' | 'concept' | 'reference' | 'model';
  name: string;
  /** A small data URL (images are scaled down when added), or a path the engine side binds. */
  src: string;
}

export interface CharacterArt {
  /** Which art stands for the character: the placeholder, or one of the refs. */
  use: 'placeholder' | string;
  refs: ArtRef[];
  placeholder: Placeholder;
}

/** An ability on a character: from the library, one of the project's skills, or a custom power. */
export interface AbilityCard {
  id: string;
  source: { kind: 'library'; key: string } | { kind: 'skill'; id: string } | { kind: 'custom' };
  name: string;
  category: AbilityCategory;
  kind: 'active' | 'passive';
  rank: number;
  enabled: boolean;
  /** Only what differs from the library's defaults (spec §2: defaults plus overrides). */
  overrides: Partial<AbilityParams>;
  /** A custom power's typed actions (spec §4). */
  actions?: CustomAction[];
}

export type InventoryMode = 'unlimited' | 'slots' | 'stack' | 'weight' | 'hybrid';
export const INVENTORY_MODES: { id: InventoryMode; label: string; hint: string }[] = [
  { id: 'unlimited', label: 'Unlimited', hint: 'Carries anything, any amount' },
  { id: 'slots', label: 'Slot count', hint: 'So many slots; every item takes one' },
  { id: 'stack', label: 'Stacks', hint: 'So many slots; items that stack share a slot up to a stack size' },
  { id: 'weight', label: 'Weight', hint: 'Up to a total weight (each item’s weight field, in kg)' },
  { id: 'hybrid', label: 'Slots and weight', hint: 'Stacked slots and a weight limit, both' },
];

export type Overflow = 'refuse' | 'drop' | 'swap';
export const OVERFLOWS: { id: Overflow; label: string }[] = [
  { id: 'refuse', label: 'Refuse the pickup' },
  { id: 'drop', label: 'Drop it on the ground' },
  { id: 'swap', label: 'Ask what to drop' },
];

export const EQUIPMENT_SLOTS = ['Hand', 'Off-hand', 'Armour', 'Accessory'] as const;

export interface InventoryProfile {
  mode: InventoryMode;
  slots: number;
  stack: number;
  /** Kilograms. */
  weight: number;
  /** Starting items: inventory elements in the shared item library. */
  items: { item: string; qty: number }[];
  equipment: { slot: string; item?: string }[];
  overflow: Overflow;
  /** Carried between scenes. */
  persists: boolean;
}

export interface CharacterProfile {
  roles: CharacterRole[];
  /** The internal slug: lower-case, unique, kept on rename (spec §3). */
  slug: string;
  archetype: string;
  species: string;
  /** Only where the project wants it; never drives behaviour (spec §3). */
  presentation: string;
  appearance: string;
  tags: string[];
  stats: CharacterStats;
  art: CharacterArt;
  abilities: AbilityCard[];
  inventory: InventoryProfile;
  enabled: boolean;
  revision: number;
  /** Role settings (spec §6): each kept whether or not the role is on, so turning a role off and on loses nothing. */
  player: PlayerProfile;
  npc: NpcProfile;
  ally: AllyProfile;
  extra: ExtraProfile;
  /** Enemies' and allies' AI (spec §6.2). */
  ai: AIProfile;
  /** Escalating enemy variants of this character, and the guardrails they keep to. */
  variants: EnemyVariant[];
  variantRules: VariantRules;
}

// ---------------------------------------------------------------- archetypes

export interface Archetype {
  id: string;
  label: string;
  hint: string;
  roles: CharacterRole[];
  stats: Partial<CharacterStats>;
  placeholder: Partial<Placeholder>;
  abilities: string[];
}

/** Starting points, not restrictions (spec §3): everything they set can be changed. */
export const ARCHETYPES: Archetype[] = [
  { id: 'hero', label: 'Adventurer', hint: 'A capable all-rounder, for the player', roles: ['player'], stats: { speed: 4.5, jump: 1.2, health: 100, resource: { kind: 'stamina', max: 100 } }, placeholder: { silhouette: 'humanoid', tint: '#c9a24a' }, abilities: ['run', 'jump', 'melee'] },
  { id: 'villager', label: 'Villager', hint: 'Strolls, works, talks', roles: ['npc', 'extra'], stats: { speed: 1.6, jump: 0.4, health: 30 }, placeholder: { silhouette: 'humanoid', tint: '#8fb07a' }, abilities: ['run'] },
  { id: 'merchant', label: 'Merchant', hint: 'Buys and sells', roles: ['npc'], stats: { speed: 1.4, health: 40 }, placeholder: { silhouette: 'stocky', tint: '#c79a5b' }, abilities: ['trade', 'persuade'] },
  { id: 'guard', label: 'Guard', hint: 'Patrols and watches', roles: ['enemy'], stats: { speed: 3.5, health: 80 }, placeholder: { silhouette: 'humanoid', tint: '#9a7a58', prop: 'sword' }, abilities: ['run', 'perception', 'melee', 'block'] },
  { id: 'orc', label: 'Orc', hint: 'A heavy brawler with a sword', roles: ['enemy'], stats: { speed: 3.8, health: 120, radius: 0.45, height: 2 }, placeholder: { silhouette: 'stocky', tint: '#6f8f4a', prop: 'sword', label: 'ORC' }, abilities: ['run', 'perception', 'melee'] },
  { id: 'mage', label: 'Mage', hint: 'Casts from range', roles: ['enemy', 'ally', 'npc'], stats: { speed: 3, health: 60, resource: { kind: 'mana', max: 100 } }, placeholder: { silhouette: 'slender', tint: '#7a6fc4', prop: 'staff' }, abilities: ['run', 'fireball', 'heal', 'shield'] },
  { id: 'companion', label: 'Companion', hint: 'Follows and helps', roles: ['ally'], stats: { speed: 4.5, health: 90 }, placeholder: { silhouette: 'humanoid', tint: '#5f9ad0', prop: 'bow' }, abilities: ['run', 'jump', 'ranged', 'heal'] },
  { id: 'creature', label: 'Creature', hint: 'A beast on four legs', roles: ['enemy', 'extra'], stats: { speed: 6, jump: 1.5, health: 50, radius: 0.5, height: 1.1 }, placeholder: { silhouette: 'beast', tint: '#a0634a' }, abilities: ['run', 'perception', 'melee'] },
  { id: 'blank', label: 'Blank', hint: 'Start from nothing', roles: [], stats: {}, placeholder: {}, abilities: [] },
];

export const archetypeOf = (id: string): Archetype | undefined => ARCHETYPES.find((a) => a.id === id);

// ---------------------------------------------------------------- reading

const DEFAULT_STATS: CharacterStats = { speed: 4, jump: 1, turn: 360, radius: 0.35, height: 1.75, health: 100, resource: { kind: 'none', max: 0 }, interactionRadius: 2, movement: 'walk' };
const DEFAULT_PLACEHOLDER: Placeholder = { silhouette: 'humanoid', tint: '#d9607a', label: '', scale: 1, prop: 'none' };
const DEFAULT_INVENTORY: InventoryProfile = { mode: 'unlimited', slots: 12, stack: 10, weight: 40, items: [], equipment: EQUIPMENT_SLOTS.map((slot) => ({ slot })), overflow: 'refuse', persists: true };

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'character';

/** Every character, the registry, by code then name. */
export const characters = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'character')
    .sort((a, b) => (a.data.code ?? '~').localeCompare(b.data.code ?? '~', undefined, { numeric: true }) || a.name.localeCompare(b.name));

export const hasProfile = (o: StoryObject | undefined): boolean => !!o && o.type === 'character' && typeof o.data.profile === 'object' && o.data.profile !== null;

/** A character's profile, filled with defaults; a character made before the Character Creator reads as one with none set. */
export const profileOf = (o: StoryObject): CharacterProfile => {
  const p = (o.data.profile ?? {}) as Partial<CharacterProfile>;
  const stats = (p.stats ?? {}) as Partial<CharacterStats>;
  const art = (p.art ?? {}) as Partial<CharacterArt>;
  const inv = (p.inventory ?? {}) as Partial<InventoryProfile>;
  const legacyRole = String(o.data.role ?? '');
  const roles = Array.isArray(p.roles) ? p.roles.filter((r) => ROLES.some((x) => x.id === r)) : legacyRole === 'Player character' ? (['player'] as CharacterRole[]) : legacyRole === 'NPC' ? (['npc'] as CharacterRole[]) : [];
  return {
    roles,
    slug: typeof p.slug === 'string' && p.slug ? p.slug : slugify(o.name),
    archetype: String(p.archetype ?? ''),
    species: String(p.species ?? ''),
    presentation: String(p.presentation ?? ''),
    appearance: String(p.appearance ?? ''),
    tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [],
    stats: {
      speed: num(stats.speed, DEFAULT_STATS.speed),
      jump: num(stats.jump, DEFAULT_STATS.jump),
      turn: num(stats.turn, DEFAULT_STATS.turn),
      radius: num(stats.radius, DEFAULT_STATS.radius),
      height: num(stats.height, DEFAULT_STATS.height),
      health: num(stats.health, DEFAULT_STATS.health),
      resource: { kind: stats.resource?.kind ?? 'none', max: num(stats.resource?.max, 0) },
      interactionRadius: num(stats.interactionRadius, DEFAULT_STATS.interactionRadius),
      movement: MOVEMENTS.some((m) => m.id === stats.movement) ? stats.movement! : 'walk',
    },
    art: {
      use: art.use ?? 'placeholder',
      refs: Array.isArray(art.refs) ? art.refs : [],
      placeholder: { ...DEFAULT_PLACEHOLDER, tint: String(o.data.color ?? DEFAULT_PLACEHOLDER.tint), ...(art.placeholder ?? {}) },
    },
    abilities: Array.isArray(p.abilities) ? p.abilities : [],
    inventory: {
      ...DEFAULT_INVENTORY,
      ...inv,
      items: Array.isArray(inv.items) ? inv.items : [],
      equipment: Array.isArray(inv.equipment) && inv.equipment.length ? inv.equipment : DEFAULT_INVENTORY.equipment,
    },
    enabled: p.enabled !== false,
    revision: num(p.revision, 0),
    player: { ...defaultPlayer(), ...(p.player ?? {}) },
    npc: { ...defaultNpc(o.name), ...(p.npc ?? {}) },
    ally: { ...defaultAlly(), faction: String(o.data.faction ?? ''), ...(p.ally ?? {}) },
    extra: { ...defaultExtra(), ...(p.extra ?? {}) },
    ai: normalizeAI(p.ai),
    variants: Array.isArray(p.variants) ? p.variants : [],
    variantRules: { ...defaultVariantRules(), ...(p.variantRules ?? {}) },
  };
};

// ---------------------------------------------------------------- writing

/** Change a character's profile; the revision goes up and the tint stays the character's colour everywhere. */
export const updateProfile = (project: Project, id: string, change: (p: CharacterProfile) => CharacterProfile): Project => {
  const o = project.objects[id];
  if (!o || o.type !== 'character') return project;
  const before = profileOf(o);
  const next = change(before);
  if (JSON.stringify(next) === JSON.stringify(before) && hasProfile(o)) return project;
  const profile = { ...next, revision: before.revision + 1 };
  return setData(project, id, { profile, color: profile.art.placeholder.tint });
};

export const patchProfile = (project: Project, id: string, patch: Partial<CharacterProfile>): Project => updateProfile(project, id, (p) => ({ ...p, ...patch }));

export const patchStats = (project: Project, id: string, patch: Partial<CharacterStats>): Project => updateProfile(project, id, (p) => ({ ...p, stats: { ...p.stats, ...patch } }));

export const patchPlaceholder = (project: Project, id: string, patch: Partial<Placeholder>): Project =>
  updateProfile(project, id, (p) => ({ ...p, art: { ...p.art, placeholder: { ...p.art.placeholder, ...patch } } }));

export const patchInventory = (project: Project, id: string, patch: Partial<InventoryProfile>): Project => updateProfile(project, id, (p) => ({ ...p, inventory: { ...p.inventory, ...patch } }));

/** A slug no other character has: the name's, or with _2, _3… */
export const uniqueSlug = (project: Project, wanted: string, except?: string): string => {
  const taken = new Set(characters(project).filter((c) => c.id !== except).map((c) => profileOf(c).slug));
  const base = slugify(wanted);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
};

export const toggleRole = (project: Project, id: string, role: CharacterRole): Project =>
  updateProfile(project, id, (p) => ({ ...p, roles: p.roles.includes(role) ? p.roles.filter((r) => r !== role) : ROLES.map((r) => r.id).filter((r) => r === role || p.roles.includes(r)) }));

const cardFor = (key: string): AbilityCard | undefined => {
  const t = abilityTemplate(key);
  return t && { id: newId('ab'), source: { kind: 'library', key }, name: t.name, category: t.category, kind: t.kind, rank: 1, enabled: true, overrides: {} };
};

export interface NewCharacter {
  name: string;
  roles: CharacterRole[];
  archetype?: string;
  species?: string;
  /** Library ability keys to start with (the archetype's when absent). */
  abilities?: string[];
  inventory?: Partial<InventoryProfile>;
}

/** Make a character in the registry: a stable id, its CH- code, a unique slug and an archetype's defaults (spec §2 wizard). */
export const createCharacter = (project: Project, spec: NewCharacter, now = new Date().toISOString()): { project: Project; id: string } => {
  const arch = archetypeOf(spec.archetype ?? 'blank') ?? archetypeOf('blank')!;
  const name = spec.name.trim() || 'New character';
  const code = nextCode(project, ENTRY_CODE.character!);
  const placeholder: Placeholder = { ...DEFAULT_PLACEHOLDER, ...arch.placeholder, label: arch.placeholder.label ?? '' };
  const profile: CharacterProfile = {
    roles: spec.roles.length ? spec.roles : arch.roles.slice(0, 1),
    slug: uniqueSlug(project, name),
    archetype: arch.id === 'blank' ? '' : arch.label,
    species: spec.species?.trim() ?? '',
    presentation: '',
    appearance: '',
    tags: [],
    stats: { ...DEFAULT_STATS, ...arch.stats, resource: arch.stats.resource ?? DEFAULT_STATS.resource },
    art: { use: 'placeholder', refs: [], placeholder },
    abilities: (spec.abilities ?? arch.abilities).map(cardFor).filter((c): c is AbilityCard => !!c),
    inventory: { ...DEFAULT_INVENTORY, ...spec.inventory, equipment: spec.inventory?.equipment ?? DEFAULT_INVENTORY.equipment },
    enabled: true,
    revision: 1,
    player: defaultPlayer(),
    npc: defaultNpc(name),
    ally: defaultAlly(),
    extra: defaultExtra(),
    ai: normalizeAI(undefined),
    variants: [],
    variantRules: defaultVariantRules(),
  };
  const role = profile.roles.includes('player') ? 'Player character' : profile.roles.length ? 'NPC' : undefined;
  const object = makeObject('character', name, now, { code, color: placeholder.tint, ...(role ? { role } : {}), profile });
  return { project: { ...project, objects: { ...project.objects, [object.id]: object } }, id: object.id };
};

/** A copy with its own id, code and slug; its abilities get new ids too. */
export const duplicateCharacter = (project: Project, id: string, now = new Date().toISOString()): { project: Project; id: string } | undefined => {
  const o = project.objects[id];
  if (!o || o.type !== 'character') return undefined;
  const p = profileOf(o);
  const name = `${o.name} copy`;
  const ids = new Map(p.abilities.map((a) => [a.id, newId('ab')]));
  const variants = p.variants.map((v) => ({
    ...structuredClone(v),
    id: newId('var'),
    ranks: Object.fromEntries(Object.entries(v.ranks).map(([k, r]) => [ids.get(k) ?? k, r])),
    remove: v.remove.map((k) => ids.get(k) ?? k),
  }));
  const profile: CharacterProfile = { ...p, slug: uniqueSlug(project, name), abilities: p.abilities.map((a) => ({ ...a, id: ids.get(a.id)! })), variants, revision: 1 };
  const copy = makeObject('character', name, now, { ...structuredClone(o.data), code: nextCode(project, ENTRY_CODE.character!), profile });
  return { project: { ...project, objects: { ...project.objects, [copy.id]: copy } }, id: copy.id };
};

// ---------------------------------------------------------------- abilities

export const addLibraryAbility = (project: Project, id: string, key: string): { project: Project; cardId?: string } => {
  const card = cardFor(key);
  if (!card) return { project };
  return { project: updateProfile(project, id, (p) => ({ ...p, abilities: [...p.abilities, card] })), cardId: card.id };
};

export const addSkillAbility = (project: Project, id: string, skillId: string): { project: Project; cardId?: string } => {
  const skill = project.objects[skillId];
  if (skill?.type !== 'skill') return { project };
  const card: AbilityCard = { id: newId('ab'), source: { kind: 'skill', id: skillId }, name: skill.name, category: 'utility', kind: 'active', rank: 1, enabled: true, overrides: {} };
  return { project: updateProfile(project, id, (p) => ({ ...p, abilities: [...p.abilities, card] })), cardId: card.id };
};

export const newAction = (): CustomAction => ({ id: newId('act'), target: 'enemy', condition: 'targetInRange', effect: 'damage', amount: 10, timing: 'instant', seconds: 0, event: '' });

export const addCustomAbility = (project: Project, id: string, name = 'Custom power'): { project: Project; cardId: string } => {
  const card: AbilityCard = { id: newId('ab'), source: { kind: 'custom' }, name, category: 'magic', kind: 'active', rank: 1, enabled: true, overrides: {}, actions: [newAction()] };
  return { project: updateProfile(project, id, (p) => ({ ...p, abilities: [...p.abilities, card] })), cardId: card.id };
};

export const updateAbility = (project: Project, id: string, cardId: string, patch: Partial<AbilityCard>): Project =>
  updateProfile(project, id, (p) => ({ ...p, abilities: p.abilities.map((a) => (a.id === cardId ? { ...a, ...patch } : a)) }));

/** Override one parameter; setting it back to the default drops the override. */
export const overrideAbility = (project: Project, id: string, cardId: string, patch: Partial<AbilityParams>): Project =>
  updateProfile(project, id, (p) => ({
    ...p,
    abilities: p.abilities.map((a) => {
      if (a.id !== cardId) return a;
      const base = defaultsOf(a);
      const overrides: Partial<AbilityParams> = { ...a.overrides };
      for (const [k, v] of Object.entries(patch) as [keyof AbilityParams, unknown][]) {
        if (JSON.stringify(base[k]) === JSON.stringify(v)) delete overrides[k];
        else (overrides as Record<string, unknown>)[k] = v;
      }
      return { ...a, overrides };
    }),
  }));

export const removeAbility = (project: Project, id: string, cardId: string): Project => updateProfile(project, id, (p) => ({ ...p, abilities: p.abilities.filter((a) => a.id !== cardId) }));

export const duplicateAbility = (project: Project, id: string, cardId: string): { project: Project; cardId?: string } => {
  const o = project.objects[id];
  const card = o && profileOf(o).abilities.find((a) => a.id === cardId);
  if (!card) return { project };
  const copy: AbilityCard = { ...structuredClone(card), id: newId('ab'), name: `${card.name} copy`, actions: card.actions?.map((x) => ({ ...x, id: newId('act') })) };
  return { project: updateProfile(project, id, (p) => ({ ...p, abilities: p.abilities.flatMap((a) => (a.id === cardId ? [a, copy] : [a])) })), cardId: copy.id };
};

export const moveAbility = (project: Project, id: string, cardId: string, by: -1 | 1): Project =>
  updateProfile(project, id, (p) => {
    const list = [...p.abilities];
    const at = list.findIndex((a) => a.id === cardId);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return p;
    [list[at], list[to]] = [list[to]!, list[at]!];
    return { ...p, abilities: list };
  });

const BLANK_PARAMS: AbilityParams = { description: '', cost: { resource: 'none', amount: 0 }, cooldown: 0, range: 0, target: 'self', magnitude: 0, duration: 0, unlock: '', cue: '', vfx: '', sfx: '', failure: '', aiUse: '' };

/** The parameters a card starts from: its library entry's, or blank. */
export const defaultsOf = (card: AbilityCard): AbilityParams => (card.source.kind === 'library' ? (abilityTemplate(card.source.key)?.defaults ?? BLANK_PARAMS) : BLANK_PARAMS);

/** The parameters a card has: the defaults with its overrides. */
export const paramsOf = (card: AbilityCard): AbilityParams => ({ ...defaultsOf(card), ...card.overrides });

/** Whether the studio's graybox plays it: library entries say; skills and custom powers are kept and exported, simulated engine-side. */
export const grayboxOf = (card: AbilityCard): Graybox => (card.source.kind === 'library' ? (abilityTemplate(card.source.key)?.graybox ?? 'stub') : 'stub');

// ---------------------------------------------------------------- inventory

export const itemsLibrary = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'inventory')
    .sort((a, b) => a.name.localeCompare(b.name));

export const itemWeight = (o: StoryObject | undefined): number | undefined => {
  const w = Number(o?.data.weight);
  return o?.data.weight !== undefined && o.data.weight !== '' && Number.isFinite(w) ? w : undefined;
};

const stacks = (o: StoryObject | undefined): boolean => o?.data.stacks !== 'One at a time';

export interface Capacity {
  /** Slots used and allowed (allowed 0 when slots don't limit). */
  slots: { used: number; of: number };
  weight: { used: number; of: number; unknown: string[] };
}

/** What the starting items take up. */
export const capacityOf = (project: Project, inv: InventoryProfile): Capacity => {
  let slots = 0;
  let weight = 0;
  const unknown: string[] = [];
  for (const { item, qty } of inv.items) {
    const o = project.objects[item];
    const n = Math.max(0, Math.round(qty));
    if (inv.mode === 'slots') slots += n;
    else slots += stacks(o) ? Math.ceil(n / Math.max(1, inv.stack)) : n;
    const w = itemWeight(o);
    if (w === undefined) unknown.push(o?.name ?? item);
    else weight += w * n;
  }
  const limitsSlots = inv.mode === 'slots' || inv.mode === 'stack' || inv.mode === 'hybrid';
  const limitsWeight = inv.mode === 'weight' || inv.mode === 'hybrid';
  return { slots: { used: slots, of: limitsSlots ? inv.slots : 0 }, weight: { used: Math.round(weight * 100) / 100, of: limitsWeight ? inv.weight : 0, unknown } };
};

export const setStartingItem = (project: Project, id: string, item: string, qty: number): Project =>
  updateProfile(project, id, (p) => {
    const rest = p.inventory.items.filter((i) => i.item !== item);
    const q = Math.max(0, Math.round(qty));
    const at = p.inventory.items.findIndex((i) => i.item === item);
    const items = q <= 0 ? rest : at < 0 ? [...p.inventory.items, { item, qty: q }] : p.inventory.items.map((i) => (i.item === item ? { item, qty: q } : i));
    // An item no longer carried can't stay equipped.
    const equipment = q <= 0 ? p.inventory.equipment.map((e) => (e.item === item ? { slot: e.slot } : e)) : p.inventory.equipment;
    return { ...p, inventory: { ...p.inventory, items, equipment } };
  });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').replace('armor', 'armour');

/** Whether an item fits a slot: it is equipment and its slot is this one. */
export const fitsSlot = (project: Project, item: string, slot: string): boolean => {
  const e = equipmentOf(project.objects[item]);
  return !!e && norm(e.slot) === norm(slot);
};

export const equipStarting = (project: Project, id: string, slot: string, item: string | undefined): Project =>
  updateProfile(project, id, (p) => {
    let items = p.inventory.items;
    if (item && !items.some((i) => i.item === item)) items = [...items, { item, qty: 1 }];
    return { ...p, inventory: { ...p.inventory, items, equipment: p.inventory.equipment.map((e) => (e.slot === slot ? (item ? { slot, item } : { slot }) : e)) } };
  });

export const addSlot = (project: Project, id: string, slot: string): Project =>
  updateProfile(project, id, (p) => (!slot.trim() || p.inventory.equipment.some((e) => norm(e.slot) === norm(slot)) ? p : { ...p, inventory: { ...p.inventory, equipment: [...p.inventory.equipment, { slot: slot.trim() }] } }));

export const removeSlot = (project: Project, id: string, slot: string): Project => updateProfile(project, id, (p) => ({ ...p, inventory: { ...p.inventory, equipment: p.inventory.equipment.filter((e) => e.slot !== slot) } }));

// ---------------------------------------------------------------- art

export const addArt = (project: Project, id: string, ref: Omit<ArtRef, 'id'>): { project: Project; refId: string } => {
  const art: ArtRef = { ...ref, id: newId('art') };
  return { project: updateProfile(project, id, (p) => ({ ...p, art: { ...p.art, refs: [...p.art.refs, art], use: p.art.use === 'placeholder' && art.kind === 'portrait' ? art.id : p.art.use } })), refId: art.id };
};

export const removeArt = (project: Project, id: string, refId: string): Project =>
  updateProfile(project, id, (p) => ({ ...p, art: { ...p.art, refs: p.art.refs.filter((r) => r.id !== refId), use: p.art.use === refId ? 'placeholder' : p.art.use } }));

export const useArt = (project: Project, id: string, use: 'placeholder' | string): Project => updateProfile(project, id, (p) => ({ ...p, art: { ...p.art, use } }));

// ---------------------------------------------------------------- search

export const matchesCharacter = (o: StoryObject, query: string, role?: CharacterRole | ''): boolean => {
  const p = profileOf(o);
  if (role && !p.roles.includes(role)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [o.name, o.data.code ?? '', p.slug, p.archetype, p.species, ...p.tags, ...p.roles.map(roleLabel)].join(' ').toLowerCase().includes(q);
};

// ---------------------------------------------------------------- validation

export interface CharacterIssue {
  severity: 'error' | 'warning' | 'info';
  text: string;
  /** What it is about: an ability card, an item, a slot. */
  ref?: string;
  area: 'identity' | 'roles' | 'abilities' | 'inventory' | 'art' | 'stats' | 'dialogue' | 'ai' | 'variants';
}

/** What is wrong or unfinished (spec §2: broken references, placeholder state, unsupported combinations). */
export const characterIssues = (project: Project, id: string): CharacterIssue[] => {
  const o = project.objects[id];
  if (!o || o.type !== 'character') return [];
  const p = profileOf(o);
  const out: CharacterIssue[] = [];
  const say = (severity: CharacterIssue['severity'], area: CharacterIssue['area'], text: string, ref?: string) => out.push({ severity, area, text, ...(ref ? { ref } : {}) });

  if (!o.name.trim()) say('error', 'identity', 'It needs a name.');
  if (!/^[a-z][a-z0-9_]*$/.test(p.slug)) say('error', 'identity', 'The internal id is lower-case letters, digits and _ only, starting with a letter.');
  const sameSlug = characters(project).find((c) => c.id !== id && profileOf(c).slug === p.slug);
  if (sameSlug) say('error', 'identity', `${sameSlug.name} has the same internal id (${p.slug}).`);

  if (!p.roles.length) say('warning', 'roles', 'It has no role yet: player, enemy, interactive NPC, ally or ambient extra.');
  if (p.roles.includes('player') && p.roles.includes('extra')) say('error', 'roles', 'The player can’t also be an ambient extra.');
  if (p.roles.includes('enemy') && p.roles.includes('ally')) say('error', 'roles', 'An enemy and an ally at once: make a variant for each side instead.');
  if (p.roles.includes('player') && p.roles.includes('enemy')) say('error', 'roles', 'The player can’t also be an enemy NPC.');
  const players = characters(project).filter((c) => profileOf(c).roles.includes('player'));
  if (p.roles.includes('player') && players.length > 1) say('warning', 'roles', `${players.length} characters are the player: ${players.map((c) => c.name).join(', ')}.`);

  if (p.stats.movement !== 'static' && p.stats.speed <= 0) say('warning', 'stats', 'It moves, but its speed is 0.');
  if (p.stats.radius * 2 > p.stats.height) say('warning', 'stats', 'Its collision radius is wider than it is tall.');
  if (p.stats.resource.kind !== 'none' && p.stats.resource.max <= 0) say('warning', 'stats', `It uses ${p.stats.resource.kind} but has none to spend.`);

  for (const a of p.abilities) {
    const label = `${a.name}:`;
    if (a.source.kind === 'library' && !abilityTemplate(a.source.key)) say('error', 'abilities', `${label} not in the ability library.`, a.id);
    if (a.source.kind === 'skill' && project.objects[a.source.id]?.type !== 'skill') say('error', 'abilities', `${label} its skill is no longer in the project.`, a.id);
    if (a.source.kind === 'custom') {
      if (!a.actions?.length) say('error', 'abilities', `${label} a custom power needs at least one action.`, a.id);
      a.actions?.forEach((x, i) => actionProblems(x).forEach((t) => say('error', 'abilities', `${label} action ${i + 1}: ${t}`, a.id)));
    }
    const params = paramsOf(a);
    if (a.enabled && params.cost.resource !== 'none' && params.cost.resource !== 'health' && params.cost.resource !== p.stats.resource.kind) say('warning', 'abilities', `${label} costs ${params.cost.resource}, but the character’s resource is ${p.stats.resource.kind === 'none' ? 'none' : p.stats.resource.kind}.`, a.id);
    if (a.enabled && grayboxOf(a) === 'stub') say('info', 'abilities', `${label} a graybox stub: kept and exported, not simulated in the studio yet.`, a.id);
    if (p.roles.length && p.roles.every((r) => r === 'extra') && a.enabled && (a.category === 'combat' || a.category === 'magic')) say('warning', 'abilities', `${label} ambient extras skip combat and magic; promote it to an NPC or enemy to use it.`, a.id);
  }

  const inv = p.inventory;
  for (const { item, qty } of inv.items) {
    const it = project.objects[item];
    if (it?.type !== 'inventory') say('error', 'inventory', 'A starting item is no longer in the item library.', item);
    else {
      if (qty > 1 && !stacks(it) && inv.mode !== 'unlimited' && inv.mode !== 'slots' && inv.mode !== 'weight') say('info', 'inventory', `${it.name} doesn’t stack: each of the ${qty} takes a slot.`, item);
    }
  }
  if ((inv.mode === 'slots' || inv.mode === 'stack' || inv.mode === 'hybrid') && !(inv.slots >= 1)) say('error', 'inventory', 'A slot limit needs at least 1 slot.');
  if ((inv.mode === 'stack' || inv.mode === 'hybrid') && !(inv.stack >= 1)) say('error', 'inventory', 'A stack size is at least 1.');
  if ((inv.mode === 'weight' || inv.mode === 'hybrid') && !(inv.weight > 0)) say('error', 'inventory', 'A weight limit needs a capacity above 0 kg.');
  const cap = capacityOf(project, inv);
  if (cap.slots.of && cap.slots.used > cap.slots.of) say('error', 'inventory', `The starting items take ${cap.slots.used} slots; it has ${cap.slots.of}.`);
  if (cap.weight.of && cap.weight.used > cap.weight.of) say('error', 'inventory', `The starting items weigh ${cap.weight.used} kg; it carries ${cap.weight.of} kg.`);
  if (cap.weight.of && cap.weight.unknown.length) say('warning', 'inventory', `No weight set, counted as 0 kg: ${cap.weight.unknown.join(', ')}.`);
  if (inv.mode !== 'unlimited' && inv.overflow === 'swap' && !p.roles.includes('player')) say('warning', 'inventory', 'Only the player can be asked what to drop; others refuse or drop.');
  for (const e of inv.equipment) {
    if (!e.item) continue;
    const it = project.objects[e.item];
    if (it?.type !== 'inventory') say('error', 'inventory', `The ${e.slot} item is no longer in the item library.`, e.slot);
    else if (!equipmentOf(it)) say('error', 'inventory', `${it.name} isn’t equipment, so it can’t go in ${e.slot}.`, e.slot);
    else if (!fitsSlot(project, e.item, e.slot)) say('error', 'inventory', `${it.name} goes in ${equipmentOf(it)!.slot}, not ${e.slot}.`, e.slot);
    if (!inv.items.some((i) => i.item === e.item)) say('error', 'inventory', `${it?.name ?? 'The item'} is equipped but not carried.`, e.slot);
  }
  if (p.roles.length && p.roles.every((r) => r === 'extra') && inv.items.length > 3) say('info', 'inventory', 'Ambient extras usually carry little; they can still drop what they have.');

  const fighter = p.abilities.some((a) => a.enabled && (a.category === 'combat' || a.category === 'magic'));
  if (p.roles.includes('enemy') || p.roles.includes('ally')) for (const x of aiProblems(p.ai, { hasAttack: fighter })) say(x.severity, 'ai', `AI: ${x.text}`);
  if (p.roles.includes('npc')) for (const x of npcProblems(project, p.npc, { hasTrade: p.abilities.some((a) => a.enabled && a.source.kind === 'library' && a.source.key === 'trade') })) say(x.severity, 'dialogue', x.text);
  if (p.roles.includes('ally')) for (const x of allyProblems(p.ally)) say(x.severity, 'roles', `Ally: ${x.text}`);
  if (p.roles.includes('extra')) for (const x of extraProblems(p.extra)) say(x.severity, 'roles', x.text);
  if (p.variants.length && !p.roles.includes('enemy')) say('warning', 'variants', 'It has enemy variants but isn’t an enemy NPC.');
  for (const v of p.variants) for (const x of variantProblems(project, p, v, p.variants)) say(x.severity, 'variants', x.text, v.id);

  if (p.art.use === 'placeholder') say('info', 'art', 'Uses placeholder art: a dummy that keeps its collider and props when final art is bound.');
  else if (!p.art.refs.some((r) => r.id === p.art.use)) say('error', 'art', 'The art it uses has been removed.');
  return out;
};

export const describeCard = (card: AbilityCard): string => {
  if (card.source.kind === 'custom') return (card.actions ?? []).map(describeAction).join('; ') || 'No actions yet.';
  return paramsOf(card).description;
};

// ---------------------------------------------------------------- import / export

export interface CharacterFile {
  format: 'vcgs-character';
  version: 1;
  character: { id: string; name: string; code?: string; notes: string; data: StoryObject['data'] };
  /** The items it refers to, by id, with names so an import can match them by name. */
  items: { id: string; name: string }[];
  skills: { id: string; name: string }[];
}

export const exportCharacter = (project: Project, id: string): CharacterFile | undefined => {
  const o = project.objects[id];
  if (!o || o.type !== 'character') return undefined;
  const p = profileOf(o);
  const itemIds = new Set([...p.inventory.items.map((i) => i.item), ...p.inventory.equipment.flatMap((e) => (e.item ? [e.item] : []))]);
  const skillIds = new Set(p.abilities.flatMap((a) => (a.source.kind === 'skill' ? [a.source.id] : [])));
  const named = (ids: Set<string>) => [...ids].map((x) => ({ id: x, name: project.objects[x]?.name ?? '' }));
  return { format: 'vcgs-character', version: 1, character: { id: o.id, name: o.name, ...(o.data.code ? { code: o.data.code } : {}), notes: o.notes, data: { ...o.data, profile: p } }, items: named(itemIds), skills: named(skillIds) };
};

/**
 * Bring a character file in. It keeps its id when that id is free (so a
 * character moved between projects keeps its links), else gets a new one;
 * the slug and code are made unique; items and skills are matched by id,
 * then by name, and what can't be matched is dropped and reported.
 */
export const importCharacter = (project: Project, file: unknown, now = new Date().toISOString()): { project: Project; id: string; notes: string[] } | { error: string } => {
  const f = file as Partial<CharacterFile> | null;
  if (!f || f.format !== 'vcgs-character' || !f.character || typeof f.character.name !== 'string') return { error: 'That isn’t a VC Game Studio character file.' };
  if (f.version !== 1) return { error: 'That character file is from a newer version of the studio.' };
  const notes: string[] = [];
  const byName = (type: 'inventory' | 'skill', ref: { id: string; name: string } | undefined, raw: string): string | undefined => {
    if (project.objects[raw]?.type === type) return raw;
    const match = ref?.name && Object.values(project.objects).find((x) => x.type === type && x.name.toLowerCase() === ref.name.toLowerCase());
    return match ? match.id : undefined;
  };
  const items = new Map((f.items ?? []).map((i) => [i.id, i]));
  const skills = new Map((f.skills ?? []).map((i) => [i.id, i]));
  const temp = makeObject('character', f.character.name, now, f.character.data ?? {});
  const p = profileOf(temp);
  const mapItem = (raw: string) => {
    const got = byName('inventory', items.get(raw), raw);
    if (!got) notes.push(`${items.get(raw)?.name || 'An item'} isn’t in this project, so it was left out.`);
    return got;
  };
  const invItems = p.inventory.items.flatMap((i) => {
    const got = mapItem(i.item);
    return got ? [{ item: got, qty: i.qty }] : [];
  });
  const equipment = p.inventory.equipment.map((e) => {
    if (!e.item) return e;
    const got = byName('inventory', items.get(e.item), e.item);
    return got ? { slot: e.slot, item: got } : { slot: e.slot };
  });
  const abilities = p.abilities.flatMap((a) => {
    if (a.source.kind !== 'skill') return [{ ...a }];
    const got = byName('skill', skills.get(a.source.id), a.source.id);
    if (!got) {
      notes.push(`The skill ${skills.get(a.source.id)?.name || a.name} isn’t in this project, so it was left out.`);
      return [];
    }
    return [{ ...a, source: { kind: 'skill' as const, id: got } }];
  });
  const id = f.character.id && !project.objects[f.character.id] && /^[a-z]+_[a-z0-9]+$/.test(f.character.id) ? f.character.id : temp.id;
  if (id !== f.character.id) notes.push('A character with its id is already here, so the import has a new id.');
  const code = f.character.code && !Object.values(project.objects).some((x) => x.data.code === f.character!.code) ? f.character.code : nextCode(project, ENTRY_CODE.character!);
  const profile: CharacterProfile = { ...p, slug: uniqueSlug(project, p.slug), abilities, inventory: { ...p.inventory, items: invItems, equipment }, revision: p.revision + 1 };
  const object: StoryObject = { ...temp, id, notes: String(f.character.notes ?? ''), data: { ...temp.data, code, color: profile.art.placeholder.tint, profile } };
  return { project: { ...project, objects: { ...project.objects, [id]: object } }, id, notes };
};

// ---------------------------------------------------------------- role settings, AI, variants

export const patchRole = <K extends 'player' | 'npc' | 'ally' | 'extra'>(project: Project, id: string, key: K, patch: Partial<CharacterProfile[K]>): Project =>
  updateProfile(project, id, (p) => ({ ...p, [key]: { ...p[key], ...patch } }));

export const patchAI = (project: Project, id: string, patch: Partial<AIProfile>): Project => updateProfile(project, id, (p) => ({ ...p, ai: { ...p.ai, ...patch, skill: { ...p.ai.skill, ...(patch.skill ?? {}) } } }));

export const setVariants = (project: Project, id: string, variants: EnemyVariant[]): Project => updateProfile(project, id, (p) => ({ ...p, variants }));

export const updateVariant = (project: Project, id: string, variantId: string, patch: Partial<EnemyVariant>): Project =>
  updateProfile(project, id, (p) => ({ ...p, variants: p.variants.map((v) => (v.id === variantId ? { ...v, ...patch } : v)) }));

export const patchVariantRules = (project: Project, id: string, patch: Partial<VariantRules>): Project => updateProfile(project, id, (p) => ({ ...p, variantRules: { ...p.variantRules, ...patch } }));

/** An ambient extra made a full interactive NPC (spec §6.5): same id, so every placement stays. */
export const promoteExtra = (project: Project, id: string): Project =>
  updateProfile(project, id, (p) => ({ ...p, roles: ROLES.map((r) => r.id).filter((r) => r === 'npc' || (r !== 'extra' && p.roles.includes(r))) }));

// ---------------------------------------------------------------- references (spec §12)

export interface CharacterUses {
  lines: number;
  scenes: string[];
  actors: string[];
  /** Arc lanes tied to it. */
  laneArcs: string[];
}

export const usesOf = (project: Project, id: string): CharacterUses => ({
  lines: project.lines.filter((l) => l.speakerId === id).length,
  scenes: project.connections.filter((c) => c.kind === 'contains' && c.targetId === id && project.objects[c.sourceId]).map((c) => project.objects[c.sourceId]!.name),
  actors: (project.levels?.items ?? []).filter((i) => i.params?.character === id).map((i) => i.name),
  laneArcs: project.lanes.filter((l) => l.characterId === id).map((l) => l.name),
});

/** Retire rather than delete: kept, every link intact, but out of the game. */
export const retireCharacter = (project: Project, id: string): Project => patchProfile(project, id, { enabled: false });

/**
 * Hand everything that points at one character to another, then delete the
 * first (spec §12's replace option): its lines are spoken by the other, its
 * scenes have the other in them, its level actors and arc lanes are the other's.
 */
export const replaceCharacter = (project: Project, from: string, to: string): Project => {
  if (from === to || project.objects[from]?.type !== 'character' || project.objects[to]?.type !== 'character') return project;
  const hasTo = new Set(project.connections.filter((c) => c.kind === 'contains' && c.targetId === to).map((c) => c.sourceId));
  const connections = project.connections.flatMap((c) => {
    if (c.kind !== 'contains' || c.targetId !== from) return [c];
    if (hasTo.has(c.sourceId)) return [];
    hasTo.add(c.sourceId);
    return [{ ...c, targetId: to }];
  });
  const levels = project.levels && {
    ...project.levels,
    items: project.levels.items.map((i) => (i.params?.character === from ? { ...i, params: { ...i.params, character: to } } : i)),
  };
  const moved: Project = {
    ...project,
    connections,
    lines: project.lines.map((l) => (l.speakerId === from ? { ...l, speakerId: to } : l)),
    lanes: project.lanes.map((l) => (l.characterId === from ? { ...l, characterId: to } : l)),
    ...(levels ? { levels } : {}),
  };
  return removeObject(moved, from);
};
