import { interactionsOf, setData, statesOf, type Interaction } from '../details';
import { newId } from '../project';
import type { Effect } from '../rules';
import type { Project, StoryObject } from '../types';

/**
 * Screen-level puzzles (puzzle spec §8): a puzzle that takes over the screen
 * — a keypad, a dial, sliding tiles — kept on the element it belongs to
 * (the safe's keypad is the safe's). One of the element's interactions opens
 * it; solving it does what that interaction does (the safe becomes Open and
 * its output fires), so the rest of the game sees an ordinary interaction.
 * A wrong answer gives its feedback, does its own effects and counts as a
 * wrong move for the puzzle's staged hints. Everything here is pure: the
 * preview, the play-through and Play Mode play the same rules.
 */

export type ScreenKind = 'keypad' | 'dial' | 'tiles' | 'symbols' | 'rings' | 'circuit' | 'assembly' | 'matching' | 'ordering' | 'levers' | 'custom';

export interface CircuitCell {
  /** Which sides it joins, solved: N 1, E 2, S 4, W 8. */
  piece: 'empty' | 'end' | 'straight' | 'corner' | 'tee' | 'cross';
  /** Its turn when solved (quarter turns clockwise). */
  rot: number;
}

export interface ScreenPuzzle {
  kind: ScreenKind;
  /** What the player is told on the screen. */
  prompt: string;
  /** Keypad: the code (or the true code of a code element), and the keys. */
  code?: string;
  codeRef?: string;
  keys?: string;
  /** Dial: how many numbers round it, and the numbers to stop at. */
  positions?: number;
  combination?: number[];
  /** Sliding tiles: a size × size board, shuffled by so many moves. */
  size?: number;
  shuffle?: number;
  /** Symbol sequence: the symbols on offer, and the order to press them. */
  symbols?: string[];
  answer?: string[];
  /** Rotating rings: how many, how many segments, where each starts; linked, each also turns the next. */
  rings?: number;
  segments?: number;
  start?: number[];
  linked?: boolean;
  /** Circuit routing: a grid of pieces, from a source cell to a sink cell. */
  width?: number;
  height?: number;
  cells?: CircuitCell[];
  source?: number;
  sink?: number;
  /** Object assembly: parts, and the slot each goes in. */
  parts?: { id: string; label: string }[];
  slots?: { id: string; label: string; accepts: string }[];
  /** Matching: pairs to match. */
  pairs?: { left: string; right: string }[];
  /** Ordering: the items, in the right order. */
  items?: string[];
  /** Lever / switch logic: switches, which others each flips too, how they start, how they must end. */
  switches?: string[];
  links?: number[][];
  startOn?: boolean[];
  target?: boolean[];
  /** Custom: an answer to type. */
  text?: string;
  feedback: { correct: string; wrong: string };
  /** Tries before it locks (0: any). */
  attempts?: number;
  /** What a wrong answer does besides its feedback. */
  onWrong?: Effect[];
  /** Art, mesh and audio to replace the proxy later. */
  art?: string;
  audio?: string;
}

export const SCREEN_KINDS: readonly { id: ScreenKind; label: string; icon: string; verb: string; hint: string; checks: 'submit' | 'live' }[] = [
  { id: 'keypad', label: 'Keypad', icon: '⌨', verb: 'Enter code', hint: 'Enter a code and press enter.', checks: 'submit' },
  { id: 'dial', label: 'Combination dial', icon: '◴', verb: 'Turn the dial', hint: 'Turn to each number and set it, in order.', checks: 'submit' },
  { id: 'tiles', label: 'Sliding tiles', icon: '▦', verb: 'Slide the tiles', hint: 'Slide the tiles back into order.', checks: 'live' },
  { id: 'symbols', label: 'Symbol sequence', icon: '✶', verb: 'Press the symbols', hint: 'Press the symbols in the right order.', checks: 'submit' },
  { id: 'rings', label: 'Rotating rings', icon: '◎', verb: 'Turn the rings', hint: 'Turn the rings until every one lines up.', checks: 'live' },
  { id: 'circuit', label: 'Circuit routing', icon: '⌁', verb: 'Route the circuit', hint: 'Turn the pieces to join the source to the sink.', checks: 'live' },
  { id: 'assembly', label: 'Object assembly', icon: '⚙', verb: 'Assemble', hint: 'Put each part in its place.', checks: 'submit' },
  { id: 'matching', label: 'Matching', icon: '⇄', verb: 'Match them', hint: 'Match each to its pair.', checks: 'submit' },
  { id: 'ordering', label: 'Ordering', icon: '↕', verb: 'Put them in order', hint: 'Put them in the right order.', checks: 'submit' },
  { id: 'levers', label: 'Lever / switch logic', icon: '⫯', verb: 'Set the levers', hint: 'Set the switches; each may flip others too.', checks: 'live' },
  { id: 'custom', label: 'Custom', icon: '◇', verb: 'Use', hint: 'Your own: describe it, and the answer that solves it.', checks: 'submit' },
];

export const screenKind = (kind: ScreenKind) => SCREEN_KINDS.find((k) => k.id === kind) ?? SCREEN_KINDS[SCREEN_KINDS.length - 1]!;

export const screenOf = (o: StoryObject | undefined): ScreenPuzzle | undefined => {
  const s = o?.data.screen as ScreenPuzzle | undefined;
  return s && typeof s === 'object' && typeof s.kind === 'string' ? s : undefined;
};

/** The interaction the screen opens on (marked `screen`). */
export const screenInteraction = (o: StoryObject | undefined): Interaction | undefined => interactionsOf(o).find((i) => i.screen);

// ---------------------------------------------------------------- what each kind starts as

const PIECE_SIDES: Record<CircuitCell['piece'], number> = { empty: 0, end: 1, straight: 5, corner: 3, tee: 7, cross: 15 };

export const defaultScreen = (kind: ScreenKind): ScreenPuzzle => {
  const base = { kind, prompt: screenKind(kind).hint, feedback: { correct: 'It works.', wrong: 'Nothing happens.' } };
  switch (kind) {
    case 'keypad':
      return { ...base, code: '1234', keys: '123456789*0#', feedback: { correct: 'A click: it opens.', wrong: 'A buzz. Wrong code.' } };
    case 'dial':
      return { ...base, positions: 40, combination: [12, 30, 7] };
    case 'tiles':
      return { ...base, size: 3, shuffle: 40 };
    case 'symbols':
      return { ...base, symbols: ['☉', '☾', '★', '♆', '♄', '♃'], answer: ['☉', '☾', '★'] };
    case 'rings':
      return { ...base, rings: 3, segments: 8, start: [3, 6, 2], linked: false };
    case 'circuit':
      // A 3 × 3 board, a path from the top left to the bottom right.
      return {
        ...base,
        width: 3,
        height: 3,
        source: 0,
        sink: 8,
        cells: [
          { piece: 'end', rot: 1 },
          { piece: 'corner', rot: 2 },
          { piece: 'empty', rot: 0 },
          { piece: 'empty', rot: 0 },
          { piece: 'straight', rot: 0 },
          { piece: 'empty', rot: 0 },
          { piece: 'empty', rot: 0 },
          { piece: 'corner', rot: 0 },
          { piece: 'end', rot: 3 },
        ],
      };
    case 'assembly':
      return {
        ...base,
        parts: [
          { id: 'p1', label: 'Gear' },
          { id: 'p2', label: 'Spring' },
          { id: 'p3', label: 'Hand' },
        ],
        slots: [
          { id: 's1', label: 'Axle', accepts: 'p1' },
          { id: 's2', label: 'Barrel', accepts: 'p2' },
          { id: 's3', label: 'Face', accepts: 'p3' },
        ],
      };
    case 'matching':
      return { ...base, pairs: [{ left: 'Lion', right: 'Sun' }, { left: 'Hare', right: 'Moon' }, { left: 'Owl', right: 'Star' }] };
    case 'ordering':
      return { ...base, items: ['Dawn', 'Noon', 'Dusk', 'Night'] };
    case 'levers':
      return { ...base, switches: ['A', 'B', 'C', 'D'], links: [[1], [0, 2], [1, 3], [2]], startOn: [false, false, false, false], target: [true, true, true, true] };
    case 'custom':
      return { ...base, text: 'answer' };
  }
};

/** Give an element a screen puzzle of a kind, and the interaction that opens it (one it has, or a new one). */
export const makeScreen = (project: Project, elementId: string, kind: ScreenKind): Project => {
  const o = project.objects[elementId];
  if (!o) return project;
  const screen = defaultScreen(kind);
  if (kind === 'keypad' && o.data.answer) screen.code = String(o.data.answer);
  const states = statesOf(o);
  const list = interactionsOf(o);
  const verb = screenKind(kind).verb;
  // The interaction it gates: one already marked, one of its verb, or the first that changes the element.
  const has = list.find((i) => i.screen) ?? list.find((i) => i.verb.toLowerCase() === verb.toLowerCase()) ?? list.find((i) => i.becomes);
  const interactions = has
    ? list.map((i) => (i.id === has.id ? { ...i, screen: true } : { ...i, screen: undefined }))
    : [...list, { id: newId('act'), verb, ...(states[0] ? { when: states[0] } : {}), ...(states[1] ? { becomes: states[1] } : {}), screen: true }];
  return setData(project, elementId, { screen, interactions });
};

export const updateScreen = (project: Project, elementId: string, patch: Partial<ScreenPuzzle>): Project => {
  const s = screenOf(project.objects[elementId]);
  return s ? setData(project, elementId, { screen: { ...s, ...patch } }) : project;
};

/** Which of the element's interactions opens its screen. */
export const setScreenInteraction = (project: Project, elementId: string, interactionId: string): Project =>
  setData(project, elementId, { interactions: interactionsOf(project.objects[elementId]).map((i) => ({ ...i, screen: i.id === interactionId ? true : undefined })) });

/** Take the screen off; its interaction does what it does again, without one. */
export const removeScreen = (project: Project, elementId: string): Project =>
  setData(project, elementId, { screen: undefined, interactions: interactionsOf(project.objects[elementId]).map((i) => ({ ...i, screen: undefined })) });

/** The keypad's code: its own, or its code element's true code. */
export const codeFor = (project: Project | undefined, s: ScreenPuzzle): string => String((s.codeRef && project?.objects[s.codeRef]?.data.answer) || s.code || '');

// ---------------------------------------------------------------- playing it

export interface ScreenState {
  /** Keypad, symbols, dial: what has been entered. */
  entry: string[];
  /** Dial: the number it points at. */
  dial: number;
  /** Tiles: the number on each square, 0 for the gap. */
  tiles: number[];
  /** Rings: each one's turn (0: lined up). */
  rings: number[];
  /** Circuit: each cell's turn. */
  rot: number[];
  /** Assembly: slot → part. */
  placed: Record<string, string>;
  /** Matching: left → right (by index); the right column shown in this order. */
  matched: Record<number, number>;
  shown: number[];
  /** Ordering: the items as they stand (indices into the right order). */
  order: number[];
  /** Levers: each switch on or off. */
  on: boolean[];
  text: string;
  tries: number;
  solved: boolean;
  locked: boolean;
  message?: string;
}

/** A small seeded random, so the preview, the play-through and Play Mode shuffle alike. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

const tileNeighbours = (n: number, at: number) => {
  const r = Math.floor(at / n);
  const c = at % n;
  return [r > 0 ? at - n : -1, c < n - 1 ? at + 1 : -1, r < n - 1 ? at + n : -1, c > 0 ? at - 1 : -1].filter((x) => x >= 0);
};

const rotSides = (sides: number, rot: number) => {
  let s = sides;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) s = ((s << 1) | (s >> 3)) & 15;
  return s;
};

/** Whether the source reaches the sink through the pieces as they are turned. */
export const circuitJoined = (s: ScreenPuzzle, rot: readonly number[]): boolean => {
  const w = s.width ?? 0;
  const h = s.height ?? 0;
  const cells = s.cells ?? [];
  const src = s.source ?? 0;
  const sink = s.sink ?? cells.length - 1;
  const sides = (i: number) => rotSides(PIECE_SIDES[cells[i]?.piece ?? 'empty'], rot[i] ?? 0);
  const seen = new Set([src]);
  const queue = [src];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === sink) return true;
    const r = Math.floor(at / w);
    const c = at % w;
    const steps: [number, number, number][] = [
      [1, 4, r > 0 ? at - w : -1],
      [2, 8, c < w - 1 ? at + 1 : -1],
      [4, 1, r < h - 1 ? at + w : -1],
      [8, 2, c > 0 ? at - 1 : -1],
    ];
    for (const [out, back, to] of steps) if (to >= 0 && !seen.has(to) && sides(at) & out && sides(to) & back) seen.add(to), queue.push(to);
  }
  return false;
};

const ringsTurn = (s: ScreenPuzzle, rings: readonly number[], ring: number, by: number): number[] => {
  const n = s.segments ?? 8;
  const next = [...rings];
  const turn = (i: number) => {
    if (i >= 0 && i < next.length) next[i] = (((next[i]! + by) % n) + n) % n;
  };
  turn(ring);
  if (s.linked) turn(ring + 1);
  return next;
};

const flip = (s: ScreenPuzzle, on: readonly boolean[], i: number): boolean[] => {
  const next = [...on];
  for (const j of [i, ...(s.links?.[i] ?? [])]) if (j >= 0 && j < next.length) next[j] = !next[j];
  return next;
};

/** How it starts: the tiles shuffled, the rings and circuit turned out of true, the right column mixed. */
export const startScreen = (s: ScreenPuzzle, seed = 'screen'): ScreenState => {
  const random = rng(seedOf(seed));
  const n = Math.max(2, s.size ?? 3);
  let tiles = [...Array.from({ length: n * n - 1 }, (_, i) => i + 1), 0];
  if (s.kind === 'tiles') {
    let gap = tiles.length - 1;
    let last = -1;
    for (let m = 0; m < Math.max(1, s.shuffle ?? 40); m++) {
      const options = tileNeighbours(n, gap).filter((x) => x !== last);
      const to = options[Math.floor(random() * options.length)]!;
      [tiles[gap], tiles[to]] = [tiles[to]!, tiles[gap]!];
      last = gap;
      gap = to;
    }
    if (tilesSolved(tiles)) [tiles[0], tiles[1]] = [tiles[1]!, tiles[0]!];
    tiles = [...tiles];
  }
  const cells = s.cells ?? [];
  let rot = cells.map((c) => c.rot);
  if (s.kind === 'circuit') {
    // The source and the sink stay put: the player turns what is between.
    const fixed = (i: number) => cells[i]!.piece === 'empty' || cells[i]!.piece === 'cross' || i === s.source || i === s.sink;
    rot = cells.map((c, i) => (fixed(i) ? c.rot : (c.rot + 1 + Math.floor(random() * 3)) % 4));
    if (circuitJoined(s, rot)) rot = rot.map((r, i) => (fixed(i) ? r : (r + 1) % 4));
  }
  const count = s.pairs?.length ?? 0;
  const shown = Array.from({ length: count }, (_, i) => i);
  for (let i = shown.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shown[i], shown[j]] = [shown[j]!, shown[i]!];
  }
  const items = s.items?.length ?? 0;
  // Ordering starts reversed, then rotated: never already right.
  const order = Array.from({ length: items }, (_, i) => (items - 1 - i + 1) % Math.max(1, items));
  const rings = Array.from({ length: s.rings ?? 0 }, (_, i) => (s.start?.[i] ?? 0) % Math.max(1, s.segments ?? 8));
  return {
    entry: [],
    dial: 0,
    tiles,
    rings,
    rot,
    placed: {},
    matched: {},
    shown,
    order,
    on: [...(s.startOn ?? (s.switches ?? []).map(() => false))],
    text: '',
    tries: 0,
    solved: false,
    locked: false,
  };
};

const tilesSolved = (tiles: readonly number[]) => tiles.every((t, i) => (i === tiles.length - 1 ? t === 0 : t === i + 1));

/** Whether what is on the screen now is the answer. */
export const isRight = (project: Project | undefined, s: ScreenPuzzle, st: ScreenState): boolean => {
  switch (s.kind) {
    case 'keypad':
      return st.entry.join('') === codeFor(project, s) && codeFor(project, s) !== '';
    case 'dial':
      return (s.combination ?? []).length > 0 && st.entry.join(',') === (s.combination ?? []).join(',');
    case 'tiles':
      return tilesSolved(st.tiles);
    case 'symbols':
      return (s.answer ?? []).length > 0 && st.entry.join('\u0000') === (s.answer ?? []).join('\u0000');
    case 'rings':
      return st.rings.length > 0 && st.rings.every((r) => r === 0);
    case 'circuit':
      return circuitJoined(s, st.rot);
    case 'assembly':
      return (s.slots ?? []).length > 0 && (s.slots ?? []).every((sl) => st.placed[sl.id] === sl.accepts);
    case 'matching':
      return (s.pairs ?? []).length > 0 && (s.pairs ?? []).every((_, i) => st.matched[i] === i);
    case 'ordering':
      return st.order.length > 1 && st.order.every((x, i) => x === i);
    case 'levers':
      return (s.target ?? []).length > 0 && st.on.every((x, i) => x === !!s.target?.[i]);
    case 'custom':
      return st.text.trim().toLowerCase() === String(s.text ?? '').trim().toLowerCase() && !!String(s.text ?? '').trim();
  }
};

export type ScreenAction =
  | { type: 'press'; key: string }
  | { type: 'clear' }
  | { type: 'submit' }
  | { type: 'turn'; by: number }
  | { type: 'set' }
  | { type: 'slide'; at: number }
  | { type: 'rotate'; ring: number; by: number }
  | { type: 'spin'; cell: number }
  | { type: 'place'; slot: string; part: string | null }
  | { type: 'match'; left: number; right: number | null }
  | { type: 'move'; at: number; by: -1 | 1 }
  | { type: 'flip'; switch: number }
  | { type: 'type'; text: string }
  | { type: 'reset'; seed?: string };

export interface Acted {
  state: ScreenState;
  /** What just happened: right (solved), wrong (a wrong answer), or nothing yet. */
  outcome?: 'right' | 'wrong';
}

const done = (s: ScreenPuzzle, st: ScreenState): Acted => ({ state: { ...st, solved: true, message: s.feedback.correct }, outcome: 'right' });

/** Do one thing on the screen. Live kinds solve as soon as they are right; the rest when the answer is given. */
export const act = (project: Project | undefined, s: ScreenPuzzle, st: ScreenState, a: ScreenAction): Acted => {
  if (a.type === 'reset') return { state: startScreen(s, a.seed) };
  if (st.solved || st.locked) return { state: st };
  let next: ScreenState = { ...st, message: undefined };
  switch (a.type) {
    case 'press': {
      const limit = s.kind === 'keypad' ? Math.max(1, codeFor(project, s).length || 8) : Math.max(1, (s.answer ?? []).length || 8);
      if (next.entry.length < limit) next.entry = [...next.entry, a.key];
      break;
    }
    case 'clear':
      next.entry = [];
      next.text = '';
      break;
    case 'turn': {
      const n = Math.max(2, s.positions ?? 40);
      next.dial = (((next.dial + a.by) % n) + n) % n;
      break;
    }
    case 'set':
      if (next.entry.length < Math.max(1, (s.combination ?? []).length)) next.entry = [...next.entry, String(next.dial)];
      break;
    case 'slide': {
      const n = Math.max(2, s.size ?? 3);
      const gap = next.tiles.indexOf(0);
      if (tileNeighbours(n, gap).includes(a.at)) {
        const tiles = [...next.tiles];
        [tiles[gap], tiles[a.at]] = [tiles[a.at]!, 0];
        next.tiles = tiles;
      }
      break;
    }
    case 'rotate':
      next.rings = ringsTurn(s, next.rings, a.ring, a.by);
      break;
    case 'spin':
      if ((s.cells ?? [])[a.cell] && s.cells![a.cell]!.piece !== 'empty' && a.cell !== s.source && a.cell !== s.sink) next.rot = next.rot.map((r, i) => (i === a.cell ? (r + 1) % 4 : r));
      break;
    case 'place': {
      const placed = Object.fromEntries(Object.entries(next.placed).filter(([slot, part]) => slot !== a.slot && part !== a.part));
      if (a.part) placed[a.slot] = a.part;
      next.placed = placed;
      break;
    }
    case 'match': {
      const matched = Object.fromEntries(Object.entries(next.matched).filter(([l, r]) => Number(l) !== a.left && r !== a.right)) as Record<number, number>;
      if (a.right !== null) matched[a.left] = a.right;
      next.matched = matched;
      break;
    }
    case 'move': {
      const to = a.at + a.by;
      if (to >= 0 && to < next.order.length) {
        const order = [...next.order];
        [order[a.at], order[to]] = [order[to]!, order[a.at]!];
        next.order = order;
      }
      break;
    }
    case 'flip':
      next.on = flip(s, next.on, a.switch);
      break;
    case 'type':
      next.text = a.text;
      break;
    case 'submit': {
      if (isRight(project, s, next)) return done(s, next);
      const tries = next.tries + 1;
      const locked = (s.attempts ?? 0) > 0 && tries >= s.attempts!;
      next = { ...next, tries, locked, entry: [], message: locked ? `${s.feedback.wrong} It won’t take another try.` : s.feedback.wrong };
      return { state: next, outcome: 'wrong' };
    }
  }
  if (screenKind(s.kind).checks === 'live' && isRight(project, s, next)) return done(s, next);
  return { state: next };
};

// ---------------------------------------------------------------- checking it can be done

/** Whether a set of switches can reach the target (each flip is its own inverse: try every set of flips). */
const leversReachable = (s: ScreenPuzzle): boolean => {
  const n = s.switches?.length ?? 0;
  if (n > 16) return true;
  const start = s.startOn ?? Array.from({ length: n }, () => false);
  for (let mask = 0; mask < 1 << n; mask++) {
    let on = [...start];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) on = flip(s, on, i);
    if (on.every((x, i) => x === !!s.target?.[i])) return true;
  }
  return false;
};

const ringsReachable = (s: ScreenPuzzle): boolean => {
  if (!s.linked) return true;
  const n = s.segments ?? 8;
  const count = s.rings ?? 0;
  if (Math.pow(n, count) > 50000) return true;
  const key = (r: number[]) => r.join(',');
  const start = Array.from({ length: count }, (_, i) => (s.start?.[i] ?? 0) % n);
  const seen = new Set([key(start)]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    if (at.every((x) => x === 0)) return true;
    for (let ring = 0; ring < count; ring++)
      for (const by of [1, -1]) {
        const next = ringsTurn(s, at, ring, by);
        if (!seen.has(key(next))) seen.add(key(next)), queue.push(next);
      }
  }
  return false;
};

/** What stops a screen puzzle being solved, or looks unfinished. */
export const screenIssues = (project: Project, o: StoryObject): string[] => {
  const s = screenOf(o);
  if (!s) return [];
  const out: string[] = [];
  const name = o.name;
  if (!screenInteraction(o)) out.push(`${name}’s screen has no interaction to open it.`);
  switch (s.kind) {
    case 'keypad': {
      const code = codeFor(project, s);
      if (!code) out.push(`${name}’s keypad has no code.`);
      const keys = s.keys ?? '';
      if ([...code].some((c) => !keys.includes(c))) out.push(`${name}’s code uses keys the keypad hasn’t got.`);
      break;
    }
    case 'dial':
      if (!(s.combination ?? []).length) out.push(`${name}’s dial has no combination.`);
      if ((s.combination ?? []).some((c) => c < 0 || c >= (s.positions ?? 40))) out.push(`${name}’s combination has a number the dial doesn’t.`);
      break;
    case 'symbols':
      if (!(s.answer ?? []).length) out.push(`${name}’s sequence has no answer.`);
      if ((s.answer ?? []).some((a) => !(s.symbols ?? []).includes(a))) out.push(`${name}’s answer uses a symbol that isn’t on it.`);
      break;
    case 'circuit':
      if (!circuitJoined(s, (s.cells ?? []).map((c) => c.rot))) out.push(`${name}’s circuit doesn’t join the source to the sink, even solved.`);
      break;
    case 'assembly':
      if ((s.slots ?? []).some((sl) => !(s.parts ?? []).some((p) => p.id === sl.accepts))) out.push(`${name}’s assembly has a slot with no part for it.`);
      break;
    case 'levers':
      if (!leversReachable(s)) out.push(`${name}’s switches can never all be set right.`);
      break;
    case 'rings':
      if (!ringsReachable(s)) out.push(`${name}’s rings can never all line up.`);
      break;
    case 'ordering':
      if ((s.items ?? []).length < 2) out.push(`${name}’s ordering needs two things or more.`);
      break;
    case 'matching':
      if (!(s.pairs ?? []).length) out.push(`${name}’s matching has no pairs.`);
      break;
    case 'custom':
      if (!String(s.text ?? '').trim()) out.push(`${name}’s screen has no answer.`);
      break;
    case 'tiles':
      break;
  }
  return out;
};
