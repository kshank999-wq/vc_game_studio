import type { Card, CardGame, Side } from './cards';

/**
 * The card game running: turns, mana, drawing (and fatigue when a deck runs
 * out), playing cards, and attacks. The same moves drive the play preview
 * (the player against the studio's opponent) and the report (the studio
 * against itself, many games), so what the designer plays is what the
 * numbers say. Shuffles come from a seed, so the same game runs the same.
 */

export interface Minion {
  uid: number;
  cardId: string;
  attack: number;
  health: number;
  maxHealth: number;
  guard: boolean;
  canAttack: boolean;
}

export interface SideState {
  hero: number;
  deck: string[];
  hand: string[];
  board: Minion[];
  mana: number;
  maxMana: number;
  /** Damage the next draw from an empty deck does. */
  fatigue: number;
  /** Cards played this game, for the report. */
  played: string[];
}

export interface Duel {
  /** Turns started, both sides together. */
  turn: number;
  active: Side;
  first: Side;
  sides: Record<Side, SideState>;
  phase: 'playing' | 'over';
  winner?: Side | 'draw';
  log: string[];
  nextUid: number;
  seed: number;
}

/** Who an attack or a spell is aimed at: a minion by uid, or the hero. */
export type Target = number | 'hero';

/** After this many turns, both sides together, a game is a draw. */
export const TURN_LIMIT = 80;

export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
const clone = (d: Duel): Duel => ({ ...d, log: [...d.log], sides: { blue: cloneSide(d.sides.blue), red: cloneSide(d.sides.red) } });
const cloneSide = (s: SideState): SideState => ({ ...s, deck: [...s.deck], hand: [...s.hand], board: s.board.map((m) => ({ ...m })), played: [...s.played] });

/** mulberry32: the next random number in [0, 1) and the seed after it. */
const rand = (seed: number): [number, number] => {
  let t = (seed + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
};

const shuffle = (d: Duel, cards: string[]): string[] => {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const [r, seed] = rand(d.seed);
    d.seed = seed;
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

const say = (d: Duel, line: string) => {
  d.log.push(line);
  if (d.log.length > 60) d.log.shift();
};
const who = (side: Side) => (side === 'blue' ? 'You' : 'They');

const checkOver = (d: Duel) => {
  const blue = d.sides.blue.hero <= 0;
  const red = d.sides.red.hero <= 0;
  if (blue || red) {
    d.phase = 'over';
    d.winner = blue && red ? 'draw' : blue ? 'red' : 'blue';
  }
};

const draw = (g: CardGame, d: Duel, side: Side) => {
  const s = d.sides[side];
  const id = s.deck.shift();
  if (id === undefined) {
    s.fatigue++;
    s.hero -= s.fatigue;
    say(d, `${who(side)} drew from an empty deck: ${s.fatigue} fatigue damage.`);
    checkOver(d);
  } else if (s.hand.length >= g.rules.handMax) say(d, `${who(side)} had a full hand: ${g.cards.find((c) => c.id === id)?.name ?? 'a card'} was burned.`);
  else s.hand.push(id);
};

const startTurn = (g: CardGame, d: Duel, side: Side) => {
  d.active = side;
  d.turn++;
  const s = d.sides[side];
  s.maxMana = s.maxMana < 0 ? g.rules.manaStart : Math.min(g.rules.manaMax, s.maxMana + g.rules.manaGrowth);
  s.mana = s.maxMana;
  for (const m of s.board) m.canAttack = true;
  draw(g, d, side);
  if (d.phase === 'playing' && d.turn > TURN_LIMIT) {
    d.phase = 'over';
    d.winner = 'draw';
  }
};

/** A fresh game: decks shuffled, opening hands drawn (one more for the side that goes second), the first turn begun. */
export const createDuel = (g: CardGame, seed = 1, first: Side = 'blue'): Duel => {
  const empty = (): SideState => ({ hero: g.rules.heroHealth, deck: [], hand: [], board: [], mana: 0, maxMana: -1, fatigue: 0, played: [] });
  const d: Duel = { turn: 0, active: first, first, sides: { blue: empty(), red: empty() }, phase: 'playing', log: [], nextUid: 1, seed };
  const known = new Set(g.cards.map((c) => c.id));
  for (const side of ['blue', 'red'] as const) d.sides[side].deck = shuffle(d, g.decks[side].filter((id) => known.has(id)));
  for (const side of ['blue', 'red'] as const) for (let i = 0; i < g.rules.startHand + (side === first ? 0 : 1); i++) draw(g, d, side);
  startTurn(g, d, first);
  return d;
};

const cardOf = (g: CardGame, id: string): Card | undefined => g.cards.find((c) => c.id === id);

/** Whether a card's effect needs a target picked, and which. */
export const targetKind = (c: Card): 'enemy' | 'friendly' | null => (c.effect.amount > 0 && c.effect.kind === 'damage' ? 'enemy' : c.effect.amount > 0 && c.effect.kind === 'buff' ? 'friendly' : null);

const hit = (g: CardGame, d: Duel, side: Side, target: Target, amount: number) => {
  const s = d.sides[side];
  if (target === 'hero') s.hero -= amount;
  else {
    const m = s.board.find((x) => x.uid === target);
    if (m) m.health -= amount;
  }
  s.board = s.board.filter((m) => m.health > 0);
  checkOver(d);
};

const applyEffect = (g: CardGame, d: Duel, side: Side, c: Card, target?: Target) => {
  const e = c.effect;
  const me = d.sides[side];
  const foe = other(side);
  if (e.amount <= 0) return;
  if (e.kind === 'damage' && target !== undefined) hit(g, d, foe, target, e.amount);
  else if (e.kind === 'damageAll') for (const m of [...d.sides[foe].board]) hit(g, d, foe, m.uid, e.amount);
  else if (e.kind === 'heal') me.hero = Math.min(g.rules.heroHealth, me.hero + e.amount);
  else if (e.kind === 'draw') for (let i = 0; i < e.amount; i++) draw(g, d, side);
  else if (e.kind === 'buff' && typeof target === 'number') {
    const m = me.board.find((x) => x.uid === target);
    if (m) {
      m.attack += e.amount;
      m.health += e.amount;
      m.maxHealth += e.amount;
    }
  }
};

/** Whether the active side can play this card from its hand now (with this target, if it takes one). */
export const canPlay = (g: CardGame, d: Duel, handIndex: number, target?: Target): boolean => {
  if (d.phase !== 'playing') return false;
  const s = d.sides[d.active];
  const id = s.hand[handIndex];
  const c = id === undefined ? undefined : cardOf(g, id);
  if (!c || c.cost > s.mana) return false;
  if (c.kind === 'minion' && s.board.length >= g.rules.boardMax) return false;
  const kind = targetKind(c);
  if (!kind) return true;
  if (target === undefined) return c.kind === 'minion' || (kind === 'enemy' ? true : s.board.length > 0);
  if (kind === 'enemy') return target === 'hero' || d.sides[other(d.active)].board.some((m) => m.uid === target);
  return typeof target === 'number' && s.board.some((m) => m.uid === target);
};

const playIn = (g: CardGame, d: Duel, handIndex: number, target?: Target) => {
  const side = d.active;
  const s = d.sides[side];
  const c = cardOf(g, s.hand[handIndex]!)!;
  s.hand.splice(handIndex, 1);
  s.mana -= c.cost;
  s.played.push(c.id);
  say(d, `${who(side)} played ${c.name}.`);
  if (c.kind === 'minion') s.board.push({ uid: d.nextUid++, cardId: c.id, attack: c.attack, health: c.health, maxHealth: c.health, guard: c.guard, canAttack: c.charge });
  applyEffect(g, d, side, c, target);
};

/** Play a card from the active side's hand. Unchanged if it can't be played so. */
export const playCard = (g: CardGame, d: Duel, handIndex: number, target?: Target): Duel => {
  if (!canPlay(g, d, handIndex, target)) return d;
  const n = clone(d);
  playIn(g, n, handIndex, target);
  return n;
};

/** Whether this minion of the active side can attack this target now: guards must go first. */
export const canAttack = (d: Duel, attacker: number, target: Target): boolean => {
  if (d.phase !== 'playing') return false;
  const m = d.sides[d.active].board.find((x) => x.uid === attacker);
  if (!m || !m.canAttack || m.attack <= 0) return false;
  const foes = d.sides[other(d.active)].board;
  const guards = foes.filter((x) => x.guard);
  if (target === 'hero') return !guards.length;
  const t = foes.find((x) => x.uid === target);
  return !!t && (!guards.length || t.guard);
};

const attackIn = (g: CardGame, d: Duel, attacker: number, target: Target) => {
  const side = d.active;
  const foe = other(side);
  const m = d.sides[side].board.find((x) => x.uid === attacker)!;
  m.canAttack = false;
  const name = (x: Minion) => cardOf(g, x.cardId)?.name ?? 'a minion';
  if (target === 'hero') {
    say(d, `${who(side) === 'You' ? 'Your' : 'Their'} ${name(m)} hit ${side === 'blue' ? 'their' : 'your'} hero for ${m.attack}.`);
    hit(g, d, foe, 'hero', m.attack);
    return;
  }
  const t = d.sides[foe].board.find((x) => x.uid === target)!;
  say(d, `${who(side) === 'You' ? 'Your' : 'Their'} ${name(m)} fought ${name(t)}.`);
  const back = t.attack;
  hit(g, d, foe, target, m.attack);
  hit(g, d, side, attacker, back);
};

/** A minion of the active side attacks. Unchanged if it can't. */
export const attack = (g: CardGame, d: Duel, attacker: number, target: Target): Duel => {
  if (!canAttack(d, attacker, target)) return d;
  const n = clone(d);
  attackIn(g, n, attacker, target);
  return n;
};

/** End the active side's turn; the other side's begins. */
export const endTurn = (g: CardGame, d: Duel): Duel => {
  if (d.phase !== 'playing') return d;
  const n = clone(d);
  startTurn(g, n, other(n.active));
  return n;
};

/** The target the studio picks for a card it wants to play, or null to hold it. */
const pickTarget = (g: CardGame, d: Duel, c: Card): Target | undefined | null => {
  const me = d.sides[d.active];
  const foe = d.sides[other(d.active)];
  const e = c.effect;
  if (e.kind === 'damage' && e.amount > 0) {
    if (foe.hero <= e.amount) return 'hero';
    const kills = foe.board.filter((m) => m.health <= e.amount).sort((a, b) => b.attack - a.attack);
    if (kills.length) return kills[0]!.uid;
    return 'hero';
  }
  if (e.kind === 'buff' && e.amount > 0) {
    if (!me.board.length) return c.kind === 'minion' ? undefined : null;
    return [...me.board].sort((a, b) => Number(b.canAttack) - Number(a.canAttack) || b.attack - a.attack)[0]!.uid;
  }
  if (c.kind === 'spell') {
    if (e.kind === 'damageAll') return foe.board.length >= 2 || foe.board.some((m) => m.health <= e.amount) ? undefined : null;
    if (e.kind === 'heal') return g.rules.heroHealth - me.hero >= Math.ceil(e.amount / 2) ? undefined : null;
    if (e.kind === 'draw') return me.hand.length + e.amount <= g.rules.handMax ? undefined : null;
  }
  return undefined;
};

/**
 * The studio's whole turn: play the dearest cards it can afford, each aimed
 * sensibly (kill the strongest minion a spell can, buff what can attack),
 * then attack: through guards first, at the hero when that wins, trades
 * that kill and survive, and the rest at the hero. Ends the turn.
 */
export const opponentTurn = (g: CardGame, prev: Duel): Duel => {
  if (prev.phase !== 'playing') return prev;
  const d = clone(prev);
  const side = d.active;
  for (let guard = 0; guard < 20 && d.phase === 'playing'; guard++) {
    const me = d.sides[side];
    const order = me.hand.map((id, i) => ({ i, c: cardOf(g, id) })).filter((x): x is { i: number; c: Card } => !!x.c && x.c.cost <= me.mana).sort((a, b) => b.c.cost - a.c.cost);
    let done = false;
    for (const { i, c } of order) {
      const target = pickTarget(g, d, c);
      if (target === null || !canPlay(g, d, i, target)) continue;
      playIn(g, d, i, target);
      done = true;
      break;
    }
    if (!done) break;
  }
  for (let guard = 0; guard < 20 && d.phase === 'playing'; guard++) {
    const me = d.sides[side];
    const foe = d.sides[other(side)];
    const ready = me.board.filter((m) => m.canAttack && m.attack > 0).sort((a, b) => b.attack - a.attack);
    const m = ready[0];
    if (!m) break;
    const guards = foe.board.filter((x) => x.guard);
    let target: Target;
    if (guards.length) {
      const kill = guards.filter((x) => x.health <= m.attack).sort((a, b) => b.attack - a.attack)[0];
      target = (kill ?? [...guards].sort((a, b) => a.health - b.health)[0]!).uid;
    } else if (ready.reduce((n, x) => n + x.attack, 0) >= foe.hero) target = 'hero';
    else {
      const trade = foe.board.filter((x) => x.health <= m.attack && x.attack < m.health).sort((a, b) => b.attack - a.attack)[0];
      target = trade ? trade.uid : 'hero';
    }
    attackIn(g, d, m.uid, target);
  }
  if (d.phase === 'playing') startTurn(g, d, other(side));
  return d;
};

export interface DuelResult {
  winner: Side | 'draw';
  turns: number;
  first: Side;
  played: Record<Side, string[]>;
}

/** The studio plays both sides, start to finish. */
export const runDuel = (g: CardGame, seed = 1, first: Side = 'blue'): DuelResult => {
  let d = createDuel(g, seed, first);
  while (d.phase === 'playing') d = opponentTurn(g, d);
  return { winner: d.winner ?? 'draw', turns: d.turn, first, played: { blue: d.sides.blue.played, red: d.sides.red.played } };
};

export interface CardStat {
  cardId: string;
  /** Games it was played in, by either side. */
  games: number;
  /** Of those, games the side that played it won. */
  wins: number;
}

export interface CardReport {
  games: number;
  wins: Record<Side | 'draw', number>;
  /** Of the games someone won, the share the side that went first won. */
  firstShare: number;
  /** Turns a game, both sides together, on average. */
  turns: number;
  cards: CardStat[];
}

/** The studio plays the two decks against each other many times, each going first in turn, and sums it up. */
export const cardReport = (g: CardGame, games = 100): CardReport => {
  const wins = { blue: 0, red: 0, draw: 0 };
  let firstWins = 0;
  let turns = 0;
  const stats = new Map(g.cards.map((c) => [c.id, { cardId: c.id, games: 0, wins: 0 }]));
  for (let i = 0; i < games; i++) {
    const r = runDuel(g, i + 1, i % 2 ? 'red' : 'blue');
    wins[r.winner]++;
    if (r.winner === r.first) firstWins++;
    turns += r.turns;
    for (const side of ['blue', 'red'] as const)
      for (const id of new Set(r.played[side])) {
        const st = stats.get(id);
        if (!st) continue;
        st.games++;
        if (r.winner === side) st.wins++;
      }
  }
  const decided = wins.blue + wins.red;
  return { games, wins, firstShare: decided ? firstWins / decided : 0.5, turns: games ? turns / games : 0, cards: [...stats.values()] };
};

/** How many cards of each cost a deck holds, 0 to the most mana (dearer ones count at the top). */
export const manaCurve = (g: CardGame, side: Side): number[] => {
  const top = Math.min(10, g.rules.manaMax);
  const out = Array.from({ length: top + 1 }, () => 0);
  for (const id of g.decks[side]) {
    const c = cardOf(g, id);
    if (c) out[Math.min(top, Math.max(0, c.cost))]!++;
  }
  return out;
};
