import { ENTRY_CODE, makeObject, newId, nextCode } from '../project';
import type { ObjectType, Project } from '../types';
import { createPuzzle, setTree, type PuzzleScale } from './design';
import { elementsOf, kindSpec, type ElementKind } from './elements';
import { nodesOf, type PuzzleNode } from './tree';

/**
 * Puzzle templates (puzzle spec §9, §15): a puzzle's design kept for reuse —
 * its definition, its steps and the elements they need, its clues, hints and
 * cues — with the elements as blueprints (a key each) rather than the
 * project's own. A new puzzle from one makes fresh elements in the Bible.
 * Personal templates are kept on this computer (see template-library.ts);
 * a few come built in.
 */

export interface TemplateElement {
  key: string;
  type: ObjectType;
  name: string;
  notes?: string;
  data: Record<string, unknown>;
}

export interface PuzzleTemplate {
  id: string;
  name: string;
  description: string;
  scale: PuzzleScale;
  builtIn?: boolean;
  /** The puzzle's data, with element ids as their keys and its own id as SELF. */
  data: Record<string, unknown>;
  elements: TemplateElement[];
  created: string;
}

const SELF = '$self';

/** Every string in it, swapped by the map (a string not in it stays, or goes blank if `drop` says so). */
const swap = (x: unknown, map: Map<string, string>, drop?: (s: string) => boolean): unknown => {
  if (typeof x === 'string') return map.get(x) ?? (drop?.(x) ? '' : x);
  if (Array.isArray(x)) return x.map((y) => swap(y, map, drop));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, swap(v, map, drop)]));
  return x;
};

/** Conditions and effects in lists that named something left out go (a step's own condition stays, blank, for validation to point at). */
const prune = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.filter((y) => !(y && typeof y === 'object' && (y as { ref?: unknown }).ref === '')).map(prune);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, prune(v)]));
  return x;
};

/** Fresh ids for the interactions, hints and cues inside it, so two puzzles from one template don't share them. */
const freshIds = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(freshIds);
  if (x && typeof x === 'object') {
    const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, freshIds(v)])) as Record<string, unknown>;
    const m = typeof o.id === 'string' ? /^(act|hint|cue)_/.exec(o.id) : null;
    if (m) o.id = newId(m[1]!);
    return o;
  }
  return x;
};

/**
 * A template from a puzzle: its design and its elements. Anything outside
 * the puzzle it names (a scene, a character) is left blank, and counted, so
 * the template stands on its own.
 */
export const templateFrom = (project: Project, puzzleId: string, name: string, description = ''): { template: PuzzleTemplate; blanked: number } => {
  const puzzle = project.objects[puzzleId]!;
  const elements = elementsOf(project, puzzleId);
  const map = new Map<string, string>([[puzzleId, SELF]]);
  elements.forEach((e, i) => map.set(e.id, `el${i + 1}`));
  let blanked = 0;
  const outside = (s: string) => {
    const hit = !!project.objects[s];
    if (hit) blanked++;
    return hit;
  };
  const { code: _code, rule: _rule, elements: _list, ...rest } = puzzle.data as Record<string, unknown>;
  const data = prune(swap(rest, map, outside)) as Record<string, unknown>;
  const els: TemplateElement[] = elements.map((e) => {
    const { code: _c, ...d } = e.data as Record<string, unknown>;
    return { key: map.get(e.id)!, type: e.type, name: e.name, ...(e.notes ? { notes: e.notes } : {}), data: prune(swap(d, map, outside)) as Record<string, unknown> };
  });
  return {
    template: { id: newId('tpl'), name: name.trim() || puzzle.name, description: description.trim(), scale: (puzzle.data.scale as PuzzleScale) ?? 'area', data, elements: els, created: new Date().toISOString() },
    blanked,
  };
};

/** A new puzzle from a template: fresh elements in the Bible, fresh steps, its rule compiled. */
export const puzzleFromTemplate = (project: Project, template: PuzzleTemplate, name?: string): { project: Project; id: string } => {
  const made = createPuzzle(project, name?.trim() || template.name, template.scale);
  let p = made.project;
  const map = new Map<string, string>([[SELF, made.id]]);
  const now = new Date().toISOString();
  const created = template.elements.map((e) => {
    const o = makeObject(e.type, e.name, now);
    map.set(e.key, o.id);
    return { e, o };
  });
  // Steps get fresh ids too.
  for (const n of (Array.isArray(template.data.tree) ? template.data.tree : []) as PuzzleNode[]) map.set(n.id, newId('pzn'));
  for (const { e, o } of created) {
    const format = ENTRY_CODE[e.type];
    const data = freshIds(swap(e.data, map)) as Record<string, unknown>;
    p = { ...p, objects: { ...p.objects, [o.id]: { ...o, notes: e.notes ?? '', data: { ...data, ...(format ? { code: nextCode(p, format) } : {}) } } } };
  }
  const data = freshIds(swap(template.data, map)) as Record<string, unknown>;
  const puzzle = p.objects[made.id]!;
  p = { ...p, objects: { ...p.objects, [made.id]: { ...puzzle, data: { ...puzzle.data, ...data, code: puzzle.data.code, scale: template.scale, ...(created.length ? { elements: created.map((c) => c.o.id) } : {}) } } } };
  const nodes = nodesOf(p.objects[made.id]);
  if (nodes.length) p = setTree(p, made.id, nodes);
  return { project: p, id: made.id };
};

// ---------------------------------------------------------------- built in

const element = (key: string, kind: ElementKind, name: string, data: Record<string, unknown> = {}, verbs?: { verb: string; when?: string; becomes?: string; requires?: unknown; effects?: unknown[]; screen?: boolean }[]): TemplateElement => {
  const spec = kindSpec(kind);
  const states = (data.states as string[] | undefined) ?? spec.states;
  const list = verbs ?? spec.verbs ?? [];
  return {
    key,
    type: spec.type,
    name,
    data: {
      elementKind: kind,
      ...(states ? { states, initialState: states[0] } : {}),
      ...(list.length ? { interactions: list.map((v, i) => ({ id: `act_${key}${i}`, ...v })) } : {}),
      ...(spec.type === 'lore' ? { byEffect: true } : {}),
      ...data,
    },
  };
};

const step = (id: string, parentId: string | null, kind: PuzzleNode['kind'], label: string, extra: Partial<PuzzleNode> = {}): PuzzleNode => ({ id, parentId, kind, label, ...extra });

export const BUILT_IN_TEMPLATES: readonly PuzzleTemplate[] = [
  {
    id: 'builtin.safe',
    name: 'Safe code',
    description: 'A safe with a four-digit code, its digits and their order found in clues around the room (spec §7).',
    scale: 'object',
    builtIn: true,
    created: '2026-01-01T00:00:00.000Z',
    data: {
      objective: 'Open the safe',
      concept: 'A four-digit safe. One clue gives the first two digits, another how to order them; a third, optional, confirms the code.',
      solution: 'Find both clues, work out the code, enter it at the safe.',
      knows: 'The safe is in plain sight and locked.',
      failState: 'A wrong code: the safe stays shut.',
      reset: 'never',
      difficulty: '3',
      minutes: '6',
      tree: [
        step('t_work', null, 'goal', 'Work out the code', { gate: 'all' }),
        step('t_digits', 't_work', 'requirement', 'Learn the first two digits', { when: { kind: 'lore', ref: 'el3', op: 'known' } }),
        step('t_order', 't_work', 'requirement', 'Learn how to order the digits', { when: { kind: 'lore', ref: 'el4', op: 'known' } }),
        step('t_confirm', 't_work', 'requirement', 'Confirm the code', { when: { kind: 'lore', ref: 'el5', op: 'known' }, optional: true, branch: 'clue' }),
        step('t_enter', null, 'interaction', 'Enter the code', { when: { kind: 'object', ref: 'el1', op: 'is', value: 'Open' }, requires: ['t_work'] }),
      ],
      hints: [
        { id: 'hint_t1', text: 'The painting hangs a little crooked.', afterFails: 1 },
        { id: 'hint_t2', text: 'The note’s year, read backwards, orders the digits.', afterFails: 2 },
      ],
      cues: [
        { id: 'cue_t1', kind: 'audio', text: 'A heavy click' },
        { id: 'cue_t2', kind: 'animation', text: 'The safe door swings open' },
      ],
    },
    elements: [
      element(
        'el1',
        'container',
        'Safe',
        {
          states: ['Locked', 'Open', 'Empty'],
          // Its keypad (spec §8): the code is the Safe code's; three tries, then it jams.
          screen: {
            kind: 'keypad',
            prompt: 'A brass keypad, four digits.',
            codeRef: 'el2',
            keys: '123456789*0#',
            feedback: { correct: 'A heavy click. The door gives.', wrong: 'A dull buzz. Wrong code.' },
            attempts: 3,
          },
        },
        [
          { verb: 'Inspect' },
          { verb: 'Enter code', when: 'Locked', becomes: 'Open', screen: true },
          { verb: 'Take', when: 'Open', becomes: 'Empty' },
        ],
      ),
      element('el2', 'code', 'Safe code', { answer: '4271' }),
      element('el3', 'clue', 'First two digits', { clueForm: 'Visual', clueContent: '“42” scratched into the wall', clueLocation: 'Behind the painting', clueDiscovery: 'Inspect', clueKnowledge: 'The code starts 4, 2', clueStrength: 'Moderate', supports: ['t_digits'] }),
      element('el4', 'clue', 'The order', { clueForm: 'Text', clueContent: 'A note: “the year she left, backwards”', clueLocation: 'In the desk drawer', clueDiscovery: 'Read', clueKnowledge: 'How the digits go', clueStrength: 'Subtle', supports: ['t_order'] }),
      element('el5', 'clue', 'Confirmation', { clueForm: 'Audio', clueContent: 'A voicemail reading the code aloud', clueLocation: 'The answering machine', clueDiscovery: 'Hear', clueKnowledge: 'The whole code', clueStrength: 'Explicit', clueMandatory: 'no', supports: ['t_confirm'] }),
      element('el6', 'custom', 'Painting', {}, [{ verb: 'Inspect', effects: [{ kind: 'revealLore', ref: 'el3' }] }]),
      element('el7', 'container', 'Desk drawer', { states: ['Closed', 'Open'] }, [{ verb: 'Open', when: 'Closed', becomes: 'Open', effects: [{ kind: 'revealLore', ref: 'el4' }] }]),
    ],
  },
  {
    id: 'builtin.lever',
    name: 'Lever and door',
    description: 'A lever somewhere unlocks a door elsewhere; the player pulls it, then opens the door.',
    scale: 'area',
    builtIn: true,
    created: '2026-01-01T00:00:00.000Z',
    data: {
      objective: 'Get through the door',
      concept: 'A locked door; a lever across the room unlocks it.',
      solution: 'Pull the lever, then open the door.',
      tree: [
        step('t_pull', null, 'interaction', 'Pull the lever', { when: { kind: 'object', ref: 'el1', op: 'is', value: 'Up' } }),
        step('t_open', null, 'interaction', 'Open the door', { when: { kind: 'object', ref: 'el2', op: 'is', value: 'Open' }, requires: ['t_pull'] }),
      ],
      cues: [{ id: 'cue_l1', kind: 'audio', text: 'Chains rattle; the bolt draws back' }],
    },
    elements: [
      element('el1', 'lever', 'Lever', {}, [
        { verb: 'Pull', when: 'Down', becomes: 'Up', effects: [{ kind: 'setObject', ref: 'el2', value: 'Closed' }] },
        { verb: 'Push', when: 'Up', becomes: 'Down' },
      ]),
      element('el2', 'door', 'Door'),
    ],
  },
  {
    id: 'builtin.plates',
    name: 'Plates in order',
    description: 'Three pressure plates, stepped on in the right order, open a sealed passage.',
    scale: 'area',
    builtIn: true,
    created: '2026-01-01T00:00:00.000Z',
    data: {
      objective: 'Open the sealed passage',
      concept: 'Three plates in the floor; the murals show the order.',
      tree: [
        step('t_seq', null, 'goal', 'Step on the plates in order', { gate: 'sequence' }),
        step('t_p1', 't_seq', 'interaction', 'The sun plate', { when: { kind: 'object', ref: 'el1', op: 'is', value: 'Down' } }),
        step('t_p2', 't_seq', 'interaction', 'The moon plate', { when: { kind: 'object', ref: 'el2', op: 'is', value: 'Down' } }),
        step('t_p3', 't_seq', 'interaction', 'The star plate', { when: { kind: 'object', ref: 'el3', op: 'is', value: 'Down' } }),
      ],
      hints: [{ id: 'hint_p1', text: 'The murals run from dawn to night.', afterFails: 1 }],
      cues: [{ id: 'cue_p1', kind: 'message', text: 'The passage grinds open.' }],
    },
    elements: [element('el1', 'plate', 'Sun plate'), element('el2', 'plate', 'Moon plate'), element('el3', 'plate', 'Star plate')],
  },
];
