import type { EngineAdapter, ElementOutput, EngineOutput, GeneratedFile } from './engines';
import { fingerprint } from './engines';
import type { HandoffIR } from './ir';

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
    characters: { type: 'array', items: obj({ id: str, ident, code: str, name: str, role: str, arc: str, color: str, description: str }) },
    objects: { type: 'array', items: ref('object') },
    items: { type: 'array', items: ref('thing') },
    locations: { type: 'array', items: ref('thing') },
    cinematics: { type: 'array', items: ref('thing') },
    flags: { type: 'array', items: obj({ id: str, ident, name: str, values: strings, initial: str, setBy: strings }) },
    triggers: { type: 'array', items: ref('trigger') },
    choices: { type: 'array', items: ref('choice') },
    scenes: { type: 'array', items: ref('scene') },
    lines: { type: 'array', items: obj({ id: str, scene: str, speaker: { type: ['string', 'null'] }, text: str, direction: str, vo: { enum: ['none', 'todo', 'recorded'] }, order: num }) },
  },
  $defs: {
    condition: {
      type: 'object',
      required: ['kind', 'ref', 'op'],
      properties: {
        kind: { enum: ['flag', 'item', 'object', 'choice', 'arc', 'puzzle', 'visited'] },
        ref: { description: 'The key of the flag, item, object, choice, character, puzzle or scene it is about.', ...str },
        op: { enum: ['is', 'isNot', 'has', 'hasNot', 'chose', 'didNotChoose', 'atLeast', 'atMost', 'solved', 'unsolved', 'visited', 'notVisited'] },
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
      properties: { kind: { enum: ['setFlag', 'give', 'take', 'setObject', 'arc', 'solve', 'fire'] }, ref: str, value: str, amount: num },
    },
    effects: { type: 'array', items: ref('effect') },
    storyNode: obj({ key: str, kind: str, name: str }),
    graphNode: {
      ...obj({ key: str, kind: str, name: str, onward: { type: ['string', 'null'] }, routes: { type: 'array', items: obj({ to: str, label: str, when: ref('rule'), effects: ref('effects') }, ['to', 'label']) }, outcome: { enum: ['ending', 'gameOver'] } }, ['key', 'kind', 'name', 'onward', 'routes']),
      description: 'A node on the story graph. Where it goes: the first route whose conditions hold, else onward along the spine.',
    },
    thing: obj({ id: str, ident, code: str, name: str, type: str, notes: str, fields: { type: 'object', additionalProperties: str }, shots: { type: 'array', items: ref('shot') } }, ['id', 'ident', 'code', 'name', 'type', 'notes', 'fields']),
    shot: obj({ framing: str, move: str, lens: str, characters: strings, action: str, line: str, audio: str, vfx: str, seconds: num, transition: str, notes: str }, ['framing', 'move', 'seconds', 'transition']),
    interaction: obj({ verb: str, when: str, becomes: str, sets: obj({ flag: str, value: str }), fires: str, requires: ref('rule'), effects: ref('effects') }, ['verb']),
    object: obj(
      { id: str, ident, code: str, name: str, kind: { enum: ['object', 'puzzle'] }, states: strings, initial: str, interactions: { type: 'array', items: ref('interaction') }, notes: str, fields: { type: 'object' }, solvedWhen: ref('rule'), effects: ref('effects') },
      ['id', 'ident', 'code', 'name', 'kind', 'states', 'interactions', 'notes', 'fields'],
    ),
    trigger: obj({ id: str, ident, name: str, kind: { enum: ['trigger', 'gate'] }, condition: str, effect: str, sets: obj({ flag: str, value: str }), rule: ref('rule'), effects: ref('effects') }, ['id', 'ident', 'name', 'kind', 'condition', 'effect']),
    option: obj({ key: str, label: str, to: { type: ['string', 'null'] }, when: ref('rule'), effects: ref('effects'), after: { enum: ['gone', 'locked'] }, hide: { type: 'boolean' } }, ['key', 'label', 'to']),
    choice: obj({ id: str, ident, code: str, name: str, prompt: str, scene: { type: ['string', 'null'] }, options: { type: 'array', items: ref('option') }, available: ref('rule') }, ['id', 'ident', 'code', 'name', 'prompt', 'scene', 'options']),
    event: {
      ...obj(
        {
          kind: { enum: ['cinematic', 'dialogue', 'action', 'interaction', 'trigger', 'choice', 'freePlay'] },
          ref: str,
          line: str,
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

An effect is \`{ kind, ref, value?, amount? }\`: \`setFlag\` (value), \`give\`,
\`take\`, \`setObject\` (value), \`arc\` (amount), \`solve\`, \`fire\`.
`;

const generateJson = (ir: HandoffIR, outputPath: string): EngineOutput => {
  const root = outputPath.replace(/\/+$/, '') || 'vcgs';
  const story = { $schema: './story.schema.json', ...JSON_FORMAT, generator: 'VC Game Studio', ...ir };
  const files: GeneratedFile[] = [
    { path: `${root}/story.json`, content: `${JSON.stringify(story, null, 2)}\n`, kind: 'generated' },
    { path: `${root}/story.schema.json`, content: `${JSON.stringify(storySchema(), null, 2)}\n`, kind: 'runtime' },
    { path: `${root}/README.md`, content: README(ir), kind: 'generated' },
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
  for (const f of ir.flags) row({ id: f.id, label: f.name, symbol: 'state', group: 'Logic', generates: `flags[] · ${f.values.join(' / ')}` }, f);
  for (const t of ir.triggers) row({ id: t.id, label: t.name, symbol: t.kind, group: 'Logic', generates: t.rule ? 'triggers[] · by rule' : 'triggers[]' }, t);
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
