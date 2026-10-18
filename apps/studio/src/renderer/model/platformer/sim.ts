import { HERO, parseGrid, type Grid, type PlatformLevel, type PlatformRules } from './platformer';

/**
 * The platformer running, a frame at a time: the hero runs, jumps (from the
 * ground, or just after leaving it), falls, lands on solid tiles and on
 * one-way platforms from above, bumps its head; spikes, pits and enemies
 * from the side end a try, enemies stomped from above are gone. The same
 * frames drive the play preview, the map of where the hero can get to, and
 * the studio's careful player.
 */

export const DT = 1 / 60;

export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export const NONE: Input = { left: false, right: false, jump: false };

export interface HeroState {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  /** Frames a jump still works after leaving the ground. */
  coyote: number;
}

export interface Enemy {
  x: number;
  y: number;
  dir: 1 | -1;
  alive: boolean;
}

export interface World {
  hero: HeroState;
  enemies: Enemy[];
  /** Coin tiles picked up, by index. */
  got: number[];
  frame: number;
  phase: 'playing' | 'won' | 'dead';
  cause?: 'spikes' | 'fell' | 'enemy';
  stomped: number;
}

const tileAt = (g: Grid, x: number, y: number) => (x < 0 || x >= g.cols ? '#' : y < 0 || y >= g.rows ? '.' : g.tiles[y * g.cols + x]!);
const solid = (g: Grid, x: number, y: number) => tileAt(g, x, y) === '#';
const standOn = (g: Grid, x: number, y: number) => {
  const t = tileAt(g, x, y);
  return t === '#' || t === '=';
};

/** Where the hero's feet are. */
export const footCell = (h: HeroState): [number, number] => [Math.floor(h.x + HERO.width / 2), Math.floor(h.y + HERO.height - 0.01)];

/** The hero standing on a cell. */
export const heroOn = (cx: number, cy: number): HeroState => ({ x: cx + (1 - HERO.width) / 2, y: cy + 1 - HERO.height, vy: 0, grounded: true, coyote: 0 });

export const findTile = (g: Grid, t: string): [number, number] | null => {
  const i = g.tiles.indexOf(t as never);
  return i < 0 ? null : [i % g.cols, Math.floor(i / g.cols)];
};

/** A fresh try at a level: the hero at the start, the enemies where they are painted. */
export const createWorld = (g: Grid): World => {
  const s = findTile(g, 'S') ?? [1, 1];
  const enemies: Enemy[] = [];
  g.tiles.forEach((t, i) => {
    if (t === 'e') enemies.push({ x: (i % g.cols) + 0.1, y: Math.floor(i / g.cols) + 1 - 0.8, dir: 1, alive: true });
  });
  return { hero: { ...heroOn(s[0], s[1]), grounded: false }, enemies, got: [], frame: 0, phase: 'playing', stomped: 0 };
};

/** Move the hero one frame through the tiles. Returns the new hero and what it touched. */
export const stepHero = (r: PlatformRules, g: Grid, prev: HeroState, input: Input): { hero: HeroState; touched: number[]; dead?: 'spikes' | 'fell' } => {
  const p = r.hero;
  const h: HeroState = { ...prev };
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (input.jump && (h.grounded || h.coyote > 0)) {
    h.vy = -p.jumpSpeed;
    h.grounded = false;
    h.coyote = 0;
  }
  h.vy = Math.min(20, h.vy + p.gravity * DT);
  // Across, then up or down, each stopped by solid tiles.
  const nx = h.x + dir * p.runSpeed * DT;
  const top = Math.floor(h.y + 0.01);
  const bottom = Math.floor(h.y + HERO.height - 0.01);
  if (dir !== 0) {
    const lead = dir > 0 ? Math.floor(nx + HERO.width - 0.001) : Math.floor(nx);
    let blocked = false;
    for (let y = top; y <= bottom; y++) if (solid(g, lead, y)) blocked = true;
    h.x = blocked ? (dir > 0 ? lead - HERO.width : lead + 1) : nx;
  }
  const wasGrounded = h.grounded;
  const feetBefore = h.y + HERO.height;
  h.y += h.vy * DT;
  h.grounded = false;
  const left = Math.floor(h.x + 0.01);
  const right = Math.floor(h.x + HERO.width - 0.01);
  if (h.vy > 0) {
    const row = Math.floor(h.y + HERO.height);
    for (let x = left; x <= right; x++) {
      const t = tileAt(g, x, row);
      if (t === '#' || (t === '=' && feetBefore <= row + 0.02)) {
        h.y = row - HERO.height;
        h.vy = 0;
        h.grounded = true;
        break;
      }
    }
  } else if (h.vy < 0) {
    const row = Math.floor(h.y);
    for (let x = left; x <= right; x++)
      if (solid(g, x, row)) {
        h.y = row + 1;
        h.vy = 0;
        break;
      }
  }
  if (wasGrounded && !h.grounded && h.vy >= 0) h.coyote = Math.round(p.coyoteTime / DT);
  else if (h.coyote > 0) h.coyote--;
  const touched: number[] = [];
  let dead: 'spikes' | 'fell' | undefined;
  for (let y = Math.floor(h.y); y <= Math.floor(h.y + HERO.height - 0.01); y++)
    for (let x = Math.floor(h.x); x <= Math.floor(h.x + HERO.width - 0.01); x++) {
      const t = tileAt(g, x, y);
      if (t === 'o' || t === 'G') touched.push(y * g.cols + x);
      if (t === '^' && h.y + HERO.height > y + 0.5) dead = 'spikes';
    }
  if (h.y > g.rows + 1) dead = 'fell';
  return { hero: h, touched, dead };
};

const stepEnemy = (r: PlatformRules, g: Grid, e: Enemy): Enemy => {
  if (!e.alive) return e;
  const nx = e.x + e.dir * r.enemySpeed * DT;
  const row = Math.floor(e.y + 0.5);
  const lead = e.dir > 0 ? Math.floor(nx + 0.8) : Math.floor(nx);
  if (solid(g, lead, row) || !standOn(g, lead, row + 1)) return { ...e, dir: e.dir > 0 ? -1 : 1 };
  return { ...e, x: nx };
};

/** One frame of the whole level. Returns a new world; the old one is left as it was. */
export const stepWorld = (r: PlatformRules, g: Grid, prev: World, input: Input): World => {
  if (prev.phase !== 'playing') return prev;
  const w: World = { ...prev, frame: prev.frame + 1, enemies: prev.enemies.map((e) => stepEnemy(r, g, e)) };
  const { hero, touched, dead } = stepHero(r, g, prev.hero, input);
  w.hero = hero;
  if (dead) return { ...w, phase: 'dead', cause: dead };
  for (const i of touched) {
    if (g.tiles[i] === 'G') return { ...w, phase: 'won' };
    if (!w.got.includes(i)) w.got = [...w.got, i];
  }
  for (let k = 0; k < w.enemies.length; k++) {
    const e = w.enemies[k]!;
    if (!e.alive || hero.x + HERO.width <= e.x || hero.x >= e.x + 0.8 || hero.y + HERO.height <= e.y || hero.y >= e.y + 0.8) continue;
    if (prev.hero.vy > 0 && prev.hero.y + HERO.height <= e.y + 0.45) {
      w.enemies = w.enemies.map((x, j) => (j === k ? { ...x, alive: false } : x));
      w.hero = { ...w.hero, vy: -r.hero.jumpSpeed * 0.55, grounded: false };
      w.stomped++;
    } else return { ...w, phase: 'dead', cause: 'enemy' };
  }
  return w;
};

/** A move the map is made of: a run of inputs from standing on one cell. */
interface Move {
  inputs: Input[];
  jump: boolean;
}

const moveFrom = (r: PlatformRules, g: Grid, start: HeroState, pattern: (f: number, h: HeroState) => Input, maxFrames: number, stopWhen: (h: HeroState, f: number) => boolean) => {
  let h = start;
  const inputs: Input[] = [];
  const coins = new Set<number>();
  for (let f = 0; f < maxFrames; f++) {
    const input = pattern(f, h);
    inputs.push(input);
    const out = stepHero(r, g, h, input);
    h = out.hero;
    for (const i of out.touched) {
      if (g.tiles[i] === 'G') return { result: 'goal' as const, hero: h, inputs, coins };
      coins.add(i);
    }
    if (out.dead) return { result: 'dead' as const, hero: h, inputs, coins };
    if (stopWhen(h, f)) return { result: 'landed' as const, hero: h, inputs, coins };
  }
  return { result: 'timeout' as const, hero: h, inputs, coins };
};

const at = (d: number): Input => ({ left: d < 0, right: d > 0, jump: false });

/** Every move worth trying from a cell: a step either way, and jumps straight, either way, short and long, and up-then-over. */
const movesFrom = (r: PlatformRules, g: Grid, start: HeroState) => {
  const [cx] = footCell(start);
  const out: { move: Move; result: 'goal' | 'dead' | 'landed' | 'timeout'; hero: HeroState; coins: Set<number> }[] = [];
  const landed = (h: HeroState, f: number) => f > 2 && h.grounded;
  for (const d of [1, -1]) {
    // A step: hold the way until the feet are a cell over (or, off an edge, until landing).
    const target = cx + d;
    const res = moveFrom(r, g, start, () => at(d), 180, (h) => h.grounded && footCell(h)[0] === target && Math.abs(h.x + HERO.width / 2 - (target + 0.5)) < 0.12);
    out.push({ move: { inputs: res.inputs, jump: false }, result: res.result, hero: res.hero, coins: res.coins });
  }
  const patterns: ((f: number) => Input)[] = [];
  for (const d of [0, 1, -1]) {
    for (const hold of d === 0 ? [Infinity] : [Infinity, 8, 16, 24]) patterns.push((f) => ({ ...at(f < hold ? d : 0), jump: f === 0 }));
    if (d !== 0) for (const wait of [8, 16]) patterns.push((f) => ({ ...at(f >= wait ? d : 0), jump: f === 0 }));
  }
  for (const pat of patterns) {
    const res = moveFrom(r, g, start, pat, 240, landed);
    out.push({ move: { inputs: res.inputs, jump: true }, result: res.result, hero: res.hero, coins: res.coins });
  }
  return out;
};

export interface LevelMap {
  status: 'ready' | 'not ready';
  /** Whether the goal can be reached. */
  reachable: boolean;
  /** Cells the hero can stand on, as indices. */
  stand: number[];
  /** The route the studio found to the goal: its inputs from the start, frame by frame. */
  route: Input[];
  /** The moves of the route: where each starts and whether it is a jump. */
  steps: { from: [number, number]; jump: boolean; tight: boolean; inputs: Input[]; to: [number, number] | 'goal' }[];
  jumps: number;
  tight: number;
  coins: number;
  reachableCoins: number;
  /** Coin tiles no route picks up. */
  missedCoins: number[];
  /** Seconds the route takes, with no enemies in the way. */
  seconds: number;
}

const memo = new Map<string, LevelMap>();

/**
 * Map a level: every cell the hero can stand on, reached from the start by
 * steps and jumps, the fewest moves to the goal, and the coins it can get
 * to. Enemies are left out here; the careful player meets them.
 */
export const mapLevel = (r: PlatformRules, l: Pick<PlatformLevel, 'rows'>): LevelMap => {
  const key = JSON.stringify([r.hero, l.rows]);
  const hit = memo.get(key);
  if (hit) return hit;
  const g = parseGrid(l.rows);
  const empty: LevelMap = { status: 'not ready', reachable: false, stand: [], route: [], steps: [], jumps: 0, tight: 0, coins: 0, reachableCoins: 0, missedCoins: [], seconds: 0 };
  const s = findTile(g, 'S');
  const goal = findTile(g, 'G');
  const coins = g.tiles.flatMap((t, i) => (t === 'o' ? [i] : []));
  if (!s || !goal) return { ...empty, coins: coins.length, missedCoins: coins };
  // Drop from the start to the ground.
  const drop = moveFrom(r, g, { ...heroOn(s[0], s[1]), grounded: false }, () => NONE, 600, (h) => h.grounded);
  if (drop.result === 'dead' || drop.result === 'timeout') return { ...empty, status: 'ready', coins: coins.length, missedCoins: coins };
  // A place is where the hero stands, to a tenth of a tile across: landing a little off makes a different jump.
  const key2 = (h: HeroState) => `${Math.round(h.x * 10)}|${footCell(h)[1]}`;
  type Node = { hero: HeroState; prev: string | null; move: Move | null };
  const nodes = new Map<string, Node>([[key2(drop.hero), { hero: drop.hero, prev: null, move: null }]]);
  const got = new Set<number>(drop.coins);
  const queue: string[] = [key2(drop.hero)];
  let goalAt: { prev: string; move: Move } | null = null;
  const standCells = new Set<number>();
  const fullCoins = drop.result === 'goal';
  while (queue.length) {
    const k = queue.shift()!;
    const n = nodes.get(k)!;
    const [fx, fy] = footCell(n.hero);
    standCells.add(fy * g.cols + fx);
    for (const m of movesFrom(r, g, n.hero)) {
      if (m.result === 'dead' || m.result === 'timeout') continue;
      for (const coin of m.coins) got.add(coin);
      if (m.result === 'goal') {
        if (!goalAt) goalAt = { prev: k, move: m.move };
        continue;
      }
      const nk = key2(m.hero);
      if (!nodes.has(nk)) {
        nodes.set(nk, { hero: m.hero, prev: k, move: m.move });
        queue.push(nk);
      }
    }
    if (nodes.size > 4000) break;
  }
  const stand = [...standCells];
  const reachableCoins = coins.filter((c) => got.has(c)).length;
  const missedCoins = coins.filter((c) => !got.has(c));
  if (!goalAt && !fullCoins) {
    const r0: LevelMap = { ...empty, status: 'ready', stand, coins: coins.length, reachableCoins, missedCoins };
    memo.set(key, r0);
    return r0;
  }
  const chain: { from: HeroState; move: Move; to: [number, number] | 'goal' }[] = [];
  if (goalAt) {
    let k: string | null = goalAt.prev;
    chain.unshift({ from: nodes.get(k)!.hero, move: goalAt.move, to: 'goal' });
    while (k) {
      const n: Node = nodes.get(k)!;
      if (!n.prev || !n.move) break;
      chain.unshift({ from: nodes.get(n.prev)!.hero, move: n.move, to: footCell(n.hero) });
      k = n.prev;
    }
  }
  const steps = chain.map((c) => {
    // Tight: the same inputs from a quarter tile either side don't make it.
    let tight = false;
    if (c.move.jump)
      for (const dx of [-0.25, 0.25]) {
        let i = 0;
        const res = moveFrom(r, g, { ...c.from, x: c.from.x + dx }, () => c.move.inputs[Math.min(i++, c.move.inputs.length - 1)] ?? NONE, c.move.inputs.length + 60, (h, f) => f >= c.move.inputs.length - 1 && h.grounded);
        if (res.result === 'dead' || res.result === 'timeout' || (res.result === 'landed' && c.to !== 'goal' && footCell(res.hero)[1] > c.to[1])) tight = true;
      }
    return { from: footCell(c.from), jump: c.move.jump, tight, inputs: c.move.inputs, to: c.to };
  });
  const route = [...drop.inputs, ...steps.flatMap((s2) => s2.inputs)];
  const out: LevelMap = { status: 'ready', reachable: true, stand, route, steps, jumps: steps.filter((s2) => s2.jump).length, tight: steps.filter((s2) => s2.tight).length, coins: coins.length, reachableCoins, missedCoins, seconds: Math.round(route.length * DT * 10) / 10 };
  if (memo.size > 100) memo.clear();
  memo.set(key, out);
  return out;
};

/** The route traced as points the hero passes, for drawing over the level. */
export const routeTrace = (r: PlatformRules, l: Pick<PlatformLevel, 'rows'>): [number, number][] => {
  const m = mapLevel(r, l);
  if (!m.reachable) return [];
  const g = parseGrid(l.rows);
  let w = createWorld({ ...g, tiles: g.tiles.map((t) => (t === 'e' ? '.' : t)) });
  const pts: [number, number][] = [];
  m.route.forEach((input, i) => {
    w = stepWorld(r, g, { ...w, enemies: [] }, input);
    if (i % 4 === 0) pts.push([w.hero.x + HERO.width / 2, w.hero.y + HERO.height / 2]);
  });
  return pts;
};

export interface CarefulRun {
  finished: boolean;
  seconds: number;
  /** Seconds spent waiting for enemies to pass. */
  waited: number;
  stomped: number;
  cause?: World['cause'];
  /** Where it ended, in tiles. */
  x: number;
  /** Every frame's inputs, to replay it. */
  inputs: Input[];
}

const carefulMemo = new Map<string, CarefulRun>();

/**
 * The studio's careful player: it takes the route, and before each move it
 * looks at where the enemies will be and waits (up to three seconds) until
 * the move gets it to the same place alive. If no wait works, it goes
 * anyway, and that is where enemies end tries.
 */
export const carefulRun = (r: PlatformRules, l: Pick<PlatformLevel, 'rows'>): CarefulRun => {
  const key = JSON.stringify([r, l.rows]);
  const hit = carefulMemo.get(key);
  if (hit) return hit;
  const g = parseGrid(l.rows);
  const m = mapLevel(r, l);
  let w = createWorld(g);
  const log: Input[] = [];
  let waited = 0;
  const run = (world: World, inputs: Input[]) => {
    let x = world;
    for (const i of inputs) {
      x = stepWorld(r, g, x, i);
      if (x.phase !== 'playing') break;
    }
    return x;
  };
  const finish = (): CarefulRun => {
    const res: CarefulRun = { finished: w.phase === 'won', seconds: Math.round(w.frame * DT * 10) / 10, waited: Math.round(waited * DT * 10) / 10, stomped: w.stomped, cause: w.cause, x: Math.round(w.hero.x), inputs: log };
    if (carefulMemo.size > 100) carefulMemo.clear();
    carefulMemo.set(key, res);
    return res;
  };
  if (!m.reachable) return finish();
  // The drop to the ground from the start.
  const dropLen = m.route.length - m.steps.reduce((n, s) => n + s.inputs.length, 0);
  for (const i of m.route.slice(0, dropLen)) {
    w = stepWorld(r, g, w, i);
    log.push(i);
  }
  for (const s of m.steps) {
    if (w.phase !== 'playing') break;
    let wait = 0;
    for (; wait <= 180; wait += 10) {
      const waitedWorld = run(w, Array.from({ length: wait }, () => NONE));
      if (waitedWorld.phase !== 'playing') continue;
      const after = run(waitedWorld, s.inputs);
      if (after.phase === 'won') break;
      if (after.phase === 'playing' && s.to !== 'goal' && after.hero.grounded && footCell(after.hero)[0] === s.to[0] && footCell(after.hero)[1] === s.to[1]) break;
    }
    const pause = wait > 180 ? 0 : wait;
    waited += pause;
    for (const i of [...Array.from({ length: pause }, () => NONE), ...s.inputs]) {
      w = stepWorld(r, g, w, i);
      log.push(i);
      if (w.phase !== 'playing') break;
    }
  }
  return finish();
};
