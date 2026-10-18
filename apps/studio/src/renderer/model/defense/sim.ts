import { costTo, statsAt, type DefenseGame, type Placement } from './defense';

/**
 * The castle defense running: enemies walk the path in their waves, towers on
 * the build spots shoot the one furthest along in reach, kills pay gold, and
 * each wave cleared pays its bonus. One step function drives both the play
 * preview (a frame at a time) and the balance check (straight to the end), so
 * what the designer watches is what the numbers say.
 */

export interface SimEnemy {
  uid: number;
  enemyId: string;
  hp: number;
  maxHp: number;
  /** Cells walked along the path. */
  dist: number;
  slowUntil: number;
  slow: number;
  x: number;
  y: number;
}

export interface SimTower {
  spot: number;
  towerId: string;
  level: number;
  cooldown: number;
  x: number;
  y: number;
}

export interface Shot {
  from: [number, number];
  to: [number, number];
  age: number;
  splash: number;
}

export interface WaveStat {
  spawned: number;
  killed: number;
  leaked: number;
  /** Gold earned in the wave, kills and bonus. */
  gold: number;
  livesLeft: number;
  seconds: number;
}

export interface SimState {
  t: number;
  /** The wave under way, or next after a breather (0-based). */
  wave: number;
  waveT: number;
  queue: { at: number; enemyId: string }[];
  enemies: SimEnemy[];
  towers: SimTower[];
  gold: number;
  lives: number;
  phase: 'running' | 'breather' | 'won' | 'lost';
  breatherLeft: number;
  stats: WaveStat[];
  shots: Shot[];
  /** Towers in the layout waiting for the gold to build them, in order. */
  pending: Placement[];
  /** Towers in the layout not built yet. */
  unbuilt: number;
  nextUid: number;
}

const center = (c: [number, number]): [number, number] => [c[0] + 0.5, c[1] + 0.5];

/** Where on the map something is, this far along the path. */
export const pointAt = (g: DefenseGame, dist: number): [number, number] => {
  const p = g.map.path;
  if (!p.length) return [0, 0];
  const i = Math.max(0, Math.min(p.length - 1, Math.floor(dist)));
  const a = center(p[i]!);
  const b = center(p[Math.min(p.length - 1, i + 1)]!);
  const f = Math.max(0, Math.min(1, dist - i));
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
};

const blankStat = (): WaveStat => ({ spawned: 0, killed: 0, leaked: 0, gold: 0, livesLeft: 0, seconds: 0 });

const queueFor = (g: DefenseGame, wave: number) =>
  (g.waves[wave]?.groups ?? []).flatMap((grp) => Array.from({ length: Math.max(0, Math.round(grp.count)) }, (_, i) => ({ at: grp.delay + i * grp.gap, enemyId: grp.enemyId }))).sort((a, b) => a.at - b.at);

/** Build the waiting towers, in order, while the gold lasts. */
const buildPending = (g: DefenseGame, s: SimState): void => {
  while (s.pending.length) {
    const p = s.pending[0]!;
    const t = g.towers.find((x) => x.id === p.towerId);
    const spot = g.map.spots[p.spot];
    if (!t || !spot) {
      s.pending.shift();
      continue;
    }
    const cost = costTo(t, p.level);
    if (cost > s.gold) break;
    s.gold -= cost;
    s.pending.shift();
    const [x, y] = center(spot);
    s.towers.push({ spot: p.spot, towerId: t.id, level: p.level, cooldown: 0, x, y });
  }
  s.unbuilt = s.pending.length;
};

/**
 * A fresh run with a layout: its towers built in order as the gold comes in
 * (what the starting gold covers at once, the rest as kills pay for them),
 * the first wave on its way.
 */
export const createSim = (g: DefenseGame, layout: readonly Placement[] = g.layout, breather = 0): SimState => {
  const s = {
    t: 0,
    wave: 0,
    waveT: 0,
    queue: breather > 0 ? [] : queueFor(g, 0),
    enemies: [],
    towers: [] as SimTower[],
    gold: g.economy.startGold,
    lives: g.economy.lives,
    phase: g.waves.length ? (breather > 0 ? 'breather' : 'running') : 'won',
    breatherLeft: breather,
    stats: g.waves.length ? [blankStat()] : [],
    shots: [],
    pending: layout.filter((p) => g.towers.some((t) => t.id === p.towerId) && !!g.map.spots[p.spot]),
    unbuilt: 0,
    nextUid: 1,
  } as SimState;
  buildPending(g, s);
  return s;
};

/** Move the run on by dt seconds. Returns a new state; the old one is left as it was. */
export const stepSim = (g: DefenseGame, prev: SimState, dt: number): SimState => {
  if (prev.phase === 'won' || prev.phase === 'lost') return prev;
  const s: SimState = { ...prev, t: prev.t + dt, enemies: prev.enemies.map((e) => ({ ...e })), towers: prev.towers.map((t) => ({ ...t })), stats: prev.stats.map((x) => ({ ...x })), pending: [...prev.pending], shots: prev.shots.map((x) => ({ ...x, age: x.age + dt })).filter((x) => x.age < 0.15), queue: [...prev.queue] };
  if (s.phase === 'breather') {
    s.breatherLeft -= dt;
    if (s.breatherLeft > 0) return s;
    s.phase = 'running';
    s.waveT = 0;
    s.queue = queueFor(g, s.wave);
  }
  const stat = s.stats[s.wave]!;
  s.waveT += dt;
  stat.seconds = s.waveT;
  const enemyDef = new Map(g.enemies.map((e) => [e.id, e]));
  // Spawn what is due.
  while (s.queue.length && s.queue[0]!.at <= s.waveT) {
    const q = s.queue.shift()!;
    const def = enemyDef.get(q.enemyId);
    if (!def) continue;
    const [x, y] = pointAt(g, 0);
    s.enemies.push({ uid: s.nextUid++, enemyId: def.id, hp: def.health, maxHp: def.health, dist: 0, slowUntil: 0, slow: 0, x, y });
    stat.spawned++;
  }
  // Walk.
  const end = Math.max(0, g.map.path.length - 1);
  for (const e of s.enemies) {
    const def = enemyDef.get(e.enemyId)!;
    const speed = def.speed * (e.slowUntil > s.t ? 1 - e.slow : 1);
    e.dist += speed * dt;
    [e.x, e.y] = pointAt(g, e.dist);
  }
  const leaked = s.enemies.filter((e) => e.dist >= end);
  for (const e of leaked) {
    s.lives -= enemyDef.get(e.enemyId)!.leak;
    stat.leaked++;
  }
  s.enemies = s.enemies.filter((e) => e.dist < end);
  // Shoot.
  const towerDef = new Map(g.towers.map((t) => [t.id, t]));
  for (const tw of s.towers) {
    tw.cooldown -= dt;
    if (tw.cooldown > 0) continue;
    const def = towerDef.get(tw.towerId);
    if (!def) continue;
    const st = statsAt(def, tw.level);
    let target: SimEnemy | undefined;
    for (const e of s.enemies) {
      if (e.hp <= 0 || (enemyDef.get(e.enemyId)!.flying && !def.hitsAir)) continue;
      if (Math.hypot(e.x - tw.x, e.y - tw.y) > st.range) continue;
      if (!target || e.dist > target.dist) target = e;
    }
    if (!target) continue;
    const hit = (e: SimEnemy) => {
      const ed = enemyDef.get(e.enemyId)!;
      e.hp -= Math.max(1, st.damage - ed.armor);
      if (def.slow > 0) {
        e.slow = Math.max(e.slowUntil > s.t ? e.slow : 0, Math.min(0.9, def.slow));
        e.slowUntil = s.t + 1;
      }
    };
    hit(target);
    if (def.splash > 0) for (const e of s.enemies) if (e !== target && e.hp > 0 && Math.hypot(e.x - target.x, e.y - target.y) <= def.splash && !(enemyDef.get(e.enemyId)!.flying && !def.hitsAir)) hit(e);
    s.shots.push({ from: [tw.x, tw.y], to: [target.x, target.y], age: 0, splash: def.splash });
    tw.cooldown = 1 / Math.max(0.01, st.rate);
  }
  // Pay for kills.
  for (const e of s.enemies) {
    if (e.hp > 0) continue;
    const reward = enemyDef.get(e.enemyId)!.reward;
    s.gold += reward;
    stat.gold += reward;
    stat.killed++;
  }
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  buildPending(g, s);
  stat.livesLeft = Math.max(0, s.lives);
  if (s.lives <= 0) {
    s.lives = 0;
    s.phase = 'lost';
    return s;
  }
  // Wave cleared.
  if (!s.queue.length && !s.enemies.length) {
    const bonus = g.waves[s.wave]?.bonus ?? 0;
    s.gold += bonus;
    stat.gold += bonus;
    buildPending(g, s);
    if (s.wave >= g.waves.length - 1) s.phase = 'won';
    else {
      s.wave++;
      s.stats.push(blankStat());
      s.phase = 'breather';
      s.breatherLeft = g.economy.breather;
    }
  }
  return s;
};

export interface RunResult {
  outcome: 'won' | 'lost' | 'timeout';
  /** Waves cleared. */
  cleared: number;
  lives: number;
  gold: number;
  stats: WaveStat[];
  unbuilt: number;
}

/** Run the whole game with a layout, as fast as it goes, and say how it went. Breathers are skipped. */
export const runDefense = (g: DefenseGame, layout: readonly Placement[] = g.layout, dt = 0.05, maxSeconds = 3600): RunResult => {
  let s = createSim(g, layout);
  while (s.phase !== 'won' && s.phase !== 'lost' && s.t < maxSeconds) {
    s = stepSim(g, s, dt);
    if (s.phase === 'breather') s = { ...s, breatherLeft: 0 };
  }
  const outcome = s.phase === 'won' ? 'won' : s.phase === 'lost' ? 'lost' : 'timeout';
  const cleared = outcome === 'won' ? g.waves.length : s.wave;
  return { outcome, cleared, lives: s.lives, gold: s.gold, stats: s.stats, unbuilt: s.unbuilt };
};

/** What each wave throws at the player and pays, on paper. */
export const waveSheet = (g: DefenseGame) => {
  let gold = g.economy.startGold;
  return g.waves.map((w, i) => {
    let health = 0;
    let reward = 0;
    let count = 0;
    let last = 0;
    for (const grp of w.groups) {
      const e = g.enemies.find((x) => x.id === grp.enemyId);
      if (!e) continue;
      count += grp.count;
      health += e.health * grp.count;
      reward += e.reward * grp.count;
      last = Math.max(last, grp.delay + Math.max(0, grp.count - 1) * grp.gap);
    }
    gold += reward + w.bonus;
    return { wave: i + 1, count, health, reward, bonus: w.bonus, goldAfter: gold, lastSpawn: last };
  });
};
