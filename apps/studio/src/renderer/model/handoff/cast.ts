import { abilityTemplate, type ActionCondition, type ActionEffect, type ActionTiming, type AbilityTarget } from '../character/abilities';
import { aiStep as studioStep, startMemory as studioStart, type AIProfile, type AIState, type AITrigger, type AIWorld, type Tactics } from '../character/ai';
import { groupsOf } from '../character/groups';
import { characters, grayboxOf, paramsOf, profileOf, type CharacterProfile } from '../character/profile';
import { differencesOf, difficultyOf, encounterCost, resolveVariant } from '../character/variants';
import { levelsOf } from '../level/level';
import { levelCast } from '../level/play';
import type { EngineId, Project } from '../types';
import type { IrEffect, IrRule } from './ir';
import type { StoryKeys } from './levels';

/**
 * The cast as it goes to the engines (Character Creator spec §10, §11): one
 * versioned, schema'd manifest (`characters.json`, schema `vcgs-characters`
 * v1) with every character, its abilities, inventory, AI profile and role
 * settings, its variants (what they change, and the whole of each), the
 * groups, and every placement in the levels: group members already spread
 * (the studio's seeded generator, so the engines spawn exactly the people
 * the designer saw) and placed actors. Ids are stable: characters keep their
 * story key, group members are `<area guid>#n`, and the id map ties each to
 * the studio's own ids. The report says, engine by engine, what the starter
 * runtime does and what is left to the engine team, so nothing passes as
 * working that isn't.
 */

export const CAST_SCHEMA = 'vcgs-characters';
export const CAST_VERSION = 1;

export interface IrAbility {
  key: string;
  name: string;
  source: 'library' | 'skill' | 'custom';
  /** The library entry or the skill (story key). */
  ref: string | null;
  category: string;
  kind: 'active' | 'passive';
  rank: number;
  enabled: boolean;
  /** Whether the starter runtime simulates it: "working", or "stub" (kept as data; the engine implements it). */
  graybox: 'working' | 'stub';
  description: string;
  cost: { resource: string; amount: number };
  cooldown: number;
  range: number;
  target: AbilityTarget;
  magnitude: number;
  duration: number;
  unlock: string;
  cue: string;
  vfx: string;
  sfx: string;
  failure: string;
  ai_use: string;
  actions: { target: AbilityTarget; condition: ActionCondition; value: string; effect: ActionEffect; amount: number; timing: ActionTiming; seconds: number; event: string }[];
}

export interface IrAI {
  states: AIState[];
  start: 'idle' | 'patrol';
  vision_angle: number;
  view_distance: number;
  line_of_sight: boolean;
  hearing_radius: number;
  proximity_radius: number;
  attack_range: number;
  attack_cooldown: number;
  reaction: number;
  chase_timeout: number;
  disengage_distance: number;
  investigate_seconds: number;
  search_seconds: number;
  stun_seconds: number;
  reset_to_post: boolean;
  tactics: Tactics;
  skill: Record<string, number>;
  /** In priority order: the first enabled one that holds wins. */
  transitions: { from: AIState | 'any'; to: AIState; when: AITrigger; value: number; enabled: boolean }[];
}

export interface IrCastCharacter {
  key: string;
  id: string;
  slug: string;
  /** The character's key in story.json and the story keys (it follows the name). */
  story_key: string;
  name: string;
  code: string;
  roles: string[];
  archetype: string;
  species: string;
  presentation: string;
  appearance: string;
  tags: string[];
  enabled: boolean;
  revision: number;
  stats: { speed: number; jump: number; turn: number; radius: number; height: number; health: number; resource: { kind: string; max: number }; interaction_radius: number; movement: string };
  placeholder: { silhouette: string; tint: string; label: string; scale: number; prop: string };
  /** Final art in the engine; the placeholder stands in until it is set. */
  binding: { final_model: string; rig: string; animations: string[]; sockets: { hand: string; off_hand: string; head: string }; audio: { key: string; file: string }[] };
  /** The art in the studio, by name (images stay in the project). */
  art: { kind: string; name: string }[];
  abilities: IrAbility[];
  inventory: { mode: string; slots: number; stack: number; weight: number; overflow: string; persists: boolean; items: { item: string; qty: number }[]; equipment: { slot: string; item: string | null }[] };
  /** The damage of one blow (first combat ability, by rank), as the starter runtime deals it. */
  hit: number;
  ai: IrAI | null;
  npc: { services: string[]; prompt: string; greeting: string; busy: string; available?: IrRule; topics: { key: string; name: string; knowledge: string; when?: IrRule; lines: string[]; effects?: IrEffect[] }[]; quest_flags: string[]; entrances: string[]; stock: { item: string; price: number; qty: number }[]; currency: string | null } | null;
  ally: { faction: string; recruit?: IrRule; trust: number; follow_distance: number; support: string; shares_inventory: boolean; talks_while_following: boolean; dismissible: boolean; persists: boolean } | null;
  extra: { loops: string[]; wander_radius: number; flee_from: string; bark: string } | null;
  player: { upgrades: string; respawn: string; lives: number; persists: boolean; controls: string } | null;
  variants: IrVariant[];
  variant_rules: { max_growth: number; max_attackers: number; patrol_radius: number; spawn_budget: number };
  difficulty: number;
}

export interface IrVariant {
  key: string;
  name: string;
  tier: number;
  levels: [number, number];
  group_size: number;
  difficulty: number;
  encounter_cost: number;
  /** What it changes, beside the base's value. */
  differences: { label: string; base: string; value: string }[];
  /** The whole of it, base and differences together, ready to spawn. */
  stats: IrCastCharacter['stats'];
  abilities: IrAbility[];
  inventory: IrCastCharacter['inventory'];
  hit: number;
  ai: IrAI | null;
}

export interface IrGroup {
  key: string;
  id: string;
  name: string;
  entries: { character: string; variant: string | null; min: number; max: number; weight: number; activity: string }[];
  formation: string;
  spacing: number;
  wander_radius: number;
  route: string;
  density: number;
  schedule: string;
  faction: string;
  persists: boolean;
  seed: number;
}

export interface IrPlacement {
  level: string;
  /** The level item: a Character group area, or a placed actor. */
  item: string;
  kind: 'group' | 'actor';
  group: string | null;
  /** Group members, as the studio spread them; one for a placed actor. */
  members: { id: string; character: string; variant: string | null; activity: string; position: [number, number, number]; turn: number; route: [number, number, number][]; wander_radius: number; area: { center: [number, number]; size: [number, number]; turn: number; outline: [number, number][] | null } | null }[];
}

export interface IrCastIssue {
  severity: 'todo' | 'warning' | 'info';
  about: string;
  text: string;
}

export interface IrCast {
  schema: typeof CAST_SCHEMA;
  version: typeof CAST_VERSION;
  characters: IrCastCharacter[];
  groups: IrGroup[];
  placements: IrPlacement[];
  /** Studio id → stable export id (character keys, variant keys, group keys, member ids). */
  ids: Record<string, string>;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const buildCast = (project: Project, story: StoryKeys & { line: (lineId: string) => string | null }): IrCast => {
  const ids: Record<string, string> = {};
  const key = (id: string) => story.key(id) ?? story.toKey(id);
  const abilityKeys = new Map<string, string>();
  const ability = (p: CharacterProfile, owner: string) => (a: CharacterProfile['abilities'][number]): IrAbility => {
    const prm = paramsOf(a);
    const base = story.toKey(a.name);
    let k = base;
    const used = new Set([...abilityKeys.entries()].filter(([id]) => id.startsWith(`${owner}:`)).map(([, v]) => v));
    for (let n = 2; used.has(k); n++) k = `${base}_${n}`;
    abilityKeys.set(`${owner}:${a.id}`, k);
    return {
      key: k,
      name: a.name,
      source: a.source.kind,
      ref: a.source.kind === 'library' ? a.source.key : a.source.kind === 'skill' ? story.key(a.source.id) : null,
      category: a.category,
      kind: a.kind,
      rank: a.rank,
      enabled: a.enabled,
      graybox: grayboxOf(a),
      description: prm.description,
      cost: { resource: prm.cost.resource, amount: prm.cost.amount },
      cooldown: prm.cooldown,
      range: prm.range,
      target: prm.target,
      magnitude: prm.magnitude,
      duration: prm.duration,
      unlock: prm.unlock,
      cue: prm.cue,
      vfx: prm.vfx,
      sfx: prm.sfx,
      failure: prm.failure,
      ai_use: prm.aiUse,
      actions: (a.actions ?? []).map((x) => ({ target: x.target, condition: x.condition, value: x.conditionValue ?? '', effect: x.effect, amount: x.amount, timing: x.timing, seconds: x.seconds, event: x.event })),
    };
  };
  const hitOf = (p: CharacterProfile): number => {
    const card = p.abilities.find((a) => a.enabled && (a.category === 'combat' || a.category === 'magic') && a.kind === 'active');
    if (!card) return 5;
    const m = paramsOf(card).magnitude || (card.source.kind === 'library' ? (abilityTemplate(card.source.key)?.defaults.magnitude ?? 5) : 5);
    return r3(m * (1 + (card.rank - 1) * 0.25));
  };
  const ai = (p: CharacterProfile): IrAI | null =>
    p.roles.includes('enemy') || p.roles.includes('ally')
      ? {
          states: p.ai.states,
          start: p.ai.start,
          vision_angle: p.ai.visionAngle,
          view_distance: p.ai.viewDistance,
          line_of_sight: p.ai.lineOfSight,
          hearing_radius: p.ai.hearingRadius,
          proximity_radius: p.ai.proximityRadius,
          attack_range: p.ai.attackRange,
          attack_cooldown: p.ai.attackCooldown,
          reaction: p.ai.reaction,
          chase_timeout: p.ai.chaseTimeout,
          disengage_distance: p.ai.disengageDistance,
          investigate_seconds: p.ai.investigateSeconds,
          search_seconds: p.ai.searchSeconds,
          stun_seconds: p.ai.stunSeconds,
          reset_to_post: p.ai.resetToPost,
          tactics: p.ai.tactics,
          skill: { ...p.ai.skill },
          transitions: p.ai.transitions.map((t) => ({ from: t.from, to: t.to, when: t.trigger, value: t.value ?? 0, enabled: t.enabled })),
        }
      : null;
  const stats = (p: CharacterProfile): IrCastCharacter['stats'] => ({
    speed: p.stats.speed,
    jump: p.stats.jump,
    turn: p.stats.turn,
    radius: p.stats.radius,
    height: p.stats.height,
    health: p.stats.health,
    resource: { kind: p.stats.resource.kind, max: p.stats.resource.max },
    interaction_radius: p.stats.interactionRadius,
    movement: p.stats.movement,
  });
  const inventory = (p: CharacterProfile): IrCastCharacter['inventory'] => ({
    mode: p.inventory.mode,
    slots: p.inventory.slots,
    stack: p.inventory.stack,
    weight: p.inventory.weight,
    overflow: p.inventory.overflow,
    persists: p.inventory.persists,
    items: p.inventory.items.flatMap((i) => (story.key(i.item) ? [{ item: story.key(i.item)!, qty: i.qty }] : [])),
    equipment: p.inventory.equipment.map((e) => ({ slot: e.slot, item: e.item ? story.key(e.item) : null })),
  });

  // A character's key is its slug (spec §3, §11): kept on rename, so the engine's id doesn't move when the name does.
  const usedKeys = new Set<string>();
  const cast = characters(project).map((c): IrCastCharacter => {
    const p = profileOf(c);
    const base = /^[a-z0-9_]+$/.test(p.slug) ? p.slug : key(c.id);
    let k = base;
    for (let n = 2; usedKeys.has(k); n++) k = `${base}_${n}`;
    usedKeys.add(k);
    ids[c.id] = k;
    const variantKeys = new Set<string>();
    return {
      key: k,
      id: c.id,
      slug: p.slug,
      story_key: key(c.id),
      name: c.name,
      code: c.data.code ?? '',
      roles: p.roles,
      archetype: p.archetype,
      species: p.species,
      presentation: p.presentation,
      appearance: p.appearance,
      tags: p.tags,
      enabled: p.enabled,
      revision: p.revision,
      stats: stats(p),
      placeholder: { silhouette: p.art.placeholder.silhouette, tint: p.art.placeholder.tint, label: p.art.placeholder.label, scale: p.art.placeholder.scale, prop: p.art.placeholder.prop },
      binding: { final_model: p.binding.finalModel, rig: p.binding.rig, animations: p.binding.animations, sockets: { hand: p.binding.sockets.hand, off_hand: p.binding.sockets.offHand, head: p.binding.sockets.head }, audio: p.binding.audio },
      art: p.art.refs.map((r) => ({ kind: r.kind, name: r.name })),
      abilities: p.abilities.map(ability(p, c.id)),
      inventory: inventory(p),
      hit: hitOf(p),
      ai: ai(p),
      npc: p.roles.includes('npc')
        ? {
            services: p.npc.services,
            prompt: p.npc.prompt,
            greeting: p.npc.greeting,
            busy: p.npc.busy,
            ...(story.rule(p.npc.available) ? { available: story.rule(p.npc.available) } : {}),
            topics: p.npc.topics.map((t) => ({
              key: story.toKey(t.name || t.id),
              name: t.name,
              knowledge: t.knowledge,
              ...(story.rule(t.when) ? { when: story.rule(t.when) } : {}),
              lines: t.lines.flatMap((l) => (story.line(l) ? [story.line(l)!] : [])),
              ...(story.effects(t.effects) ? { effects: story.effects(t.effects) } : {}),
            })),
            quest_flags: p.npc.questFlags.flatMap((f) => (story.key(f) ? [story.key(f)!] : [])),
            entrances: p.npc.entrances.flatMap((f) => (story.key(f) ? [story.key(f)!] : [])),
            stock: p.npc.stock.flatMap((s) => (story.key(s.item) ? [{ item: story.key(s.item)!, price: s.price, qty: s.qty }] : [])),
            currency: p.npc.currency ? story.key(p.npc.currency) : null,
          }
        : null,
      ally: p.roles.includes('ally')
        ? { faction: p.ally.faction, ...(story.rule(p.ally.recruit) ? { recruit: story.rule(p.ally.recruit) } : {}), trust: p.ally.trust, follow_distance: p.ally.followDistance, support: p.ally.support, shares_inventory: p.ally.sharesInventory, talks_while_following: p.ally.talksWhileFollowing, dismissible: p.ally.dismissible, persists: p.ally.persists }
        : null,
      extra: p.roles.includes('extra') ? { loops: p.extra.loops, wander_radius: p.extra.wanderRadius, flee_from: p.extra.fleeFrom, bark: p.extra.bark } : null,
      player: p.roles.includes('player') ? { upgrades: p.player.upgrades, respawn: p.player.respawn, lives: p.player.lives, persists: p.player.persists, controls: p.player.controls } : null,
      variants: p.variants.map((v) => {
        const base = story.toKey(v.name || 'variant');
        let vk = base;
        for (let n = 2; variantKeys.has(vk); n++) vk = `${base}_${n}`;
        variantKeys.add(vk);
        ids[v.id] = `${k}.${vk}`;
        const whole = resolveVariant(p, v);
        return {
          key: vk,
          name: v.name,
          tier: v.tier,
          levels: [v.levels.min, v.levels.max],
          group_size: v.groupSize,
          difficulty: difficultyOf(whole),
          encounter_cost: encounterCost(p, v),
          differences: differencesOf(project, p, v),
          stats: stats(whole),
          abilities: whole.abilities.map(ability(whole, `${c.id}/${v.id}`)),
          inventory: inventory(whole),
          hit: hitOf(whole),
          ai: ai(whole),
        };
      }),
      variant_rules: { max_growth: p.variantRules.maxGrowth, max_attackers: p.variantRules.maxAttackers, patrol_radius: p.variantRules.patrolRadius, spawn_budget: p.variantRules.spawnBudget },
      difficulty: difficultyOf(p),
    };
  });

  const groupKeys = new Set<string>();
  const groups = groupsOf(project).map((g): IrGroup => {
    const base = story.toKey(g.name || 'group');
    let gk = base;
    for (let n = 2; groupKeys.has(gk); n++) gk = `${base}_${n}`;
    groupKeys.add(gk);
    ids[g.id] = gk;
    return {
      key: gk,
      id: g.id,
      name: g.name,
      entries: g.entries.filter((e) => ids[e.character]).map((e) => ({ character: ids[e.character]!, variant: e.variant && ids[e.variant] ? ids[e.variant]!.split('.')[1]! : null, min: e.min, max: e.max, weight: e.weight, activity: e.activity })),
      formation: g.formation,
      spacing: g.spacing,
      wander_radius: g.wanderRadius,
      route: g.route,
      density: g.density,
      schedule: g.schedule,
      faction: g.faction,
      persists: g.persists,
      seed: g.seed,
    };
  });

  const placements: IrPlacement[] = [];
  const set = levelsOf(project);
  for (const level of set.levels) {
    const byItem = new Map<string, IrPlacement>();
    for (const c of levelCast(project, level.id)) {
      if (!ids[c.character]) continue;
      const item = set.items.find((i) => i.id === c.itemId);
      let pl = byItem.get(c.itemId);
      if (!pl) {
        pl = { level: level.id, item: c.itemId, kind: c.placed ? 'actor' : 'group', group: c.placed ? null : (ids[String(item?.params?.group ?? '')] ?? null), members: [] };
        byItem.set(c.itemId, pl);
        placements.push(pl);
      }
      const n = pl.members.length + 1;
      const id = c.placed ? c.itemId : `${c.itemId}#${n}`;
      ids[c.key] = id;
      pl.members.push({
        id,
        character: ids[c.character]!,
        variant: c.variant && ids[c.variant] ? ids[c.variant]!.split('.')[1]! : null,
        activity: c.activity,
        position: [r3(c.home.x), r3(c.z), r3(c.home.y)],
        turn: r3(-((c.yaw * 180) / Math.PI)),
        route: c.route.map((p) => [r3(p.x), r3(c.z), r3(p.y)]),
        wander_radius: c.wanderRadius,
        area: c.area ? { center: [r3(c.area.x), r3(c.area.y)], size: [r3(c.area.w), r3(c.area.d)], turn: r3(-c.area.rotation), outline: c.area.outline ? c.area.outline.map((o) => [r3(o.x), r3(o.y)]) : null } : null,
      });
    }
  }
  return { schema: CAST_SCHEMA, version: CAST_VERSION, characters: cast, groups, placements, ids };
};

// ---------------------------------------------------------------- what each engine gets (spec §10: no false assurances)

const ENGINE_NAV: Record<'godot' | 'unity' | 'unreal', { nav: string; anim: string; ai: string; fx: string }> = {
  godot: { nav: 'NavigationAgent3D on a baked NavigationRegion3D', anim: 'an AnimationPlayer or AnimationTree on the bound model', ai: 'VCGSActorBehavior (GDScript)', fx: 'GPUParticles3D and AudioStreamPlayer3D' },
  unity: { nav: 'a NavMeshAgent on a baked NavMesh', anim: 'an Animator controller on the bound model', ai: 'VcgsActorBehavior (C#)', fx: 'a ParticleSystem and an AudioSource' },
  unreal: { nav: 'an AAIController with a NavMesh (MoveTo)', anim: 'an Animation Blueprint or AnimMontages on the skeletal mesh', ai: 'UVcgsActorBehavior on AVcgsCharacterActor (C++)', fx: 'Niagara and a SoundCue' },
};

/**
 * The export report: what the starter runtime does for each character and
 * group in this engine, and what is a TODO for the engine team (stub
 * abilities, navigation, animation, effects, schedules), with where to do it.
 */
export const castReport = (cast: IrCast, engine: EngineId): IrCastIssue[] => {
  const out: IrCastIssue[] = [];
  const e = engine === 'godot' || engine === 'unity' || engine === 'unreal' ? ENGINE_NAV[engine] : null;
  const say = (severity: IrCastIssue['severity'], about: string, text: string) => out.push({ severity, about, text });
  if (!cast.characters.length) return out;
  if (e) {
    say('info', 'Runtime', `${e.ai} runs each AI character's state machine exactly as the studio's preview does (senses, reaction, chase, attack, search, return, disengage), moving it in straight lines.`);
    say('todo', 'Navigation', `Characters walk straight lines between points. For pathfinding round obstacles, drive the movement with ${e.nav}: the behaviour's move target is exposed for it.`);
    say('todo', 'Animation', `Ability cues, walk and idle are sent as events (the cue names). Play them on ${e.anim} once final art is bound.`);
    say('todo', 'Effects', `VFX and SFX placeholders are names only: hook ${e.fx} to the ability events.`);
  } else {
    say('todo', 'Runtime', 'No starter runtime for this engine: read characters.json (characters.schema.json describes it) and port the AI machine, senses, inventory capacity and ability costs from docs/CHARACTER-CREATOR.md, or from one of the Godot, Unity or Unreal runtimes.');
  }
  for (const c of cast.characters) {
    for (const a of [...c.abilities, ...c.variants.flatMap((v) => v.abilities)]) {
      if (!a.enabled) continue;
      if (a.graybox === 'stub' && a.source === 'library') say('todo', c.name, `${a.name} is a stub: the AbilityComponent checks its cost and cooldown and sends “${a.cue || a.key}”, but what it does is the engine's to write.`);
      if (a.source === 'skill') say('info', c.name, `${a.name} is the story skill ${a.ref}: its ranks and effects come from the story runtime.`);
      if (a.source === 'custom') {
        const unsupported = a.actions.filter((x) => !['damage', 'heal', 'stun', 'setFlag'].includes(x.effect));
        if (unsupported.length && e) say('todo', c.name, `${a.name}: ${unsupported.map((x) => x.effect).join(', ')} ${unsupported.length === 1 ? 'is' : 'are'} sent as events; damage, heal, stun and set-flag run in the starter runtime.`);
      }
    }
    if (c.binding.final_model) say('info', c.name, `Bound to ${c.binding.final_model} (${c.binding.rig}); props attach at “${c.binding.sockets.hand}”. Its id, inventory, dialogue and logic don't change with the art.`);
    else say('info', c.name, 'No final model bound: the placeholder figure stands in.');
    if (c.npc) say('info', c.name, `${c.npc.topics.length} topic${c.npc.topics.length === 1 ? '' : 's'} on the DialogueComponent; their conditions use the story runtime's rules.`);
    if (c.npc?.services.includes('vendor')) say('todo', c.name, 'A vendor: the stock is data on the DialogueComponent; the shop screen is the engine’s to build.');
  }
  for (const g of cast.groups) {
    if (g.schedule !== 'always') say('todo', g.name, `Scheduled ${g.schedule === 'day' ? 'by day' : 'by night'}: the SpawnGroupController has show and hide for the game's own clock to call.`);
    if (g.faction) say('info', g.name, `Faction “${g.faction}” is data; attitudes between factions are the engine's.`);
  }
  if (cast.placements.some((p) => p.members.length > 50)) say('warning', 'Performance', 'A group of more than 50: consider LOD and pooled spawns in the engine (the starter runtime spawns them all).');
  return out;
};

export const castReportMarkdown = (cast: IrCast, engine: EngineId, engineName: string): string => {
  const report = castReport(cast, engine);
  const lines = [
    `# Characters in ${engineName}`,
    '',
    `Generated by VC Game Studio from the Character Creator: ${cast.characters.length} characters, ${cast.characters.reduce((n, c) => n + c.variants.length, 0)} variants, ${cast.groups.length} groups, ${cast.placements.reduce((n, p) => n + p.members.length, 0)} placed in the levels. The data is \`characters.json\` (schema \`${CAST_SCHEMA}\` v${CAST_VERSION}).`,
    '',
  ];
  const sections: [IrCastIssue['severity'], string][] = [
    ['todo', 'To do in the engine'],
    ['warning', 'Warnings'],
    ['info', 'Mapped'],
  ];
  for (const [sev, title] of sections) {
    const items = report.filter((r) => r.severity === sev);
    if (!items.length) continue;
    lines.push(`## ${title}`, '', ...items.map((r) => `- **${r.about}:** ${r.text}`), '');
  }
  lines.push('## Ids', '', 'Stable ids, studio → engine:', '', ...Object.entries(cast.ids).map(([from, to]) => `- \`${from}\` → \`${to}\``), '');
  return lines.join('\n');
};

// ---------------------------------------------------------------- cross-checks for the engine ports


/** An exported AI profile back in the studio's own terms. */
export const aiFromIr = (ai: IrAI): AIProfile => ({
  states: ai.states,
  start: ai.start,
  visionAngle: ai.vision_angle,
  viewDistance: ai.view_distance,
  lineOfSight: ai.line_of_sight,
  hearingRadius: ai.hearing_radius,
  proximityRadius: ai.proximity_radius,
  attackRange: ai.attack_range,
  attackCooldown: ai.attack_cooldown,
  reaction: ai.reaction,
  chaseTimeout: ai.chase_timeout,
  disengageDistance: ai.disengage_distance,
  investigateSeconds: ai.investigate_seconds,
  searchSeconds: ai.search_seconds,
  stunSeconds: ai.stun_seconds,
  resetToPost: ai.reset_to_post,
  tactics: ai.tactics,
  skill: ai.skill as unknown as AIProfile['skill'],
  transitions: ai.transitions.map((t, i) => ({ id: `t${i}`, from: t.from, to: t.to, trigger: t.when, ...(t.when === 'healthBelow' ? { value: t.value } : {}), enabled: t.enabled })),
});

export interface AiScenario {
  name: string;
  character: string;
  speed: number;
  health: number;
  patrol: [number, number][];
  walls: [[number, number], [number, number]][];
  /** The target at step i: (x + vx·i, y + vy·i). */
  target: { x: number; y: number; vx: number; vy: number; noisy: boolean };
  steps: number;
  dt: number;
  /** What the studio's own machine does: every transition's reason, and where it ends. */
  trail: string[];
  final: { state: string; attacks: number; x: number; y: number };
}

/** Run a scenario with the studio's machine, for the engines' checks to compare against. */
export const runScenario = (c: IrCastCharacter, s: Omit<AiScenario, 'trail' | 'final' | 'character' | 'speed' | 'health'>): AiScenario => {
  const ai = aiFromIr(c.ai!);
  const world: AIWorld = { patrol: s.patrol.map(([x, y]) => ({ x, y })), walls: s.walls.map(([a, b]) => [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }]), target: { x: s.target.x, y: s.target.y, noisy: s.target.noisy, alive: true } };
  let m = studioStart(world, ai, c.stats.health);
  const trail: string[] = [];
  for (let i = 0; i < s.steps; i++) {
    world.target = { ...world.target, x: s.target.x + s.target.vx * i, y: s.target.y + s.target.vy * i };
    const r = studioStep(ai, c.stats.speed, m, world, s.dt);
    m = r.memory;
    if (r.reason) trail.push(r.reason);
  }
  return { ...s, character: c.key, speed: c.stats.speed, health: c.stats.health, trail, final: { state: m.state, attacks: m.attacks, x: Math.round(m.pos.x * 1000) / 1000, y: Math.round(m.pos.y * 1000) / 1000 } };
};
