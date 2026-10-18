import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Card game (game modules): a one-on-one duel. Two heroes, a deck each,
 * mana that grows a crystal a turn; minions fight on the board and spells
 * do one thing well. The designer roughs in the rules, the cards and the
 * decks, then plays the studio's opponent and reads how the cards do over
 * many games (sim.ts); the handoff sends it to the engine as data.
 */

export type Side = 'blue' | 'red';

/** What a spell does, or a minion when it is played. */
export type EffectKind = 'none' | 'damage' | 'damageAll' | 'heal' | 'draw' | 'buff';

export interface Effect {
  kind: EffectKind;
  /** Damage, healing, cards drawn, or the +attack/+health a buff gives. */
  amount: number;
}

export interface Card {
  id: string;
  name: string;
  cost: number;
  kind: 'minion' | 'spell';
  /** Minions only. */
  attack: number;
  health: number;
  /** Enemies must attack it before anything else. */
  guard: boolean;
  /** Can attack the turn it is played. */
  charge: boolean;
  /** A spell's effect, or a minion's when it is played. */
  effect: Effect;
  notes?: string;
}

export interface Rules {
  heroHealth: number;
  /** Mana on the first turn, how much more each turn, and the most. */
  manaStart: number;
  manaGrowth: number;
  manaMax: number;
  /** Cards in the opening hand; the side that goes second gets one more. */
  startHand: number;
  handMax: number;
  boardMax: number;
  /** Copies of one card a deck may hold. */
  maxCopies: number;
}

export interface CardGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  rules: Rules;
  cards: Card[];
  /** Card ids, a copy each entry. */
  decks: Record<Side, string[]>;
}

const none: Effect = { kind: 'none', amount: 0 };
const minion = (name: string, cost: number, attack: number, health: number, s: Partial<Card> = {}): Card => ({ id: newId('cd'), name, cost, kind: 'minion', attack, health, guard: false, charge: false, effect: none, ...s });
const spell = (name: string, cost: number, effect: Effect): Card => ({ id: newId('cd'), name, cost, kind: 'spell', attack: 0, health: 0, guard: false, charge: false, effect });

/** A small playable start to sculpt from: thirteen cards, both sides with the same twenty-card deck. */
export const starterCards = (): CardGame => {
  const squire = minion('Squire', 1, 1, 2);
  const scout = minion('Scout', 1, 2, 1, { charge: true });
  const shieldbearer = minion('Shieldbearer', 2, 1, 4, { guard: true });
  const wolf = minion('Wolf', 2, 3, 2);
  const archer = minion('Archer', 3, 2, 3, { effect: { kind: 'damage', amount: 1 } });
  const knight = minion('Knight', 4, 4, 5, { guard: true });
  const ogre = minion('Ogre', 5, 6, 5);
  const dragon = minion('Dragon', 7, 7, 7, { charge: true });
  const firebolt = spell('Firebolt', 1, { kind: 'damage', amount: 2 });
  const mend = spell('Mend', 2, { kind: 'heal', amount: 5 });
  const rally = spell('Rally', 2, { kind: 'buff', amount: 2 });
  const insight = spell('Insight', 3, { kind: 'draw', amount: 2 });
  const flameWave = spell('Flame wave', 4, { kind: 'damageAll', amount: 2 });
  const deck = [squire, scout, shieldbearer, wolf, archer, knight, ogre, firebolt, rally, flameWave].flatMap((c) => [c.id, c.id]);
  return {
    concept: { premise: '', platform: 'mobile' },
    rules: { heroHealth: 20, manaStart: 1, manaGrowth: 1, manaMax: 10, startHand: 3, handMax: 8, boardMax: 6, maxCopies: 2 },
    cards: [squire, scout, shieldbearer, wolf, archer, knight, ogre, dragon, firebolt, mend, rally, insight, flameWave],
    decks: { blue: [...deck], red: [...deck] },
  };
};

/** A new card game project: the starter game to sculpt from, with its premise. */
export const createCardProject = (name: string, premise = ''): Project => {
  const g = starterCards();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'cards', cards: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the card game; starts one from the starter if there is none. */
export const updateCards = (project: Project, change: (game: CardGame) => CardGame): Project => ({ ...project, cards: change(project.cards ?? starterCards()) });

export const newMinion = (): Card => minion('New minion', 2, 2, 2);
export const newSpell = (): Card => spell('New spell', 2, { kind: 'damage', amount: 2 });

/** A card's rules text, written from its numbers. */
export const cardText = (c: Card): string => {
  const parts: string[] = [];
  if (c.kind === 'minion') {
    if (c.guard) parts.push('Guard.');
    if (c.charge) parts.push('Charge.');
  }
  const e = c.effect;
  const lead = c.kind === 'minion' ? 'When played: ' : '';
  const say = (t: string) => parts.push(lead + t);
  if (e.kind === 'damage' && e.amount) say(`Deal ${e.amount} damage to an enemy.`);
  if (e.kind === 'damageAll' && e.amount) say(`Deal ${e.amount} damage to every enemy minion.`);
  if (e.kind === 'heal' && e.amount) say(`Restore ${e.amount} health to your hero.`);
  if (e.kind === 'draw' && e.amount) say(`Draw ${e.amount === 1 ? 'a card' : `${e.amount} cards`}.`);
  if (e.kind === 'buff' && e.amount) say(`Give a friendly minion +${e.amount}/+${e.amount}.`);
  return parts.join(' ');
};

/**
 * What a card is worth against the usual curve: a minion's attack and
 * health together, a point for each keyword, and its effect, against twice
 * its cost and one. Above 0 is better than the curve; below, worse.
 */
export const curveDelta = (c: Card): number => {
  const e = c.effect;
  const effect = e.kind === 'damage' ? e.amount * 1.5 : e.kind === 'damageAll' ? e.amount * 3 : e.kind === 'heal' ? e.amount * 0.6 : e.kind === 'draw' ? e.amount * 2 : e.kind === 'buff' ? e.amount * 2 : 0;
  const body = c.kind === 'minion' ? c.attack + c.health + (c.guard ? 1 : 0) + (c.charge ? 1 : 0) : 0;
  return Math.round((body + effect - (2 * c.cost + 1)) * 10) / 10;
};

export interface CardIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop the game working, or likely make it no fun. */
export const cardIssues = (g: CardGame): CardIssue[] => {
  const out: CardIssue[] = [];
  const err = (message: string) => out.push({ severity: 'error', message });
  const warn = (message: string) => out.push({ severity: 'warning', message });
  const r = g.rules;
  if (r.heroHealth < 1) err('Heroes need health.');
  if (r.manaMax < 1 || r.manaGrowth < 0 || r.manaStart < 0) err('Mana needs a start, a growth and a most.');
  if (r.boardMax < 1) err('The board needs room for a minion.');
  if (g.cards.length < 2) err('Add some cards.');
  const ids = new Set(g.cards.map((c) => c.id));
  for (const c of g.cards) {
    if (c.cost > r.manaMax) err(`${c.name} costs ${c.cost}, more than the most mana (${r.manaMax}).`);
    if (c.kind === 'minion' && c.health < 1) err(`${c.name} needs at least 1 health.`);
    if (c.kind === 'spell' && (c.effect.kind === 'none' || c.effect.amount <= 0)) err(`${c.name} is a spell that does nothing.`);
  }
  for (const side of ['blue', 'red'] as const) {
    const who = side === 'blue' ? 'The player’s deck' : 'The opponent’s deck';
    const deck = g.decks[side];
    if (!deck.length) err(`${who} is empty.`);
    else if (deck.length < 10) warn(`${who} has ${deck.length} cards: games will end in fatigue.`);
    if (deck.some((id) => !ids.has(id))) err(`${who} has a card that no longer exists.`);
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) if (n > r.maxCopies) warn(`${who} has ${n} copies of ${g.cards.find((c) => c.id === id)?.name ?? 'a card'}; the rules allow ${r.maxCopies}.`);
    if (deck.length && !deck.some((id) => (g.cards.find((c) => c.id === id)?.cost ?? 99) <= Math.max(1, r.manaStart + r.manaGrowth))) warn(`${who} has nothing cheap enough to play on the first two turns.`);
  }
  return out;
};
