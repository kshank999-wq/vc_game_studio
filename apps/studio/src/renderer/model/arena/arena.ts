import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Head-to-head arena (game modules): two sides face each other on one field,
 * each with a keep and a guard tower in every lane. Players spend energy
 * that builds up over time to send units down the lanes to knock the other
 * side's towers down. The designer roughs in the field, the units, the
 * energy and the decks, then plays the studio's opponent and reads the
 * matchups (sim.ts); the handoff sends it to the engine as data.
 */

/** The field, in units: the player's side at the bottom (blue), the opponent's at the top (red). */
export const ARENA = { width: 9, length: 16, keepY: 1.5, guardY: 3.5 } as const;

export type Side = 'blue' | 'red';

export interface TowerStats {
  health: number;
  /** Damage a hit. */
  damage: number;
  /** Hits a second. */
  rate: number;
  /** Reach, in units. */
  range: number;
}

export interface Unit {
  id: string;
  name: string;
  /** Energy to play it. */
  cost: number;
  /** How many come when it is played. */
  count: number;
  health: number;
  damage: number;
  rate: number;
  range: number;
  /** Units a second. */
  speed: number;
  /** Damage also lands on enemies this far round the target. 0: one target. */
  splash: number;
  /** Goes only for towers, walking past units. */
  buildingsOnly: boolean;
  flying: boolean;
  hitsAir: boolean;
  notes?: string;
}

export interface Match {
  /** 1, 2 or 3 lanes. */
  lanes: number;
  /** Seconds; at the end, the side that has knocked down more towers wins. */
  length: number;
  energyStart: number;
  energyMax: number;
  /** Energy a second. */
  energyRate: number;
}

export interface ArenaGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  keep: TowerStats;
  guard: TowerStats;
  units: Unit[];
  match: Match;
  /** The cards each side plays, in the order the studio's opponent plays them. */
  decks: Record<Side, string[]>;
}

const unit = (name: string, s: Partial<Unit>): Unit => ({ id: newId('un'), name, cost: 3, count: 1, health: 500, damage: 60, rate: 1, range: 0.8, speed: 1, splash: 0, buildingsOnly: false, flying: false, hitsAir: false, ...s });

/** A small playable start to sculpt from: two lanes, five units, both sides with the same deck. */
export const starterArena = (): ArenaGame => {
  const knight = unit('Knight', { cost: 3, health: 800, damage: 80, rate: 1, range: 0.8, speed: 1 });
  const archers = unit('Archers', { cost: 3, count: 2, health: 220, damage: 45, rate: 1, range: 4.5, speed: 1, hitsAir: true });
  const giant = unit('Giant', { cost: 5, health: 2200, damage: 130, rate: 0.66, range: 0.8, speed: 0.7, buildingsOnly: true });
  const bats = unit('Bats', { cost: 2, count: 3, health: 70, damage: 35, rate: 1.2, range: 0.6, speed: 1.8, flying: true, hitsAir: true });
  const bomber = unit('Bomber', { cost: 3, health: 280, damage: 110, rate: 0.6, range: 4, speed: 1, splash: 1.2 });
  const deck = [knight.id, archers.id, giant.id, bats.id, bomber.id];
  return {
    concept: { premise: '', platform: 'mobile' },
    keep: { health: 2400, damage: 60, rate: 1, range: 5 },
    guard: { health: 1200, damage: 45, rate: 1.2, range: 5 },
    units: [knight, archers, giant, bats, bomber],
    match: { lanes: 2, length: 180, energyStart: 5, energyMax: 10, energyRate: 0.36 },
    decks: { blue: [...deck], red: [...deck] },
  };
};

/** A new arena project: the starter game to sculpt from, with its premise. */
export const createArenaProject = (name: string, premise = ''): Project => {
  const g = starterArena();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'arena', arena: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the arena game; starts one from the starter if there is none. */
export const updateArena = (project: Project, change: (game: ArenaGame) => ArenaGame): Project => ({ ...project, arena: change(project.arena ?? starterArena()) });

export const newUnit = (): Unit => unit('New unit', {});

/** Where each lane runs, across the field. */
export const laneXs = (lanes: number): number[] => {
  const n = Math.max(1, Math.min(3, Math.round(lanes)));
  return Array.from({ length: n }, (_, i) => (ARENA.width * (i + 1)) / (n + 1));
};

export interface ArenaIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop the game working, or likely make it no fun. */
export const arenaIssues = (g: ArenaGame): ArenaIssue[] => {
  const out: ArenaIssue[] = [];
  const err = (message: string) => out.push({ severity: 'error', message });
  const warn = (message: string) => out.push({ severity: 'warning', message });
  if (g.units.length < 2) err('Add at least two units.');
  const ids = new Set(g.units.map((u) => u.id));
  for (const side of ['blue', 'red'] as const) {
    const who = side === 'blue' ? 'The player’s deck' : 'The opponent’s deck';
    const deck = g.decks[side];
    if (!deck.length) err(`${who} is empty.`);
    if (deck.some((id) => !ids.has(id))) err(`${who} has a unit that no longer exists.`);
    const cheapest = Math.min(...deck.flatMap((id) => g.units.filter((u) => u.id === id).map((u) => u.cost)));
    if (deck.length && cheapest > g.match.energyMax) err(`Nothing in ${who.toLowerCase()} costs less than the most energy a player can hold (${g.match.energyMax}).`);
  }
  for (const u of g.units) {
    if (u.health <= 0 || u.speed <= 0) err(`${u.name} needs health and a speed.`);
    if (u.damage <= 0 || u.rate <= 0 || u.range <= 0) err(`${u.name} can’t hurt anything: give it damage, a rate and a range.`);
    if (u.cost > g.match.energyMax) err(`${u.name} costs ${u.cost}, more than the most energy a player can hold (${g.match.energyMax}).`);
  }
  if (g.units.some((u) => u.flying) && !g.units.some((u) => u.hitsAir && !u.flying)) warn('Only flying units can hit flying units: ground decks have no answer to them but the towers.');
  if (g.match.energyRate <= 0) err('Energy never builds up: give it a rate.');
  if (g.match.length < 30) warn('A match under 30 seconds leaves little time to play.');
  return out;
};
