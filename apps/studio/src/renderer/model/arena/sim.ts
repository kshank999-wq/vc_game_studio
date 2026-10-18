import { ARENA, laneXs, type ArenaGame, type Side, type TowerStats, type Unit } from './arena';

/**
 * The arena running: energy builds for both sides; units played walk at the
 * nearest enemy they can hit (or, for those that go only for buildings, the
 * nearest tower), stop in range and hit; towers hit the nearest unit in
 * range. A keep knocked down ends the match; at time, more towers down wins.
 * One step function drives the play preview (the player against the studio's
 * opponent), a match between two opponents, and the matchup check, so what
 * the designer plays is what the numbers say.
 */

export interface Fighter {
  uid: number;
  side: Side;
  unitId: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  cooldown: number;
}

export interface ArenaTower {
  id: string;
  side: Side;
  kind: 'keep' | 'guard';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cooldown: number;
}

export interface Strike {
  from: [number, number];
  to: [number, number];
  side: Side;
  age: number;
}

export interface ArenaState {
  t: number;
  phase: 'running' | 'over';
  winner?: Side | 'draw';
  /** How it ended. */
  reason?: 'keep' | 'towers' | 'time' | 'wiped' | 'through';
  energy: Record<Side, number>;
  fighters: Fighter[];
  towers: ArenaTower[];
  /** The next card each side's deck will play, for the studio's opponent. */
  next: Record<Side, number>;
  strikes: Strike[];
  nextUid: number;
  /** Seconds a match runs; 0: until one side is gone or breaks through (the matchup check). */
  limit: number;
}

const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
const RADIUS = { tower: 0.6, fighter: 0.3 };
/** How far a unit looks for an enemy unit before it heads for a tower. */
const SIGHT = 5;

/** Where a side's keep and guard towers stand. Blue is the bottom of the field. */
export const towersFor = (g: ArenaGame): ArenaTower[] => {
  const make = (side: Side, kind: 'keep' | 'guard', x: number, fromEdge: number, s: TowerStats, id: string): ArenaTower => ({ id, side, kind, x, y: side === 'blue' ? ARENA.length - fromEdge : fromEdge, hp: s.health, maxHp: s.health, cooldown: 0 });
  return (['blue', 'red'] as const).flatMap((side) => [make(side, 'keep', ARENA.width / 2, ARENA.keepY, g.keep, `${side}-keep`), ...laneXs(g.match.lanes).map((x, i) => make(side, 'guard', x, ARENA.guardY, g.guard, `${side}-${i}`))]);
};

/** A fresh match: towers up, energy at the start. */
export const createArena = (g: ArenaGame): ArenaState => ({
  t: 0,
  phase: 'running',
  energy: { blue: g.match.energyStart, red: g.match.energyStart },
  fighters: [],
  towers: towersFor(g),
  next: { blue: 0, red: 0 },
  strikes: [],
  nextUid: 1,
  limit: g.match.length,
});

/** The half of the field a side may play on. */
export const ownHalf = (side: Side): [number, number] => (side === 'blue' ? [ARENA.length / 2 + 0.5, ARENA.length - 0.5] : [0.5, ARENA.length / 2 - 0.5]);

/** Play a unit at a point on the side's half. Unchanged if the side can't afford it, or the match is over. */
export const deploy = (g: ArenaGame, s: ArenaState, side: Side, unitId: string, x: number, y: number, free = false): ArenaState => {
  const u = g.units.find((v) => v.id === unitId);
  if (!u || s.phase !== 'running' || (!free && s.energy[side] < u.cost)) return s;
  const [lo, hi] = ownHalf(side);
  const cx = Math.max(0.4, Math.min(ARENA.width - 0.4, x));
  const cy = Math.max(lo, Math.min(hi, y));
  const n = Math.max(1, Math.round(u.count));
  const fighters = Array.from({ length: n }, (_, i): Fighter => {
    const a = (i / n) * Math.PI * 2;
    const r = n > 1 ? 0.4 : 0;
    return { uid: s.nextUid + i, side, unitId: u.id, hp: u.health, maxHp: u.health, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, cooldown: 0.5 };
  });
  return { ...s, energy: { ...s.energy, [side]: s.energy[side] - (free ? 0 : u.cost) }, fighters: [...s.fighters, ...fighters], nextUid: s.nextUid + n };
};

/**
 * The studio's opponent: plays its deck in order as the energy comes. With
 * enemies on its half, it plays in front of its tower in their lane; else
 * it plays behind its guard in the lane whose enemy guard is weakest.
 */
export const opponentMove = (g: ArenaGame, s: ArenaState, side: Side): ArenaState => {
  const deck = g.decks[side].filter((id) => g.units.some((u) => u.id === id));
  if (!deck.length || s.phase !== 'running') return s;
  const id = deck[s.next[side] % deck.length]!;
  const u = g.units.find((v) => v.id === id)!;
  if (s.energy[side] < u.cost) return s;
  const lanes = laneXs(g.match.lanes);
  const nearestLane = (x: number) => lanes.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const [lo, hi] = ownHalf(side);
  const threats = s.fighters.filter((f) => f.side !== side && f.y >= lo && f.y <= hi);
  let x: number;
  let y: number;
  if (threats.length) {
    const front = threats.reduce((a, b) => (side === 'blue' ? (b.y > a.y ? b : a) : b.y < a.y ? b : a));
    x = nearestLane(front.x);
    y = side === 'blue' ? Math.max(lo, front.y + 1.5) : Math.min(hi, front.y - 1.5);
  } else {
    const guards = s.towers.filter((t) => t.side !== side && t.kind === 'guard' && t.hp > 0);
    const weakest = guards.reduce<ArenaTower | undefined>((a, b) => (!a || b.hp < a.hp ? b : a), undefined);
    x = weakest ? weakest.x : ARENA.width / 2;
    y = side === 'blue' ? ARENA.length - 1.2 : 1.2;
  }
  const after = deploy(g, s, side, id, x, y);
  return after === s ? s : { ...after, next: { ...after.next, [side]: s.next[side] + 1 } };
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Move the match on by dt seconds; the sides in `opponents` are played by the studio. Returns a new state; the old one is left as it was. */
export const stepArena = (g: ArenaGame, prev: ArenaState, dt: number, opponents: readonly Side[] = ['red']): ArenaState => {
  if (prev.phase === 'over') return prev;
  let s: ArenaState = {
    ...prev,
    t: prev.t + dt,
    energy: { blue: Math.min(g.match.energyMax, prev.energy.blue + g.match.energyRate * dt), red: Math.min(g.match.energyMax, prev.energy.red + g.match.energyRate * dt) },
    fighters: prev.fighters.map((f) => ({ ...f })),
    towers: prev.towers.map((t) => ({ ...t })),
    strikes: prev.strikes.map((x) => ({ ...x, age: x.age + dt })).filter((x) => x.age < 0.2),
  };
  for (const side of opponents) s = opponentMove(g, s, side);
  const unitOf = new Map(g.units.map((u) => [u.id, u]));
  const canHit = (u: Unit, f: Fighter) => !unitOf.get(f.unitId)?.flying || u.hitsAir;
  const hitFighter = (f: Fighter, dmg: number) => {
    f.hp -= dmg;
  };
  // Units.
  for (const f of s.fighters) {
    if (f.hp <= 0) continue;
    const u = unitOf.get(f.unitId);
    if (!u) continue;
    f.cooldown = Math.max(0, f.cooldown - dt);
    const towers = s.towers.filter((t) => t.side !== f.side && t.hp > 0);
    const foes = u.buildingsOnly ? [] : s.fighters.filter((e) => e.side !== f.side && e.hp > 0 && canHit(u, e) && dist(e, f) <= Math.max(SIGHT, u.range + RADIUS.fighter));
    const nearFoe = foes.reduce<Fighter | undefined>((a, b) => (!a || dist(b, f) < dist(a, f) ? b : a), undefined);
    const nearTower = towers.reduce<ArenaTower | undefined>((a, b) => (!a || dist(b, f) < dist(a, f) ? b : a), undefined);
    const target: { x: number; y: number; r: number } | undefined = nearFoe ? { ...nearFoe, r: RADIUS.fighter } : nearTower ? { ...nearTower, r: RADIUS.tower } : undefined;
    // Nothing to fight: march for the far edge (in the matchup check, that is getting through).
    const goal = target ?? { x: f.x, y: f.side === 'blue' ? 0 : ARENA.length, r: 0 };
    const d = dist(goal, f) - goal.r;
    if (target && d <= u.range) {
      if (f.cooldown > 0) continue;
      f.cooldown = 1 / Math.max(0.01, u.rate);
      s.strikes.push({ from: [f.x, f.y], to: [target.x, target.y], side: f.side, age: 0 });
      if (nearFoe) {
        hitFighter(nearFoe, u.damage);
        if (u.splash > 0) for (const e of s.fighters) if (e !== nearFoe && e.side !== f.side && e.hp > 0 && canHit(u, e) && dist(e, nearFoe) <= u.splash) hitFighter(e, u.damage);
      } else if (nearTower) nearTower.hp -= u.damage;
      continue;
    }
    const step = Math.min(u.speed * dt, Math.max(0, d));
    const len = dist(goal, f) || 1;
    f.x += ((goal.x - f.x) / len) * step;
    f.y += ((goal.y - f.y) / len) * step;
    if (!target && (f.side === 'blue' ? f.y <= 0.3 : f.y >= ARENA.length - 0.3)) {
      return { ...s, phase: 'over', winner: f.side, reason: 'through' };
    }
  }
  // Towers.
  for (const t of s.towers) {
    if (t.hp <= 0) continue;
    const stats = t.kind === 'keep' ? g.keep : g.guard;
    t.cooldown = Math.max(0, t.cooldown - dt);
    if (t.cooldown > 0) continue;
    const foe = s.fighters.filter((e) => e.side !== t.side && e.hp > 0 && dist(e, t) <= stats.range).reduce<Fighter | undefined>((a, b) => (!a || dist(b, t) < dist(a, t) ? b : a), undefined);
    if (!foe) continue;
    foe.hp -= stats.damage;
    t.cooldown = 1 / Math.max(0.01, stats.rate);
    s.strikes.push({ from: [t.x, t.y], to: [foe.x, foe.y], side: t.side, age: 0 });
  }
  s.fighters = s.fighters.filter((f) => f.hp > 0);
  for (const t of s.towers) t.hp = Math.max(0, t.hp);
  // A keep down ends it.
  const keepDown = s.towers.find((t) => t.kind === 'keep' && t.hp <= 0);
  if (keepDown) return { ...s, phase: 'over', winner: other(keepDown.side), reason: 'keep' };
  if (s.limit > 0 && s.t >= s.limit) {
    const down = towersDown(s);
    const winner = down.red > down.blue ? 'blue' : down.blue > down.red ? 'red' : 'draw';
    return { ...s, phase: 'over', winner, reason: winner === 'draw' ? 'time' : 'towers' };
  }
  // The matchup check: no towers, and one side is gone.
  if (!s.towers.length) {
    const blue = s.fighters.some((f) => f.side === 'blue');
    const red = s.fighters.some((f) => f.side === 'red');
    if (!blue || !red) return { ...s, phase: 'over', winner: blue ? 'blue' : red ? 'red' : 'draw', reason: 'wiped' };
  }
  return s;
};

/** Towers each side has lost. */
export const towersDown = (s: ArenaState): Record<Side, number> => ({
  blue: s.towers.filter((t) => t.side === 'blue' && t.hp <= 0).length,
  red: s.towers.filter((t) => t.side === 'red' && t.hp <= 0).length,
});

export interface MatchResult {
  winner: Side | 'draw';
  reason: ArenaState['reason'];
  seconds: number;
  down: Record<Side, number>;
}

/** Both decks played by the studio's opponent, start to finish. */
export const runMatch = (g: ArenaGame, dt = 0.05): MatchResult => {
  let s = createArena(g);
  while (s.phase === 'running') s = stepArena(g, s, dt, ['blue', 'red']);
  return { winner: s.winner ?? 'draw', reason: s.reason, seconds: Math.round(s.t), down: towersDown(s) };
};

/** Energy each side spends in a matchup: as many plays of each unit as it buys, at least one. */
export const MATCHUP_ENERGY = 6;

export interface Matchup {
  /** Who came out on top: the row's unit (a), the column's (b), or neither. */
  winner: 'a' | 'b' | 'draw';
  /** How the winner got there: the other side wiped out, or it walked through to the far edge. */
  how: 'wiped' | 'through' | 'time';
  /** The winner's health left, as a share of what it started with. */
  left: number;
}

/** One side's units against the other's in the middle of an empty field, the same energy spent on each, 40 seconds at most. */
const skirmish = (g: ArenaGame, blueUnit: Unit, redUnit: Unit, dt: number): { winner: Side | 'draw'; how: Matchup['how']; left: number } => {
  const plays = (u: Unit) => Math.max(1, Math.round(MATCHUP_ENERGY / Math.max(0.5, u.cost)));
  let s: ArenaState = { ...createArena(g), towers: [], limit: 40, energy: { blue: 0, red: 0 } };
  for (let i = 0; i < plays(blueUnit); i++) s = deploy(g, s, 'blue', blueUnit.id, ARENA.width / 2 + (i - (plays(blueUnit) - 1) / 2) * 0.9, ARENA.length / 2 + 2, true);
  for (let i = 0; i < plays(redUnit); i++) s = deploy(g, s, 'red', redUnit.id, ARENA.width / 2 + (i - (plays(redUnit) - 1) / 2) * 0.9, ARENA.length / 2 - 2, true);
  const full = (side: Side) => s.fighters.filter((f) => f.side === side).reduce((n, f) => n + f.maxHp, 0);
  const start = { blue: full('blue'), red: full('red') };
  while (s.phase === 'running') s = stepArena(g, s, dt, []);
  const w = s.winner ?? 'draw';
  if (w === 'draw') return { winner: 'draw', how: 'time', left: 0 };
  return { winner: w, how: s.reason === 'through' ? 'through' : 'wiped', left: s.fighters.filter((f) => f.side === w).reduce((n, f) => n + f.hp, 0) / Math.max(1, start[w]) };
};

/**
 * Unit a against unit b, the same energy spent on each, played from both
 * ends of the field. A side that wins from one end and loses from the other
 * is too close to call: a draw.
 */
export const matchup = (g: ArenaGame, a: Unit, b: Unit, dt = 0.05): Matchup => {
  if (a.id === b.id) return { winner: 'draw', how: 'time', left: 0 };
  const one = skirmish(g, a, b, dt);
  const two = skirmish(g, b, a, dt);
  const aWins = [one.winner === 'blue' && one, two.winner === 'red' && two].filter((x): x is NonNullable<typeof one> => !!x);
  const bWins = [one.winner === 'red' && one, two.winner === 'blue' && two].filter((x): x is NonNullable<typeof one> => !!x);
  const wins = aWins.length === 2 ? aWins : bWins.length === 2 ? bWins : null;
  if (!wins) return { winner: 'draw', how: 'time', left: 0 };
  return { winner: wins === aWins ? 'a' : 'b', how: wins.some((x) => x.how === 'through') ? 'through' : 'wiped', left: Math.round(((wins[0]!.left + wins[1]!.left) / 2) * 100) / 100 };
};

/** Every unit against every other: the matchup table. */
export const matchups = (g: ArenaGame): Matchup[][] => g.units.map((a) => g.units.map((b) => matchup(g, a, b)));
