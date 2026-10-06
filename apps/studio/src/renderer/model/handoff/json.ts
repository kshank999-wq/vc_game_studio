import { tasksMarkdown } from './notes';
import type { EngineAdapter, ElementOutput, EngineOutput, GeneratedFile } from './engines';
import { fingerprint } from './engines';
import { DESIGN_LISTS, type HandoffIR } from './ir';

/**
 * The JSON adapter: the handoff model itself, for any engine. story.json is
 * the whole story as plain data with stable snake_case keys; story.schema.json
 * describes it (JSON Schema 2020-12); the README says how to play it. An
 * engine without its own adapter reads these and nothing else.
 */

const VERSION = 'json-1';
export const JSON_FORMAT = { format: 'vcgs-story', version: 1 } as const;

const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const strings = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: 'object', properties, required });
const ident = obj({ key: { type: 'string', pattern: '^[a-z0-9_]+$' }, type: { type: 'string', pattern: '^[A-Za-z0-9]+$' } });

/** The schema for story.json. Kept by hand next to the IR types, and tested against the sample. */
export const storySchema = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vc-writer.com/schemas/vcgs-story-1.json',
  title: 'VC Game Studio story handoff',
  description: 'A game story as written in VC Game Studio: its graph, scenes and timelines, elements, dialogue, and the rules that connect them. Keys are stable snake_case identifiers; `id` fields are the studio ids, for tracing back.',
  type: 'object',
  required: ['format', 'version', 'project', 'spine', 'graph', 'scenes', 'choices', 'characters', 'objects', 'items', 'locations', 'cinematics', 'flags', 'triggers', 'lines'],
  properties: {
    $schema: str,
    format: { const: JSON_FORMAT.format },
    version: { const: JSON_FORMAT.version },
    generator: str,
    project: obj({ id: str, name: str, key: str }),
    spine: { type: 'array', items: ref('storyNode') },
    graph: { type: 'array', items: ref('graphNode') },
    branches: { type: 'array', items: obj({ from: str, to: str, label: str, when: ref('rule'), effects: ref('effects') }, ['from', 'to', 'label']) },
    subplots: { type: 'array', items: obj({ key: str, name: str, from: str, to: str, beats: { type: 'array', items: ref('storyNode') } }) },
    arcs: { type: 'array', items: obj({ character: str, name: str, events: { type: 'array', items: obj({ polarity: { enum: ['up', 'down', 'turn'] }, name: str, tiedTo: { type: ['string', 'null'] } }) } }) },
    characters: { type: 'array', items: obj({ id: str, ident, code: str, name: str, role: str, arc: str, color: str, description: str, codex: { ...str, description: 'What the codex says once the player has met them (they speak a line); empty keeps them out of it.' } }) },
    objects: { type: 'array', items: ref('object') },
    items: { type: 'array', items: ref('thing') },
    locations: { type: 'array', items: ref('thing') },
    lore: { type: 'array', items: ref('lore'), description: 'Lore entries: history and world facts, for codex or journal text; each known once `discoveredWhen` holds.' },
    quests: { type: 'array', items: ref('quest'), description: 'Quests and objectives: each starts when `starts` holds (at once without it) and is done when `completes` holds, paying `reward`.' },
    mechanics: { type: 'array', items: ref('mechanic'), description: 'Mechanics: how a system works, in the designer\'s words, and its tuning in `fields`; each usable once `availableWhen` holds.' },
    encounters: { type: 'array', items: ref('encounter'), description: 'Encounters and enemies: played by the game where an `encounter` event puts them, then won or lost.' },
    equipment: {
      type: 'array',
      description: 'Items that can be equipped: see the README.',
      items: obj({
        item: str,
        name: str,
        slot: str,
        stats: { type: 'array', items: obj({ name: str, value: num }) },
        ammo: { anyOf: [{ type: 'null' }, obj({ item: str, name: str })] },
        ammoPerUse: { type: 'integer', minimum: 1 },
        durability: { type: 'integer', minimum: 0, description: 'Uses before it breaks; 0 never breaks.' },
      }),
    },
    recipes: {
      type: 'array',
      description: 'Items that can be crafted: see the README.',
      items: obj(
        {
          item: str,
          name: str,
          makes: { type: 'integer', minimum: 1 },
          ingredients: { type: 'array', items: obj({ item: str, name: str, amount: { type: 'integer', minimum: 1 } }) },
          when: ref('rule'),
          whenText: { type: 'string', description: 'when in words, for "Needs …".' },
        },
        ['item', 'name', 'makes', 'ingredients'],
      ),
    },
    skills: { type: 'array', items: ref('skill'), description: 'Skills, abilities and upgrades (their kind, tree and use in `fields`), learned in ranks: see the README.' },
    cinematics: { type: 'array', items: ref('thing') },
    flags: { type: 'array', items: obj({ id: str, ident, name: str, values: strings, initial: str, setBy: strings, type: { enum: ['states', 'number', 'text'] }, scope: str }) },
    triggers: { type: 'array', items: ref('trigger') },
    choices: { type: 'array', items: ref('choice') },
    scenes: { type: 'array', items: ref('scene') },
    lines: { type: 'array', items: obj({ id: str, scene: str, speaker: { type: ['string', 'null'] }, text: str, direction: str, vo: { enum: ['none', 'todo', 'recorded'] }, order: num, styled: { type: 'string', description: 'The line with its emphasis, as Fountain writes it: **bold**, *italic*, _underline_. Only when it has some; text is always plain.' }, dual: { type: 'string', description: 'Dual dialogue: the id of the line this one is spoken at the same time as.' } }, ['id', 'scene', 'speaker', 'text', 'direction', 'vo', 'order']) },
    levels: { type: 'array', items: ref('level'), description: 'The Level Designer\'s levels: items with GUIDs, transforms, settings, story links and rules, and their graybox pieces.' },
    notes: {
      type: 'array',
      description: 'Open comments and tasks for the team, oldest first: what each is about, who wrote it, a task\'s role. Answer and tick them off in VC Game Studio.',
      items: obj(
        {
          kind: { enum: ['comment', 'task'] },
          text: str,
          by: str,
          for: { enum: ['writer', 'narrative', 'level', 'gameplay', 'cinematic', 'audio', 'reviewer'], description: 'A task\'s role; absent for anyone.' },
          at: { type: 'string', format: 'date-time' },
          replies: { type: 'array', items: obj({ by: str, text: str }) },
          on: obj(
            {
              kind: { enum: ['object', 'connection', 'level', 'levelItem', 'code'] },
              key: { type: 'string', description: 'A story key, a level or item guid, a branch as "from → to" keys, or a generated file\'s path.' },
              name: str,
              export_name: str,
              type: { type: 'string', description: 'A story element\'s PascalCase identifier.' },
            },
            ['kind', 'key', 'name'],
          ),
        },
        ['kind', 'text', 'by', 'at', 'replies', 'on'],
      ),
    },
  },
  $defs: {
    vec3: { type: 'array', items: num, minItems: 3, maxItems: 3, description: 'Metres, y up: x east, y up, z south.' },
    corner: { type: 'array', items: num, minItems: 2, maxItems: 2, description: 'A point on the plan [x, z], in metres.' },
    level: {
      ...obj(
        {
          guid: str,
          key: str,
          export_name: str,
          name: str,
          floors: { type: 'array', items: obj({ key: str, name: str, elevation: num, height: num }) },
          links: strings,
          start: { anyOf: [{ type: 'null' }, obj({ position: ref('vec3'), turn: num })] },
          light: { description: 'The player’s light, from the player start: the story key of the item or mechanic that lights it, its fuel in seconds (0 for ever), how far it reaches in metres.', anyOf: [{ type: 'null' }, obj({ source: str, fuel: num, range: num })] },
          items: { type: 'array', items: ref('levelItem') },
          map: ref('map'),
          travel: { type: 'array', items: ref('travel') },
          revision: str,
        },
        ['guid', 'key', 'export_name', 'name', 'floors', 'links', 'start', 'light', 'items', 'map', 'travel', 'revision'],
      ),
      description: 'A level, or any map: a world, region, district, building or interior. `revision` changes whenever anything in it does.',
    },
    map: obj(
      {
        kind: { enum: ['world', 'region', 'level', 'district', 'building', 'interior'] },
        parent: { description: 'The map it is part of (its key), or null.', anyOf: [{ type: 'null' }, str] },
        anchor: { description: 'The item on the parent it details (its guid), or null.', anyOf: [{ type: 'null' }, str] },
        boundary: { enum: ['continuous', 'streamed', 'instanced', 'transition', 'mapOnly'], description: 'How the game reaches it: always there with its parent, loaded near its anchor, its own instance, through a loading transition, or for planning only (build nothing).' },
        status: { enum: ['empty', 'grayboxed', 'detailed', 'gameplay', 'final'] },
        size: { description: 'Its extent [width, depth] in metres, or null.', anyOf: [{ type: 'null' }, ref('corner')] },
        origin: { ...ref('corner'), description: 'Where its own 0, 0 is, from its centre.' },
        grid: num,
        environment: str,
        navigation: str,
        children: {
          type: 'array',
          items: obj(
            {
              key: str,
              name: str,
              boundary: str,
              anchor: { anyOf: [{ type: 'null' }, str] },
              placement: { description: 'Where the child’s 0, 0, 0 is in this map’s space and its turn: a continuous or streamed child that details an item here. Null otherwise.', anyOf: [{ type: 'null' }, obj({ position: ref('vec3'), turn: num })] },
              size: { anyOf: [{ type: 'null' }, ref('corner')] },
              centre: { description: 'The anchor’s centre in this map’s space: the footprint is `size` around it, turned with the placement.', anyOf: [{ type: 'null' }, ref('vec3')] },
              load_margin: { ...num, description: 'A streamed child loads when the player is within this many metres of its footprint around the anchor, and unloads beyond twice it.' },
            },
            ['key', 'name', 'boundary', 'anchor', 'placement', 'size', 'centre', 'load_margin'],
          ),
        },
        placement: { description: 'Where it sits in its parent, as the parent’s `children` entry has it; null when it isn’t placed there.', anyOf: [{ type: 'null' }, obj({ position: ref('vec3'), turn: num })] },
      },
      ['kind', 'parent', 'anchor', 'boundary', 'status', 'size', 'origin', 'grid', 'environment', 'navigation', 'children', 'placement'],
    ),
    travel: obj(
      {
        guid: str,
        key: str,
        name: str,
        kind: { enum: ['road', 'trail', 'river', 'route', 'progression', 'fastTravel', 'door', 'elevator', 'portal', 'cinematic', 'loading'] },
        transition: { enum: ['walk', 'ride', 'sail', 'fade', 'cinematic', 'loading', 'instant'] },
        floor: str,
        from: { anyOf: [{ type: 'null' }, str], description: 'The item (guid) its first point is tied to.' },
        to: { anyOf: [{ type: 'null' }, str], description: 'The item (guid) its last point is tied to.' },
        to_map: { anyOf: [{ type: 'null' }, str], description: 'The map (key) it takes the player to.' },
        points: { type: 'array', items: ref('vec3'), minItems: 2 },
        length: num,
        one_way: { type: 'boolean' },
        locked: { type: 'boolean' },
        unlock_when: ref('rule'),
      },
      ['guid', 'key', 'name', 'kind', 'transition', 'floor', 'from', 'to', 'to_map', 'points', 'length', 'one_way', 'locked'],
    ),
    levelItem: {
      ...obj(
        {
          guid: { description: 'Never changes: find the item again by it on the next export.', ...str },
          export_name: str,
          name: str,
          asset: str,
          kind: { enum: ['space', 'hosted', 'solid', 'light', 'volume', 'marker', 'assembly'] },
          role: str,
          category: str,
          floor: str,
          position: ref('vec3'),
          turn: { description: 'Degrees about y, counter-clockwise seen from above.', ...num },
          size: { ...ref('vec3'), description: 'Width (x), height (y), depth (z), in metres.' },
          params: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
          links: strings,
          scenes: strings,
          host: { ...obj({ guid: str, wall: num }), description: 'A door or window’s space and wall: 0–3 north, east, south, west, or an outlined space’s wall n (corner n to the next).' },
          outline: { type: 'array', items: ref('corner'), minItems: 3, description: 'A freeform space’s corners around its position, in its own frame, clockwise seen from above.' },
          active_when: ref('rule'),
          rules: { type: 'array', items: ref('levelRule') },
          engine: obj({ godot: str, unity: str, unreal: str, template: str }),
          final_asset: str,
          replacement_locked: { type: 'boolean' },
          pieces: { type: 'array', items: ref('piece') },
          motion: {
            description: 'How it moves in play: a patrol walked round its stops in order (straight from stop to stop, waiting `wait` seconds at each), or a companion keeping within `distance` of the player (catching up at once when more than 12 m behind or 3 m above or below). Speeds in metres a second.',
            oneOf: [
              obj({ kind: { const: 'patrol' }, name: str, speed: num, stops: { type: 'array', minItems: 1, items: obj({ guid: str, at: ref('vec3'), wait: num }) } }),
              obj({ kind: { const: 'follow' }, speed: num, distance: num }),
            ],
          },
          in_dark: { ...strings, description: 'The darkness zones (by GUID) it is in: while any is in the level and the player’s light is off, it is too dark to use.' },
          puzzles: {
            type: 'array',
            description: 'The parts it plays in puzzles, as bound in the studio. Informational: what they do in play is already in `active_when`, `links` and `rules`.',
            items: obj({ puzzle: str, role: { enum: ['entry', 'required', 'clue', 'gate', 'output'] }, node: str }, ['puzzle', 'role']),
          },
          opens: { ...str, description: 'The map (key) it opens into.' },
          revision: str,
        },
        ['guid', 'export_name', 'name', 'asset', 'kind', 'role', 'category', 'floor', 'position', 'turn', 'size', 'params', 'links', 'scenes', 'rules', 'engine', 'final_asset', 'replacement_locked', 'pieces', 'revision'],
      ),
      description: 'One placed item. It is in the level only while `active_when` holds.',
    },
    piece: obj(
      {
        part: str,
        shape: { enum: ['box', 'cylinder', 'sphere', 'wedge', 'cone', 'slab'] },
        at: { ...ref('vec3'), description: 'Centre, relative to the item (turned with it).' },
        size: ref('vec3'),
        turn: num,
        color: str,
        opacity: num,
        collide: { type: 'boolean' },
        light: obj({ kind: { enum: ['point', 'spot', 'area'] }, color: str, intensity: num, range: num, angle: num }, ['kind', 'color', 'intensity', 'range']),
        outline: { type: 'array', items: ref('corner'), minItems: 3, description: 'A slab’s corners around its centre, in its own frame, clockwise seen from above. Raise them to size[1].' },
        triangles: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'A slab’s top as triangles: three outline indices each, clockwise seen from above.' },
      },
      ['part', 'shape', 'at', 'size', 'turn', 'color', 'opacity', 'collide'],
    ),
    levelRule: obj(
      {
        on: { enum: ['enter', 'exit', 'interact', 'pickup', 'use', 'destroy', 'timer', 'stateChange', 'custom'] },
        detail: str,
        when: ref('rule'),
        effects: ref('effects'),
        actions: { type: 'array', items: obj({ kind: { enum: ['open', 'close', 'enable', 'disable', 'spawn', 'despawn', 'startScene', 'playCinematic', 'playAudio', 'objective', 'goToLevel', 'refuel'] }, target: str }) },
      },
      ['on'],
    ),
    condition: {
      type: 'object',
      required: ['kind', 'ref', 'op'],
      properties: {
        kind: { enum: ['flag', 'item', 'object', 'choice', 'arc', 'puzzle', 'visited', 'quest', 'lore', 'mechanic', 'skill', 'equipped', 'stat', 'number', 'reputation'] },
        ref: { description: 'The key of the flag, item, object, choice, character, puzzle or scene it is about (for a stat condition, the stat\'s name).', ...str },
        op: { enum: ['is', 'isNot', 'has', 'hasNot', 'chose', 'didNotChoose', 'atLeast', 'atMost', 'solved', 'unsolved', 'visited', 'notVisited', 'done', 'notDone', 'active', 'notStarted', 'known', 'unknown', 'available', 'unavailable', 'below', 'equipped', 'notEquipped'] },
        value: { type: ['string', 'number'] },
      },
    },
    rule: {
      description: 'Holds when all (or any) of its items hold; an empty rule always holds.',
      type: 'object',
      required: ['match', 'items'],
      properties: { match: { enum: ['all', 'any'] }, items: { type: 'array', items: { anyOf: [ref('condition'), ref('rule')] } } },
    },
    effect: {
      type: 'object',
      required: ['kind', 'ref'],
      properties: { kind: { enum: ['setFlag', 'give', 'take', 'setObject', 'arc', 'solve', 'fire', 'startQuest', 'revealLore', 'completeQuest', 'enableMechanic', 'learnSkill', 'equip', 'unequip', 'addNumber', 'setNumber', 'reputation'] }, ref: str, value: str, amount: num },
    },
    effects: { type: 'array', items: ref('effect') },
    storyNode: obj({ key: str, kind: str, name: str }),
    graphNode: {
      ...obj({ key: str, kind: str, name: str, onward: { type: ['string', 'null'] }, routes: { type: 'array', items: obj({ to: str, label: str, when: ref('rule'), effects: ref('effects') }, ['to', 'label']) }, outcome: { enum: ['ending', 'gameOver'] } }, ['key', 'kind', 'name', 'onward', 'routes']),
      description: 'A node on the story graph. Where it goes: the first route whose conditions hold, else onward along the spine.',
    },
    lore: { allOf: [ref('thing'), obj({ byEffect: { const: true }, discoveredWhen: ref('rule') }, [])], description: 'A lore entry: known once `discoveredWhen` holds, from the start when there is none.' },
    mechanic: { allOf: [ref('thing'), obj({ byEffect: { const: true }, availableWhen: ref('rule') }, [])], description: 'A mechanic: usable once `availableWhen` holds, from the start when there is none.' },
    quest: {
      allOf: [ref('thing'), obj({ byEffect: { const: true }, starts: ref('rule'), completes: ref('rule'), reward: ref('effects') }, [])],
      description: 'A quest: under way once `starts` holds (at once when there is none), done when `completes` holds (never without it), then its `reward` effects are done.',
    },
    skill: {
      allOf: [
        ref('thing'),
        obj(
          {
            ranks: { type: 'integer', minimum: 1 },
            cost: { anyOf: [{ type: 'null' }, obj({ item: str, name: str, amount: { type: 'integer', minimum: 1 } })], description: 'What a rank costs: so many of an inventory item.' },
            requires: { ...strings, description: 'Skills to learn (rank 1) before its first rank.' },
            learnWhen: ref('rule'),
            learnWhenText: { type: 'string', description: 'learnWhen in words, for "Needs …".' },
            onLearn: { type: 'array', items: ref('effect'), description: 'What each rank learned does.' },
          },
          ['ranks', 'cost', 'requires'],
        ),
      ],
      description: 'A skill, ability or upgrade, learned rank by rank up to `ranks`.',
    },
    encounter: {
      allOf: [ref('thing'), obj({ winWhen: ref('rule'), onWin: ref('effects'), onLose: ref('effects'), loss: { enum: ['retry', 'gameOver', 'carryOn'] } }, ['loss'])],
      description: 'An encounter: a win counts only when `winWhen` holds; a win does `onWin`, a loss does `onLose` and then plays it again (retry), ends the game (gameOver) or goes on through the scene (carryOn).',
    },
    thing: obj({ id: str, ident, code: str, name: str, type: str, notes: str, fields: { type: 'object', additionalProperties: str }, shots: { type: 'array', items: ref('shot') } }, ['id', 'ident', 'code', 'name', 'type', 'notes', 'fields']),
    shot: obj({ framing: str, move: str, lens: str, characters: strings, action: str, line: str, audio: str, vfx: str, seconds: num, transition: str, notes: str }, ['framing', 'move', 'seconds', 'transition']),
    interaction: obj({ verb: str, when: str, becomes: str, sets: obj({ flag: str, value: str }), fires: str, requires: ref('rule'), effects: ref('effects'), screen: { const: true, description: 'It opens the object\'s screen puzzle: what it does happens once that is solved.' } }, ['verb']),
    step: {
      ...obj(
        {
          id: str,
          parent: { type: ['string', 'null'] },
          kind: { enum: ['goal', 'requirement', 'interaction'] },
          label: str,
          gate: { enum: ['all', 'any', 'sequence'] },
          within: num,
          requires: strings,
          when: ref('rule'),
          effects: ref('effects'),
          optional: { type: 'boolean' },
          fail: obj({ when: ref('rule'), effects: ref('effects'), forward: { type: 'boolean' } }, []),
        },
        ['id', 'parent', 'kind', 'label'],
      ),
      description: 'A puzzle step: a sub-goal (all, any, or all in order; within seconds of its first step), or a requirement or interaction done when `when` holds and the steps it requires are done. Done stays done. `effects` happen the first time; a wrong move (`fail.when` coming true) does `fail.effects`, and counts as done when `fail.forward`.',
    },
    design: {
      ...obj(
        {
          progress: { type: 'boolean' },
          reset: { enum: ['never', 'onFail', 'onLeave', 'byHand'] },
          entry: ref('rule'),
          steps: { type: 'array', items: ref('step') },
          hints: { type: 'array', items: obj({ id: str, text: str, afterFails: num, when: ref('rule') }, ['id', 'text']) },
          cues: { type: 'array', items: obj({ kind: { enum: ['animation', 'audio', 'vfx', 'message', 'dialogue', 'cinematic'] }, text: str, ref: str }, ['kind', 'text']) },
          elements: strings,
        },
        ['progress', 'reset', 'steps', 'hints', 'cues', 'elements'],
      ),
      description: 'A puzzle built in the Puzzle Creator. With `progress`, the runtime keeps its steps (see the README); without, `solvedWhen` alone solves it. Hints are given once each, after `afterFails` wrong moves and once `when` holds; cues play when it is solved.',
    },
    screen: {
      type: 'object',
      required: ['kind', 'prompt', 'feedback'],
      properties: {
        kind: { enum: ['keypad', 'dial', 'tiles', 'symbols', 'rings', 'circuit', 'assembly', 'matching', 'ordering', 'levers', 'custom'] },
        prompt: str,
        feedback: obj({ correct: str, wrong: str }, ['correct', 'wrong']),
        attempts: num,
        onWrong: ref('effects'),
      },
      description: 'A screen puzzle on an object: the parts and answer of its kind (code and keys; positions and combination; size; symbols and answer; rings, segments, start and linked; width, height, cells, source and sink; parts and slots; pairs; items; switches, links, startOn and target; text). Solved, its interaction (marked `screen`) does what it does.',
    },
    object: obj(
      { id: str, ident, code: str, name: str, kind: { enum: ['object', 'puzzle'] }, states: strings, initial: str, interactions: { type: 'array', items: ref('interaction') }, notes: str, fields: { type: 'object' }, solvedWhen: ref('rule'), effects: ref('effects'), design: ref('design'), screen: ref('screen') },
      ['id', 'ident', 'code', 'name', 'kind', 'states', 'interactions', 'notes', 'fields'],
    ),
    trigger: obj({ id: str, ident, name: str, kind: { enum: ['trigger', 'gate'] }, condition: str, effect: str, sets: obj({ flag: str, value: str }), rule: ref('rule'), effects: ref('effects') }, ['id', 'ident', 'name', 'kind', 'condition', 'effect']),
    option: obj({ key: str, label: str, to: { type: ['string', 'null'] }, when: ref('rule'), effects: ref('effects'), after: { enum: ['gone', 'locked'] }, hide: { type: 'boolean' } }, ['key', 'label', 'to']),
    choice: obj({ id: str, ident, code: str, name: str, prompt: str, scene: { type: ['string', 'null'] }, options: { type: 'array', items: ref('option') }, available: ref('rule') }, ['id', 'ident', 'code', 'name', 'prompt', 'scene', 'options']),
    event: {
      ...obj(
        {
          kind: { enum: ['cinematic', 'dialogue', 'action', 'interaction', 'trigger', 'choice', 'freePlay', 'encounter'] },
          ref: str,
          line: str,
          dual: { type: 'string', description: 'Dual dialogue: the line this one is spoken at the same time as. When the next event is that line (or names this one), the two play as one beat.' },
          label: str,
          seconds: num,
          shots: num,
          endsWhen: str,
          condition: str,
          mainLabel: str,
          mainAfter: { enum: ['gone', 'locked'] },
          when: ref('rule'),
          ends: ref('rule'),
          effects: ref('effects'),
          place: { ...str, description: 'The level item (its guid in `levels`) where it happens.' },
          placeTo: { ...str, description: 'Where an actor moves to: a level item guid.' },
        },
        ['kind', 'label'],
      ),
      description: 'One step of a scene. Skipped when `when` fails; a free play waits until `ends` holds; a choice offers its main option and each branch that leaves from it.',
    },
    scene: obj(
      {
        id: str,
        ident,
        code: str,
        name: str,
        slug: str,
        summary: str,
        contents: { type: 'object', additionalProperties: strings },
        location: { type: ['string', 'null'], description: 'The key of the location it is set in (one of `locations`); playing the scene visits it.' },
        main: { type: 'array', items: ref('event') },
        branches: { type: 'array', items: obj({ label: str, from: num, events: { type: 'array', items: ref('event') }, rejoin: { type: ['number', 'null'] }, when: ref('rule'), effects: ref('effects'), after: { enum: ['gone', 'locked'] }, hide: { type: 'boolean' } }, ['label', 'from', 'events', 'rejoin']) },
        next: { type: ['string', 'null'] },
        exits: { type: 'array', items: obj({ to: str, label: str, when: ref('rule'), effects: ref('effects') }, ['to', 'label']) },
        onward: { type: ['string', 'null'] },
      },
      ['id', 'ident', 'code', 'name', 'slug', 'summary', 'contents', 'main', 'branches', 'next', 'exits', 'onward'],
    ),
  },
});

const README = (ir: HandoffIR) => `# ${ir.project.name}: story handoff

Generated by VC Game Studio. Everything in this folder is rewritten on each
export: change the story in the studio, not these files.

- \`story.json\`: the whole story as data (validate it with \`story.schema.json\`).
- \`story.schema.json\`: JSON Schema (2020-12) for it.

\`lore\`, \`quests\`, \`mechanics\` and \`encounters\` are design definitions
(a name, code, description and any other fields as \`fields\`) for the game to
read, such as codex text, a quest log or tuning. All four also play, as below.

## Playing it

1. **Start** at the \`graph\` node whose \`kind\` is \`begin\`.
2. **At a node**, go to its first \`route\` whose \`when\` holds (doing its
   \`effects\`), else \`onward\`. A node with an \`outcome\` ends the story there.
3. **A scene** plays its \`main\` events in order. An event whose \`when\` fails
   is skipped. A \`freePlay\` waits until \`ends\` holds. A \`choice\` offers its
   \`mainLabel\` and each branch with \`from\` equal to its index; a branch plays
   its own \`events\` and then goes back to main at \`rejoin\` (or leaves the scene
   when \`rejoin\` is null). When the scene ends, take the first \`exits\` whose
   \`when\` holds, else \`onward\`.
4. **A choice node** offers its \`options\`; a choice is not offered at all unless
   \`available\` holds. An option with \`after: "gone"\` disappears once picked,
   \`"locked"\` stays but can't be picked again, and \`hide: true\` hides it until
   its \`when\` holds.
5. **After every change** to the world, fire each trigger whose \`rule\` holds
   (once), and solve each puzzle whose \`solvedWhen\` holds, doing their effects.
   Start each quest not yet started whose \`starts\` holds (at once when it has
   none), and complete each quest under way whose \`completes\` holds, doing its
   \`reward\`. Mark each lore entry known once its \`discoveredWhen\` holds, and
   each mechanic usable once its \`availableWhen\` holds (at once when either has
   none). One with \`byEffect: true\` waits for an effect instead
   (\`startQuest\`, \`revealLore\`, \`enableMechanic\`): a codex shows the lore known, and a system switches on with its
   mechanic. Do this once when a new game begins too.

   **A puzzle with a \`design\` and \`progress: true\`** is solved by its steps,
   not \`solvedWhen\`. Keep, per puzzle: the steps done (and the order), the
   wrong moves made, when each timed sub-goal began, a count of wrong moves, and
   which steps were undone while their condition held. After every change:
   first, a sub-goal with \`within\` whose first step was done more than that
   many seconds ago (on your play clock) loses what is done under it. Then, until
   nothing more changes: a requirement or interaction whose \`fail.when\` has just
   come true (it was false last time) is a wrong move — do \`fail.effects\`; with
   \`fail.forward\` it counts as done, else it counts one wrong move and, when the
   puzzle's \`reset\` is \`onFail\`, everything done is undone. A step is open when
   the steps in its \`requires\` are done, in a \`sequence\` sub-goal the
   (non-optional) step before it is done, and its sub-goal is open. An open
   requirement or interaction is done when \`when\` holds (one undone while it held
   must stop holding first); a sub-goal when all (or, with \`gate: "any"\`, any)
   of its non-optional steps are. Done stays done; a step's \`effects\` happen the
   first time. The puzzle is solved when all its top-level non-optional steps
   are. Hints are given once each, while the puzzle is unsolved and \`entry\` holds,
   after \`afterFails\` wrong moves (its own, plus wrong answers at its
   \`elements\`' screens) and once \`when\` holds. When it is solved, play its
   \`cues\`.

   **An object with a \`screen\`**: the interaction marked \`screen: true\` shows the
   screen puzzle instead of doing anything. A right answer (the \`code\`, the
   \`combination\`, the \`answer\` symbols, the \`items\` in order, each pair's
   \`right\` in order, each slot's \`accepts\`, the \`target\` switches, every ring
   turned to 0, the tiles in order, or the circuit joined from \`source\` to
   \`sink\`) does what that interaction does; a wrong one shows
   \`feedback.wrong\`, does \`onWrong\` and counts toward the puzzle's hints. After
   \`attempts\` wrong answers (when it has them) it takes no more.
6. **An \`encounter\` event** is a fight, chase or the like for your game to play;
   its \`ref\` is a key in \`encounters\`. A win counts only when \`winWhen\` holds;
   it does \`onWin\` and the scene goes on. A loss does \`onLose\`, then plays the
   encounter again (\`loss: "retry"\`), ends the game (\`"gameOver"\`), or goes on
   (\`"carryOn"\`).
7. **Skills** (\`skills\`) are learned when the player chooses, a rank at a time
   up to \`ranks\`. Keep each one's rank (0 to start). A rank can be learned when
   it is below \`ranks\`, every skill in \`requires\` is at rank 1 or more,
   \`learnWhen\` holds, and the player carries \`cost.amount\` of \`cost.item\`.
   Learning it takes the cost, adds the rank and does \`onLearn\`; a
   \`learnSkill\` effect adds a rank without the cost or the checks (still only
   up to \`ranks\`). Keep the ranks in a save.
8. **Equipment** (\`equipment\`, by item key) goes in its \`slot\`, one item a
   slot, when the player carries it (equipping puts back what was there).
   Equipped items' \`stats\` add up by name. A use needs the item equipped and
   \`ammoPerUse\` of \`ammo.item\` carried, and spends them; after \`durability\`
   uses (0: never) it breaks: one is taken, and a new one starts unworn. An item
   no longer carried comes out of its slot. Keep \`equipped\` (slot to item) and
   \`wear\` (uses so far) in a save.
9. **Crafting** (\`recipes\`, by item key): an item can be crafted when \`when\`
   holds and the player carries \`amount\` of each ingredient. Crafting takes
   them and gives \`makes\` of the item.

## Rules and effects

A rule is \`{ match: "all" | "any", items: [...] }\` of conditions and nested
rules; an empty rule holds. A condition is \`{ kind, ref, op, value? }\`:

| kind | ref | op | value |
| --- | --- | --- | --- |
| flag | a flag key | is, isNot | one of its values |
| item | an item key | has, hasNot | |
| object | an object key | is, isNot | one of its states |
| choice | a choice key | chose, didNotChoose | an option label, or none for any |
| arc | a character key | atLeast, atMost | a number |
| puzzle | a puzzle key | solved, unsolved | |
| visited | a scene key | visited, notVisited | |
| skill | a skill key | atLeast, below | a rank (1 is learned) |
| equipped | an item key | equipped, notEquipped | |
| stat | a stat's name (Damage) | atLeast, below | a number: the equipped items' stats added up |

An effect is \`{ kind, ref, value?, amount? }\`: \`setFlag\` (value), \`give\`,
\`take\`, \`setObject\` (value), \`arc\` (amount), \`solve\`, \`fire\`, \`learnSkill\`, \`equip\`, \`unequip\`.
${ir.levels.length ? LEVELS_README : ''}`;

const LEVELS_README = `
## Levels

\`levels\` holds each level: its \`items\`, each with a \`guid\` that never
changes (find what you placed last time by it), an \`export_name\`, a
\`position\` and \`turn\` (metres, y up, z south; degrees counter-clockwise from
above), a \`size\`, its settings in \`params\` (story references as story keys)
and its graybox \`pieces\` relative to it. Build the pieces as you like; those
with \`collide\` are in the player's way. A \`slab\` piece is a freeform floor or
ceiling: its \`outline\` corners raised to \`size[1]\`, with \`triangles\` for its
top. A freeform space or volume also has its \`outline\`; a volume is in the
level wherever that outline is, up to its height. A door's \`host.wall\` counts
its walls from corner 0.

1. An item is in the level only while \`active_when\` holds.
2. **Interact**: a \`door\` opens and shuts; a locked one (\`params.locked\`) needs
   \`params.keyItem\` held and then stays unlocked. A pickup (\`pickup\`,
   \`inventory\`, …) leaves the level and gives \`params.item\`. A character
   starts its first linked scene (\`scenes\`).
3. **Volumes** notice the player: \`enter\` and \`exit\` rules run;
   \`params.once\` makes it once only; a \`cinematic\` volume plays
   \`params.cinematic\`; a \`checkpoint\` is where the player comes back; a
   \`portal\` leads to the level \`params.to\`.
4. **Rules** (\`rules\`) run on their \`on\` event when \`when\` holds: do their
   story \`effects\` (as above), then their \`actions\` on the level (\`target\` is
   an item's guid, a scene or cinematic key, or a level key).
5. After every change to the story, run each present item's \`stateChange\` rules
   and look again at what is present.

### Maps and travel

Every map is a level here: a world, region, district, building or interior
as much as a level (\`map.kind\`). \`map.parent\` is the map it is part of and
\`map.children\` the maps inside it. A child's \`boundary\` says how the game
reaches it:

- \`continuous\`: built with its parent, at \`placement\` (its 0, 0, 0 in the
  parent's space, turned by \`turn\`), when it has one;
- \`streamed\`: loaded at \`placement\` while the player is within \`load_margin\`
  metres of its footprint (\`size\`, centred on the anchor), unloaded beyond
  twice that;
- \`instanced\` and \`transition\`: a map of its own, gone to by a travel link
  (\`to_map\`), a portal or a \`goToLevel\` action;
- \`mapOnly\`: planning only; build nothing.

\`travel\` holds each map's roads, trails, rivers, routes and transitions: its
\`points\`, the items its ends are tied to, the map it leads to, one way or
both. A \`locked\` link can be taken only while \`unlock_when\` holds (never,
without one). An item's \`opens\` is the map it is detailed in; its \`puzzles\`
the parts it plays in puzzles.
`;

const generateJson = (ir: HandoffIR, outputPath: string): EngineOutput => {
  const root = outputPath.replace(/\/+$/, '') || 'vcgs';
  const story = { $schema: './story.schema.json', ...JSON_FORMAT, generator: 'VC Game Studio', ...ir };
  const files: GeneratedFile[] = [
    { path: `${root}/story.json`, content: `${JSON.stringify(story, null, 2)}\n`, kind: 'generated' },
    { path: `${root}/story.schema.json`, content: `${JSON.stringify(storySchema(), null, 2)}\n`, kind: 'runtime' },
    { path: `${root}/README.md`, content: README(ir), kind: 'generated' },
    { path: `${root}/TASKS.md`, content: tasksMarkdown(ir, 'engine', (n) => (n.on.kind === 'levelItem' || n.on.kind === 'level' ? `${n.on.export_name} (${n.on.key})` : n.on.key)), kind: 'generated' },
  ];
  const storyPath = `${root}/story.json`;
  const elements: ElementOutput[] = [];
  const row = (e: Omit<ElementOutput, 'fingerprint' | 'files'>, data: unknown) =>
    elements.push({ ...e, files: [storyPath], fingerprint: fingerprint(`${VERSION}:${JSON.stringify(data)}`) });
  row({ id: 'story', label: 'Story graph', symbol: 'plotPoint', group: 'Story', generates: `graph (${ir.graph.length} nodes) · spine · subplots · arcs` }, { graph: ir.graph, spine: ir.spine, subplots: ir.subplots, arcs: ir.arcs });
  for (const s of ir.scenes) row({ id: s.id, label: `${s.code} ${s.name}`.trim(), symbol: 'scene', group: 'Story', generates: `scenes[] · ${s.main.length} events` }, s);
  for (const c of ir.cinematics) row({ id: c.id, label: `${c.code} ${c.name}`.trim(), symbol: 'cinematic', group: 'Story', generates: `cinematics[]${c.shots ? ` · ${c.shots.length} shots` : ''}` }, c);
  for (const c of ir.choices) row({ id: c.id, label: `${c.code} ${c.name}`.trim(), symbol: 'choice', group: 'Story', generates: `choices[] · ${c.options.length} options` }, c);
  for (const c of ir.characters) row({ id: c.id, label: c.name, symbol: 'character', group: 'People + words', generates: 'characters[]' }, c);
  row({ id: 'dialogue', label: `Dialogue (${ir.lines.length} lines)`, symbol: 'dialogue', group: 'People + words', generates: 'lines[]' }, ir.lines);
  for (const o of ir.objects) row({ id: o.id, label: o.name, symbol: o.kind, group: 'World', generates: o.kind === 'puzzle' ? 'objects[] · puzzle' : `objects[] · ${o.interactions.length} interactions` }, o);
  for (const t of ir.items) row({ id: t.id, label: t.name, symbol: 'inventory', group: 'World', generates: 'items[]' }, t);
  for (const t of ir.locations) row({ id: t.id, label: t.name, symbol: 'environment', group: 'World', generates: 'locations[]' }, t);
  for (const d of DESIGN_LISTS) for (const t of ir[d.list]) row({ id: t.id, label: `${t.code} ${t.name}`.trim(), symbol: d.type, group: d.group, generates: `${d.list}[]` }, t);
  for (const f of ir.flags) row({ id: f.id, label: f.name, symbol: 'state', group: 'Logic', generates: `flags[] · ${f.type === 'states' ? f.values.join(' / ') : f.type}` }, f);
  for (const t of ir.triggers) row({ id: t.id, label: t.name, symbol: t.kind, group: 'Logic', generates: t.rule ? 'triggers[] · by rule' : 'triggers[]' }, t);
  for (const l of ir.levels) row({ id: l.guid, label: l.name, symbol: 'environment', group: 'World', generates: `levels[] · ${l.items.length} items (${l.export_name})` }, l);
  elements.push({ id: 'tasks', label: `Comments and tasks (${ir.notes.length})`, symbol: 'plotPoint', group: 'Story', generates: 'notes[] · TASKS.md', files: [storyPath, `${root}/TASKS.md`], fingerprint: fingerprint(`${VERSION}:${JSON.stringify(ir.notes)}`) });
  return { files, elements };
};

export const json: EngineAdapter = {
  id: 'custom',
  name: 'Any engine (JSON)',
  language: 'JSON + schema',
  available: true,
  defaultOutputPath: 'vcgs',
  runtimeName: 'JSON Schema 2020-12',
  setup: ['Read story.json from your engine (story.schema.json describes it; the README says how to play it).'],
  generate: generateJson,
};
