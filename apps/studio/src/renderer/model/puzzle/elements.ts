import { interactionsOf, setData, statesOf, type Interaction } from '../details';
import { levelsOf } from '../level/level';
import type { LevelItem } from '../level/types';
import { ENTRY_CODE, makeObject, newId, nextCode } from '../project';
import type { Condition, Effect, Rule } from '../rules';
import type { ObjectType, Project, StoryObject } from '../types';
import { addNode } from './design';
import { nodesOf } from './tree';

/**
 * The puzzle element library (puzzle spec §9) and object states and
 * interactions (§11). An element is a story element like any other (an
 * object with states, an item, a clue, a state, a trigger), made from a
 * kind that gives it its icon, states, verbs and properties. The puzzle
 * lists the elements it is made of; its steps point at them; level items
 * stand for them where they are placed. So the play-through, Play Mode and
 * every engine play them as they already play objects and items.
 */

export type ElementKind =
  | 'clue'
  | 'key'
  | 'code'
  | 'note'
  | 'symbol'
  | 'lock'
  | 'container'
  | 'switch'
  | 'lever'
  | 'dial'
  | 'button'
  | 'plate'
  | 'movable'
  | 'piece'
  | 'power'
  | 'socket'
  | 'sequence'
  | 'timer'
  | 'door'
  | 'reward'
  | 'custom';

export interface ElementProp {
  key: string;
  label: string;
  placeholder?: string;
}

export interface ElementKindSpec {
  id: ElementKind;
  label: string;
  icon: string;
  /** The story element it is. */
  type: ObjectType;
  /** Its states, the first where it starts (objects). */
  states?: string[];
  /** Its verbs: what the player can do with it, from which state to which. */
  verbs?: { verb: string; when?: string; becomes?: string }[];
  props?: ElementProp[];
  hint: string;
}

export const ELEMENT_KINDS: readonly ElementKindSpec[] = [
  { id: 'clue', label: 'Clue', icon: '🔍', type: 'lore', hint: 'What the player learns: text, a picture, a sound, the room itself.' },
  { id: 'key', label: 'Key', icon: '🔑', type: 'inventory', hint: 'An item that opens a lock.', props: [{ key: 'opens', label: 'Opens', placeholder: 'The cellar door' }] },
  { id: 'code', label: 'Code', icon: '#', type: 'lore', hint: 'A code, combination or password the player works out.', props: [{ key: 'answer', label: 'The true code', placeholder: '4271' }] },
  { id: 'note', label: 'Note', icon: '📜', type: 'inventory', hint: 'Something to read and carry.', props: [{ key: 'text', label: 'What it says', placeholder: 'Left of the lamp, twice…' }] },
  { id: 'symbol', label: 'Symbol', icon: '✶', type: 'lore', hint: 'A sign or glyph to recognise and match.', props: [{ key: 'glyph', label: 'The symbol', placeholder: 'Three rings, one broken' }] },
  { id: 'lock', label: 'Lock', icon: '🔒', type: 'object', states: ['Locked', 'Unlocked'], verbs: [{ verb: 'Unlock', when: 'Locked', becomes: 'Unlocked' }], hint: 'Locked until something opens it.' },
  {
    id: 'container',
    label: 'Container',
    icon: '📦',
    type: 'object',
    states: ['Closed', 'Open', 'Empty'],
    verbs: [
      { verb: 'Open', when: 'Closed', becomes: 'Open' },
      { verb: 'Take', when: 'Open', becomes: 'Empty' },
    ],
    hint: 'A safe, a chest, a drawer: closed, open, emptied.',
  },
  {
    id: 'switch',
    label: 'Switch',
    icon: '⏻',
    type: 'object',
    states: ['Off', 'On'],
    verbs: [
      { verb: 'Activate', when: 'Off', becomes: 'On' },
      { verb: 'Activate', when: 'On', becomes: 'Off' },
    ],
    hint: 'On or off, either way round.',
  },
  {
    id: 'lever',
    label: 'Lever',
    icon: '⫯',
    type: 'object',
    states: ['Down', 'Up'],
    verbs: [
      { verb: 'Pull', when: 'Down', becomes: 'Up' },
      { verb: 'Push', when: 'Up', becomes: 'Down' },
    ],
    hint: 'Pulled up, pushed down.',
  },
  { id: 'dial', label: 'Dial', icon: '◴', type: 'object', states: ['1', '2', '3', '4'], verbs: [{ verb: 'Rotate' }], hint: 'Turns through its positions, round and back to the first.' },
  { id: 'button', label: 'Button', icon: '⏺', type: 'object', states: ['Up', 'Pressed'], verbs: [{ verb: 'Push', when: 'Up', becomes: 'Pressed' }], hint: 'Pressed once.' },
  {
    id: 'plate',
    label: 'Pressure plate',
    icon: '▭',
    type: 'object',
    states: ['Up', 'Down'],
    verbs: [
      { verb: 'Step on', when: 'Up', becomes: 'Down' },
      { verb: 'Step off', when: 'Down', becomes: 'Up' },
    ],
    hint: 'Down while something stands on it.',
    props: [{ key: 'weight', label: 'Held down by', placeholder: 'The player, the statue' }],
  },
  {
    id: 'movable',
    label: 'Movable object',
    icon: '⇲',
    type: 'object',
    states: ['Start', 'Moved'],
    verbs: [{ verb: 'Push', when: 'Start', becomes: 'Moved' }],
    hint: 'A crate, a statue: pushed to where it is needed.',
  },
  { id: 'piece', label: 'Collectible piece', icon: '◩', type: 'inventory', hint: 'One of several pieces put together.', props: [{ key: 'of', label: 'Pieces in all', placeholder: '3' }] },
  { id: 'power', label: 'Power source', icon: '⚡', type: 'object', states: ['Off', 'Powered'], verbs: [{ verb: 'Activate', when: 'Off', becomes: 'Powered' }], hint: 'A generator, a battery, a fuse box.' },
  { id: 'socket', label: 'Socket', icon: '⊙', type: 'object', states: ['Empty', 'Full'], verbs: [{ verb: 'Place', when: 'Empty', becomes: 'Full' }, { verb: 'Remove', when: 'Full', becomes: 'Empty' }], hint: 'Somewhere a piece, a gem or a fuse goes.' },
  { id: 'sequence', label: 'Sequence trigger', icon: '⋯', type: 'trigger', hint: 'Fires when its rule holds: the right things, in the right order.' },
  { id: 'timer', label: 'Timer', icon: '⏱', type: 'trigger', hint: 'Fires when its rule holds; how long it gives is a property.', props: [{ key: 'seconds', label: 'Seconds', placeholder: '30' }] },
  {
    id: 'door',
    label: 'Door',
    icon: '🚪',
    type: 'object',
    states: ['Locked', 'Closed', 'Open'],
    verbs: [
      { verb: 'Unlock', when: 'Locked', becomes: 'Closed' },
      { verb: 'Open', when: 'Closed', becomes: 'Open' },
      { verb: 'Close', when: 'Open', becomes: 'Closed' },
    ],
    hint: 'Locked, closed, open.',
  },
  { id: 'reward', label: 'Reward', icon: '★', type: 'inventory', hint: 'What solving it (or an optional branch) gives.' },
  { id: 'custom', label: 'Custom', icon: '◇', type: 'object', hint: 'Anything else: name its states and verbs yourself.' },
];

export { STATE_NAMES, VERBS } from '../details';

export const kindSpec = (kind: ElementKind): ElementKindSpec => ELEMENT_KINDS.find((k) => k.id === kind) ?? ELEMENT_KINDS[ELEMENT_KINDS.length - 1]!;

/** What kind of element a story element is: the kind it was made as, or what its type suggests. */
export const elementKindOf = (o: StoryObject): ElementKind => {
  const k = o.data.elementKind as ElementKind | undefined;
  if (k && ELEMENT_KINDS.some((x) => x.id === k)) return k;
  return o.type === 'lore' ? 'clue' : o.type === 'inventory' ? 'key' : o.type === 'trigger' ? 'sequence' : 'custom';
};

const ELEMENT_TYPES: readonly ObjectType[] = ['object', 'inventory', 'lore', 'state', 'trigger'];

const refsIn = (x: unknown, out: Set<string>) => {
  if (!x || typeof x !== 'object') return;
  if (Array.isArray(x)) {
    for (const y of x) refsIn(y, out);
    return;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.ref === 'string') out.add(o.ref);
  for (const v of Object.values(o)) refsIn(v, out);
};

/**
 * The elements a puzzle is made of: those added to it, and those its steps
 * name (the lever a step needs up, the clue a step needs known), in that order.
 */
export const elementsOf = (project: Project, puzzleId: string): StoryObject[] => {
  const puzzle = project.objects[puzzleId];
  const listed = (puzzle?.data.elements as string[] | undefined) ?? [];
  const named = new Set<string>();
  refsIn(nodesOf(puzzle), named);
  const ids = [...new Set([...listed, ...named])];
  return ids.map((id) => project.objects[id]).filter((o): o is StoryObject => !!o && ELEMENT_TYPES.includes(o.type) && o.id !== puzzleId);
};

const listOn = (project: Project, puzzleId: string, ids: string[]): Project => setData(project, puzzleId, { elements: ids.length ? ids : undefined });

/** The interactions a kind starts with; a dial turns round through its positions. */
const verbsFor = (spec: ElementKindSpec): Interaction[] => {
  const states = spec.states ?? [];
  if (spec.id === 'dial') return states.map((s, i) => ({ id: newId('act'), verb: 'Rotate', when: s, becomes: states[(i + 1) % states.length]! }));
  return (spec.verbs ?? []).map((v) => ({ id: newId('act'), verb: v.verb, ...(v.when ? { when: v.when } : {}), ...(v.becomes ? { becomes: v.becomes } : {}) }));
};

/** Make an element of a kind and add it to the puzzle (§9). It is in the Bible with the rest. */
export const addElement = (project: Project, puzzleId: string, kind: ElementKind, name?: string): { project: Project; elementId: string } => {
  const spec = kindSpec(kind);
  const format = ENTRY_CODE[spec.type];
  const label = name?.trim() || spec.label;
  const element = makeObject(spec.type, spec.type === 'state' ? label.toLowerCase().replace(/[^a-z0-9]+/g, '_') : label, new Date().toISOString(), {
    ...(format ? { code: nextCode(project, format) } : {}),
    elementKind: kind,
    ...(spec.states ? { states: [...spec.states], initialState: spec.states[0] } : {}),
    ...(spec.states || spec.verbs ? { interactions: verbsFor(spec) } : {}),
    // A clue or a code isn't known until something reveals it.
    ...(spec.type === 'lore' ? { byEffect: true } : {}),
  });
  const withIt: Project = { ...project, objects: { ...project.objects, [element.id]: element } };
  const listed = (project.objects[puzzleId]?.data.elements as string[] | undefined) ?? [];
  return { project: listOn(withIt, puzzleId, [...listed, element.id]), elementId: element.id };
};

/** Add an element already in the Bible to the puzzle. */
export const linkElement = (project: Project, puzzleId: string, elementId: string): Project => {
  const listed = (project.objects[puzzleId]?.data.elements as string[] | undefined) ?? [];
  if (listed.includes(elementId) || !project.objects[elementId]) return project;
  return listOn(project, puzzleId, [...listed, elementId]);
};

/** Take an element off the puzzle's list; it stays in the Bible (and in any step that names it). */
export const unlinkElement = (project: Project, puzzleId: string, elementId: string): Project => {
  const listed = (project.objects[puzzleId]?.data.elements as string[] | undefined) ?? [];
  return listed.includes(elementId) ? listOn(project, puzzleId, listed.filter((x) => x !== elementId)) : project;
};

export const setElementKind = (project: Project, elementId: string, kind: ElementKind): Project => setData(project, elementId, { elementKind: kind });

/** The condition "this element is done": an object in a state, an item carried, a clue known, a state set. */
export const conditionFor = (project: Project, elementId: string, state?: string): Condition | undefined => {
  const o = project.objects[elementId];
  if (!o) return undefined;
  if (o.type === 'object') {
    const states = statesOf(o);
    const value = state ?? states[states.length - 1];
    return value ? { kind: 'object', ref: o.id, op: 'is', value } : undefined;
  }
  if (o.type === 'inventory') return { kind: 'item', ref: o.id, op: 'has' };
  if (o.type === 'lore') return { kind: 'lore', ref: o.id, op: 'known' };
  if (o.type === 'state') return { kind: 'flag', ref: o.id, op: 'is', value: statesOf(o).at(-1) ?? 'yes' };
  return undefined;
};

/** A step done when the element is (in this state): under the selected sub-goal, or the puzzle's goal. */
export const stepFromElement = (project: Project, puzzleId: string, elementId: string, opts: { state?: string; parentId?: string | null } = {}): { project: Project; nodeId: string } => {
  const o = project.objects[elementId];
  const when = conditionFor(project, elementId, opts.state);
  if (!o || !when) return { project, nodeId: '' };
  const label = o.type === 'object' ? `${o.name}: ${when.kind === 'object' ? when.value : ''}` : o.type === 'inventory' ? `Get ${o.name}` : o.type === 'lore' ? `Learn ${o.name}` : `${o.name} is set`;
  const kind = o.type === 'object' ? 'interaction' : 'requirement';
  const made = addNode(linkElement(project, puzzleId, elementId), puzzleId, { kind, parentId: opts.parentId ?? null, label, when });
  return made;
};

/** The steps of this puzzle that use an element: done by it, or a wrong move by it. */
export const stepsUsing = (project: Project, puzzleId: string, elementId: string) =>
  nodesOf(project.objects[puzzleId]).filter((n) => {
    const refs = new Set<string>();
    refsIn([n.when, n.fail?.when], refs);
    return refs.has(elementId);
  });

/** Level items that stand for an element: its pickup, its placed object, an item linked to it. */
export const itemsFor = (project: Project, elementId: string): LevelItem[] =>
  levelsOf(project).items.filter((i) => (i.links ?? []).includes(elementId) || i.params?.item === elementId || i.params?.object === elementId);

/** Every effect anywhere in the project: interactions, triggers, puzzles, quests, options, level rules. */
const everyEffect = (project: Project): Effect[] => {
  const out: Effect[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    if (typeof o.kind === 'string' && typeof o.ref === 'string' && !('op' in o)) out.push(o as unknown as Effect);
    Object.values(o).forEach(walk);
  };
  walk(Object.values(project.objects).map((o) => o.data));
  walk(project.connections);
  walk(levelsOf(project).items);
  return out;
};

/** What reveals a clue (or other lore): it is known at once unless set "only by an effect", then something must reveal it. */
export const revealedBy = (project: Project, loreId: string): 'start' | 'rule' | 'effect' | 'nothing' => {
  const o = project.objects[loreId];
  if (!o) return 'nothing';
  if (everyEffect(project).some((e) => e.kind === 'revealLore' && e.ref === loreId)) return 'effect';
  if (o.data.byEffect) return 'nothing';
  const rule = o.data.rule as Rule | undefined;
  return rule?.items?.length ? 'rule' : 'start';
};

/** Interactions of an element, read for the list. */
export const verbsOf = (o: StoryObject): string[] => [...new Set(interactionsOf(o).map((i) => i.verb))];
