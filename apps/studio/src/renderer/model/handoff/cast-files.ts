import type { EngineId } from '../types';
import { CAST_SCHEMA, CAST_VERSION, castReportMarkdown, type IrCast } from './cast';
import type { ElementOutput, GeneratedFile } from './engines';
import { fingerprint } from './engines';

/**
 * The cast's files, the same for every engine (Character Creator spec §10):
 * characters.json and its JSON Schema, one manifest per character (with its
 * variants), per group and per level's placements, and CHARACTERS.md, the
 * export report: what the engine's starter runtime does and what is left to
 * the engine team. Each engine adds its runtime components beside them.
 */

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const bool = { type: 'boolean' } as const;
const strings = { type: 'array', items: str } as const;
const nullable = (t: object) => ({ anyOf: [t, { type: 'null' }] });
const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({ type: 'object', properties, required: Object.keys(properties).filter((k) => !optional.includes(k)), additionalProperties: false });
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const key = { type: 'string', pattern: '^[a-z0-9_]+$' } as const;
const vec3 = { type: 'array', items: num, minItems: 3, maxItems: 3 } as const;
const vec2 = { type: 'array', items: num, minItems: 2, maxItems: 2 } as const;
const rule = { type: 'object' } as const;

export const castSchema = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vc-writer.com/schemas/vcgs-characters-1.json',
  title: 'VC Game Studio characters',
  description: 'The Character Creator\'s cast: characters (identity, stats, placeholder, art binding, abilities, inventory, AI, role settings, variants), groups, and their placements in the levels. Keys are stable snake_case ids; `id` fields are the studio ids.',
  type: 'object',
  required: ['schema', 'version', 'characters', 'groups', 'placements', 'ids'],
  additionalProperties: false,
  properties: {
    $schema: str,
    schema: { const: CAST_SCHEMA },
    version: { const: CAST_VERSION },
    generator: str,
    characters: { type: 'array', items: ref('character') },
    groups: { type: 'array', items: ref('group') },
    placements: { type: 'array', items: ref('placement') },
    ids: { type: 'object', additionalProperties: str },
  },
  $defs: {
    stats: obj({ speed: num, jump: num, turn: num, radius: num, height: num, health: num, resource: obj({ kind: { enum: ['none', 'stamina', 'mana', 'health'] }, max: num }), interaction_radius: num, movement: { enum: ['walk', 'fly', 'swim', 'static'] } }),
    ability: obj({
      key,
      name: str,
      source: { enum: ['library', 'skill', 'custom'] },
      ref: nullable(str),
      category: { enum: ['movement', 'combat', 'magic', 'utility', 'social', 'defense'] },
      kind: { enum: ['active', 'passive'] },
      rank: num,
      enabled: bool,
      graybox: { enum: ['working', 'stub'] },
      description: str,
      cost: obj({ resource: str, amount: num }),
      cooldown: num,
      range: num,
      target: { enum: ['self', 'enemy', 'ally', 'area', 'point'] },
      magnitude: num,
      duration: num,
      unlock: str,
      cue: str,
      vfx: str,
      sfx: str,
      failure: str,
      ai_use: str,
      actions: { type: 'array', items: obj({ target: str, condition: str, value: str, effect: { enum: ['damage', 'heal', 'push', 'stun', 'buff', 'debuff', 'teleport', 'spawn', 'setFlag'] }, amount: num, timing: { enum: ['instant', 'overTime', 'delayed'] }, seconds: num, event: str }) },
    }),
    inventory: obj({ mode: { enum: ['unlimited', 'slots', 'stack', 'weight', 'hybrid'] }, slots: num, stack: num, weight: num, overflow: { enum: ['refuse', 'drop', 'swap'] }, persists: bool, items: { type: 'array', items: obj({ item: key, qty: num }) }, equipment: { type: 'array', items: obj({ slot: str, item: nullable(key) }) } }),
    ai: nullable(
      obj({
        states: strings,
        start: { enum: ['idle', 'patrol'] },
        vision_angle: num,
        view_distance: num,
        line_of_sight: bool,
        hearing_radius: num,
        proximity_radius: num,
        attack_range: num,
        attack_cooldown: num,
        reaction: num,
        chase_timeout: num,
        disengage_distance: num,
        investigate_seconds: num,
        search_seconds: num,
        stun_seconds: num,
        reset_to_post: bool,
        tactics: str,
        skill: { type: 'object', additionalProperties: num },
        transitions: { type: 'array', items: obj({ from: str, to: str, when: str, value: num, enabled: bool }) },
      }),
    ),
    variant: obj({
      key,
      name: str,
      tier: num,
      levels: vec2,
      group_size: num,
      difficulty: num,
      encounter_cost: num,
      differences: { type: 'array', items: obj({ label: str, base: str, value: str }) },
      stats: ref('stats'),
      abilities: { type: 'array', items: ref('ability') },
      inventory: ref('inventory'),
      hit: num,
      ai: ref('ai'),
    }),
    character: obj(
      {
        key,
        id: str,
        slug: key,
        story_key: str,
        name: str,
        code: str,
        roles: { type: 'array', items: { enum: ['player', 'enemy', 'npc', 'ally', 'extra'] } },
        archetype: str,
        species: str,
        presentation: str,
        appearance: str,
        tags: strings,
        enabled: bool,
        revision: num,
        stats: ref('stats'),
        placeholder: obj({ silhouette: str, tint: str, label: str, scale: num, prop: { enum: ['none', 'sword', 'shield', 'bow', 'staff'] } }),
        binding: obj({ final_model: str, rig: { enum: ['none', 'humanoid', 'generic', 'quadruped'] }, animations: strings, sockets: obj({ hand: str, off_hand: str, head: str }), audio: { type: 'array', items: obj({ key: str, file: str }) } }),
        art: { type: 'array', items: obj({ kind: str, name: str }) },
        abilities: { type: 'array', items: ref('ability') },
        inventory: ref('inventory'),
        hit: num,
        ai: ref('ai'),
        npc: nullable(
          obj(
            {
              services: strings,
              prompt: str,
              greeting: str,
              busy: str,
              available: rule,
              topics: { type: 'array', items: obj({ key, name: str, knowledge: str, when: rule, lines: strings, effects: { type: 'array' } }, ['when', 'effects']) },
              quest_flags: strings,
              entrances: strings,
              stock: { type: 'array', items: obj({ item: key, price: num, qty: num }) },
              currency: nullable(key),
            },
            ['available'],
          ),
        ),
        ally: nullable(obj({ faction: str, recruit: rule, trust: num, follow_distance: num, support: str, shares_inventory: bool, talks_while_following: bool, dismissible: bool, persists: bool }, ['recruit'])),
        extra: nullable(obj({ loops: strings, wander_radius: num, flee_from: { enum: ['combat', 'player', 'never'] }, bark: str })),
        player: nullable(obj({ upgrades: str, respawn: str, lives: num, persists: bool, controls: str })),
        variants: { type: 'array', items: ref('variant') },
        variant_rules: obj({ max_growth: num, max_attackers: num, patrol_radius: num, spawn_budget: num }),
        difficulty: num,
      },
      [],
    ),
    group: obj({
      key,
      id: str,
      name: str,
      entries: { type: 'array', items: obj({ character: key, variant: nullable(key), min: num, max: num, weight: num, activity: { enum: ['wander', 'idle', 'talk', 'work', 'patrol', 'guard'] } }) },
      formation: str,
      spacing: num,
      wander_radius: num,
      route: str,
      density: num,
      schedule: { enum: ['always', 'day', 'night'] },
      faction: str,
      persists: bool,
      seed: num,
    }),
    placement: obj({
      level: str,
      item: str,
      kind: { enum: ['group', 'actor'] },
      group: nullable(key),
      members: {
        type: 'array',
        items: obj({
          id: str,
          character: key,
          variant: nullable(key),
          activity: str,
          position: vec3,
          turn: num,
          route: { type: 'array', items: vec3 },
          wander_radius: num,
          area: nullable(obj({ center: vec2, size: vec2, turn: num, outline: nullable({ type: 'array', items: vec2 }) })),
        }),
      },
    }),
  },
});

export interface CastOutput {
  files: GeneratedFile[];
  elements: ElementOutput[];
  /** Where characters.json is. */
  dataPath: string;
}

/** The cast's files under `root` (relative to the engine project), and a row for each character and group. */
export const castFiles = (cast: IrCast | undefined, root: string, engine: EngineId, engineName: string, version: string): CastOutput => {
  const dataPath = `${root}/characters.json`;
  if (!cast || (!cast.characters.length && !cast.groups.length)) return { files: [], elements: [], dataPath };
  const files: GeneratedFile[] = [
    { path: dataPath, content: `${JSON.stringify({ $schema: './characters.schema.json', ...cast, generator: 'VC Game Studio' }, null, 2)}\n`, kind: 'generated' },
    { path: `${root}/characters.schema.json`, content: `${JSON.stringify(castSchema(), null, 2)}\n`, kind: 'runtime' },
    { path: `${root}/CHARACTERS.md`, content: castReportMarkdown(cast, engine, engineName), kind: 'generated' },
  ];
  const elements: ElementOutput[] = [];
  for (const c of cast.characters) {
    const path = `${root}/characters/${c.key}.json`;
    files.push({ path, content: `${JSON.stringify(c, null, 2)}\n`, kind: 'generated' });
    const what = [c.roles.length ? c.roles.join(', ') : 'no role', `${c.abilities.length} abilities`, c.ai ? 'AI' : '', c.npc ? `${c.npc.topics.length} topics` : '', c.variants.length ? `${c.variants.length} variants` : '', c.binding.final_model ? 'final art bound' : 'placeholder'].filter(Boolean).join(' · ');
    elements.push({ id: `cast:${c.id}`, label: `${c.code} ${c.name} (profile)`.trim(), symbol: 'character', group: 'People + words', generates: `characters/${c.key}.json · ${what}`, files: [path, dataPath], fingerprint: fingerprint(`${version}:${JSON.stringify(c)}`) });
  }
  for (const g of cast.groups) {
    const path = `${root}/groups/${g.key}.json`;
    const placed = cast.placements.filter((p) => p.group === g.key);
    files.push({ path, content: `${JSON.stringify({ ...g, placements: placed }, null, 2)}\n`, kind: 'generated' });
    elements.push({ id: `group:${g.id}`, label: `${g.name} (group)`, symbol: 'character', group: 'People + words', generates: `groups/${g.key}.json · ${g.entries.length} kinds · ${placed.reduce((n, p) => n + p.members.length, 0)} placed`, files: [path, dataPath], fingerprint: fingerprint(`${version}:${JSON.stringify(g)}:${JSON.stringify(placed)}`) });
  }
  return { files, elements, dataPath };
};
