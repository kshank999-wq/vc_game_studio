/**
 * The enemy and ally AI profile (Character Creator spec §6.2). AI skill is a
 * profile, not one magic intelligence number: perception, reaction, pursuit,
 * navigation, coordination, tactics, accuracy and ability selection, each set
 * on its own. Detection modes are independent (sight cone and distance, line
 * of sight, hearing, a proximity radius), and so are the limits that end a
 * chase (chase time, disengage distance from its post) and the search after.
 *
 * Behaviour is a state machine the designer can change: the starter is
 * Idle → Patrol → Alert → Investigate → Chase → Attack → Search → Return,
 * with Stunned, Flee, Dead and Disabled optional. Each transition is a
 * typed trigger, so it is data the engines read, never code.
 *
 * `aiStep` runs the machine on a flat 2D world (the preview, spec §12): it
 * is pure and deterministic, and says why every transition happened.
 */

export type AIState = 'idle' | 'patrol' | 'alert' | 'investigate' | 'chase' | 'attack' | 'search' | 'return' | 'stunned' | 'flee' | 'dead' | 'disabled';

export const AI_STATES: { id: AIState; label: string; core: boolean; hint: string }[] = [
  { id: 'idle', label: 'Idle', core: true, hint: 'Stands at its post' },
  { id: 'patrol', label: 'Patrol', core: true, hint: 'Walks its patrol route' },
  { id: 'alert', label: 'Alert', core: true, hint: 'Has noticed something; reacts after its reaction time' },
  { id: 'investigate', label: 'Investigate', core: true, hint: 'Goes to where it heard or last saw something' },
  { id: 'chase', label: 'Chase', core: true, hint: 'Runs at the target' },
  { id: 'attack', label: 'Attack', core: true, hint: 'In range: uses its attacks' },
  { id: 'search', label: 'Search', core: true, hint: 'Lost the target: searches its last known position' },
  { id: 'return', label: 'Return', core: true, hint: 'Gives up and goes back to its post' },
  { id: 'stunned', label: 'Stunned', core: false, hint: 'Can’t act for a moment after a hit' },
  { id: 'flee', label: 'Flee', core: false, hint: 'Runs away when badly hurt' },
  { id: 'dead', label: 'Dead', core: false, hint: 'Out of health' },
  { id: 'disabled', label: 'Disabled', core: false, hint: 'Switched off by the story' },
];

export const stateLabel = (s: AIState | 'any'): string => (s === 'any' ? 'Any state' : (AI_STATES.find((x) => x.id === s)?.label ?? s));

export type AITrigger =
  | 'always'
  | 'seesTarget'
  | 'hearsTarget'
  | 'inProximity'
  | 'inAttackRange'
  | 'outOfAttackRange'
  | 'lostTarget'
  | 'chaseTimeout'
  | 'tooFarFromPost'
  | 'timerDone'
  | 'reachedPost'
  | 'healthBelow'
  | 'hit'
  | 'killed';

export const AI_TRIGGERS: { id: AITrigger; label: string; takes?: 'percent' }[] = [
  { id: 'always', label: 'At once' },
  { id: 'seesTarget', label: 'Sees the target' },
  { id: 'hearsTarget', label: 'Hears the target' },
  { id: 'inProximity', label: 'Target within its proximity radius' },
  { id: 'inAttackRange', label: 'Target in attack range' },
  { id: 'outOfAttackRange', label: 'Target out of attack range' },
  { id: 'lostTarget', label: 'Lost sight of the target' },
  { id: 'chaseTimeout', label: 'Chased too long without seeing it' },
  { id: 'tooFarFromPost', label: 'Past its disengage distance' },
  { id: 'timerDone', label: 'Its time in this state is up' },
  { id: 'reachedPost', label: 'Back at its post' },
  { id: 'healthBelow', label: 'Health below', takes: 'percent' },
  { id: 'hit', label: 'Is hit' },
  { id: 'killed', label: 'Health reaches 0' },
];

export const triggerLabel = (t: AITransition): string => {
  const x = AI_TRIGGERS.find((a) => a.id === t.trigger);
  return `${x?.label ?? t.trigger}${x?.takes === 'percent' ? ` ${t.value ?? 0}%` : ''}`;
};

export interface AITransition {
  id: string;
  from: AIState | 'any';
  to: AIState;
  trigger: AITrigger;
  /** For healthBelow: a percentage. */
  value?: number;
  enabled: boolean;
}

export type Tactics = 'aggressive' | 'defensive' | 'ranged' | 'ambush' | 'support';
export const TACTICS: { id: Tactics; label: string; hint: string }[] = [
  { id: 'aggressive', label: 'Aggressive', hint: 'Closes in and keeps attacking' },
  { id: 'defensive', label: 'Defensive', hint: 'Holds its ground, blocks, attacks back' },
  { id: 'ranged', label: 'Keeps its distance', hint: 'Stays at range and shoots or casts' },
  { id: 'ambush', label: 'Ambush', hint: 'Waits hidden until the target is close' },
  { id: 'support', label: 'Support', hint: 'Heals and shields its side before attacking' },
];

/** How good it is at each part of fighting, 0–100 (spec §6.2: a profile, not one number). */
export interface AISkill {
  perception: number;
  pursuit: number;
  navigation: number;
  coordination: number;
  tactics: number;
  accuracy: number;
  abilitySelection: number;
}

export const SKILL_LABELS: Record<keyof AISkill, { label: string; hint: string }> = {
  perception: { label: 'Perception', hint: 'How sure it is of what it sees and hears' },
  pursuit: { label: 'Pursuit', hint: 'How hard it chases: its chase speed' },
  navigation: { label: 'Navigation', hint: 'How well it finds a way round obstacles' },
  coordination: { label: 'Coordination', hint: 'How well it works with others of its side' },
  tactics: { label: 'Tactics', hint: 'How well it picks its moment and position' },
  accuracy: { label: 'Accuracy', hint: 'How often its attacks land' },
  abilitySelection: { label: 'Ability choice', hint: 'How well it picks which ability to use' },
};

export interface AIProfile {
  /** The states it uses; the core eight are on to start with. */
  states: AIState[];
  start: 'idle' | 'patrol';
  /** Degrees, the whole cone. */
  visionAngle: number;
  /** Metres. */
  viewDistance: number;
  lineOfSight: boolean;
  hearingRadius: number;
  /** It notices anything this close, seen or not. */
  proximityRadius: number;
  attackRange: number;
  /** Seconds between attacks. */
  attackCooldown: number;
  /** Seconds before it acts on what it noticed. */
  reaction: number;
  /** Seconds it chases without seeing the target before it gives up. */
  chaseTimeout: number;
  /** Metres from its post at which it gives up the chase. */
  disengageDistance: number;
  investigateSeconds: number;
  searchSeconds: number;
  stunSeconds: number;
  /** Goes back to its post (and patrol) after a search, or stays where it lost the target. */
  resetToPost: boolean;
  tactics: Tactics;
  skill: AISkill;
  transitions: AITransition[];
}

const T = (from: AIState | 'any', to: AIState, trigger: AITrigger, value?: number): AITransition => ({ id: '', from, to, trigger, ...(value !== undefined ? { value } : {}), enabled: true });

/** The starter state machine (spec §6.2). Order is priority: the first that holds wins. Its ids are fixed, so a profile read twice is the same. */
export const starterTransitions = (): AITransition[] => STARTER().map((t, i) => ({ ...t, id: `st_${i + 1}` }));

const STARTER = (): AITransition[] => [
  T('any', 'dead', 'killed'),
  T('any', 'flee', 'healthBelow', 20),
  T('any', 'stunned', 'hit'),
  T('stunned', 'chase', 'timerDone'),
  T('idle', 'chase', 'inProximity'),
  T('patrol', 'chase', 'inProximity'),
  T('idle', 'alert', 'seesTarget'),
  T('patrol', 'alert', 'seesTarget'),
  T('idle', 'investigate', 'hearsTarget'),
  T('patrol', 'investigate', 'hearsTarget'),
  T('idle', 'patrol', 'always'),
  T('alert', 'chase', 'seesTarget'),
  T('alert', 'investigate', 'lostTarget'),
  T('investigate', 'chase', 'seesTarget'),
  T('investigate', 'return', 'timerDone'),
  T('chase', 'return', 'tooFarFromPost'),
  T('chase', 'attack', 'inAttackRange'),
  T('chase', 'search', 'chaseTimeout'),
  T('attack', 'return', 'tooFarFromPost'),
  T('attack', 'chase', 'outOfAttackRange'),
  T('search', 'chase', 'seesTarget'),
  T('search', 'return', 'timerDone'),
  T('return', 'chase', 'seesTarget'),
  T('return', 'patrol', 'reachedPost'),
  // With Patrol off, it stands at its post.
  T('return', 'idle', 'reachedPost'),
];

export const CORE_STATES: AIState[] = AI_STATES.filter((s) => s.core).map((s) => s.id);

export const defaultAI = (): AIProfile => ({
  states: [...CORE_STATES, 'dead'],
  start: 'patrol',
  visionAngle: 110,
  viewDistance: 12,
  lineOfSight: true,
  hearingRadius: 6,
  proximityRadius: 2,
  attackRange: 1.5,
  attackCooldown: 1.2,
  reaction: 0.6,
  chaseTimeout: 4,
  disengageDistance: 25,
  investigateSeconds: 5,
  searchSeconds: 6,
  stunSeconds: 1.5,
  resetToPost: true,
  tactics: 'aggressive',
  skill: { perception: 50, pursuit: 50, navigation: 50, coordination: 30, tactics: 40, accuracy: 50, abilitySelection: 40 },
  transitions: starterTransitions(),
});

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A stored AI profile with defaults filled in. */
export const normalizeAI = (raw: unknown): AIProfile => {
  const d = defaultAI();
  const a = (raw ?? {}) as Partial<AIProfile>;
  const states = Array.isArray(a.states) ? a.states.filter((s) => AI_STATES.some((x) => x.id === s)) : d.states;
  return {
    ...d,
    ...a,
    states,
    start: a.start === 'idle' ? 'idle' : 'patrol',
    visionAngle: Math.min(360, Math.max(0, num(a.visionAngle, d.visionAngle))),
    skill: { ...d.skill, ...(a.skill ?? {}) },
    transitions: Array.isArray(a.transitions) ? a.transitions : d.transitions,
  };
};

// ---------------------------------------------------------------- checks

/** What is wrong with a profile (spec §12: validated, with clear feedback). */
export const aiProblems = (ai: AIProfile, opts: { hasAttack: boolean; hasPatrol?: boolean }): { severity: 'error' | 'warning'; text: string }[] => {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  const on = new Set(ai.states);
  if (!on.has(ai.start)) out.push({ severity: 'error', text: `It starts in ${stateLabel(ai.start)}, but that state is off.` });
  for (const t of ai.transitions) {
    if (!t.enabled) continue;
    if (t.from !== 'any' && !on.has(t.from)) continue;
    if (!on.has(t.to) && t.from !== 'any') out.push({ severity: 'warning', text: `${stateLabel(t.from)} → ${stateLabel(t.to)} goes to a state that is off; it is skipped.` });
    if (t.trigger === 'healthBelow' && !(Number(t.value) > 0 && Number(t.value) < 100)) out.push({ severity: 'error', text: `${stateLabel(t.from)} → ${stateLabel(t.to)}: health below needs a percentage from 1 to 99.` });
  }
  const live = ai.transitions.filter((t) => t.enabled && (t.from === 'any' || on.has(t.from)) && on.has(t.to));
  for (const s of ai.states) {
    if (s === ai.start || s === 'disabled') continue;
    if (!live.some((t) => t.to === s)) out.push({ severity: 'warning', text: `Nothing leads to ${stateLabel(s)}.` });
  }
  for (const s of ai.states) {
    if (s === 'dead' || s === 'disabled') continue;
    if (!live.some((t) => t.from === s)) out.push({ severity: 'warning', text: `${stateLabel(s)} has no way out: once there it stays.` });
  }
  if (on.has('attack') && !opts.hasAttack) out.push({ severity: 'warning', text: 'It has an Attack state but no combat or magic ability to attack with.' });
  if (ai.viewDistance <= 0 && ai.hearingRadius <= 0 && ai.proximityRadius <= 0) out.push({ severity: 'error', text: 'It can’t see, hear or sense anything: it will never notice the target.' });
  if (ai.proximityRadius > ai.viewDistance && ai.viewDistance > 0) out.push({ severity: 'warning', text: 'Its proximity radius is wider than it can see.' });
  if (ai.attackRange > ai.viewDistance && ai.viewDistance > 0) out.push({ severity: 'warning', text: 'It attacks from further than it can see.' });
  if (ai.disengageDistance > 0 && ai.disengageDistance < ai.viewDistance) out.push({ severity: 'warning', text: 'It disengages closer to its post than it can see: it will give up chases it has only just started.' });
  if (ai.chaseTimeout <= 0) out.push({ severity: 'warning', text: 'A chase timeout of 0 gives up the moment it loses sight.' });
  return out;
};

// ---------------------------------------------------------------- the 2D preview

export interface Vec {
  x: number;
  y: number;
}

/** The flat world the preview runs in: walls (segments) block sight; the target may be making noise. */
export interface AIWorld {
  target: Vec & { noisy: boolean; alive: boolean };
  /** The actor's post and patrol stops (the first is its post); a stop's wait is how long it stands there, in seconds. */
  patrol: (Vec & { wait?: number })[];
  walls: [Vec, Vec][];
  /** What else blocks sight between two points (a level's solids). */
  blocked?: (a: Vec, b: Vec) => boolean;
  /** The way round walls: the next point to head for on the way from one place to another, or null for no way there (a level's navigation graph). */
  steer?: (from: Vec, to: Vec) => Vec | null;
}

export interface AIMemory {
  state: AIState;
  pos: Vec;
  /** Radians; 0 is +x. */
  facing: number;
  /** Seconds in the current state. */
  timer: number;
  /** Seconds since it last saw or sensed the target. */
  sinceSeen: number;
  lastKnown?: Vec;
  patrolIndex: number;
  /** Seconds left standing at the patrol stop it reached. */
  pause?: number;
  health: number;
  maxHealth: number;
  cooldown: number;
  attacks: number;
  /** A hit this step (the preview's Hit button). */
  hit?: boolean;
}

export interface AIStepResult {
  memory: AIMemory;
  /** Why it changed state, in words, when it did. */
  reason?: string;
  senses: { sees: boolean; hears: boolean; near: boolean; distance: number; why: string };
  /** It attacked this step. */
  attacked?: boolean;
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const wrap = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));

const crosses = (p: Vec, q: Vec, a: Vec, b: Vec): boolean => {
  const d = (u: Vec, v: Vec, w: Vec) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = d(a, b, p);
  const d2 = d(a, b, q);
  const d3 = d(p, q, a);
  const d4 = d(p, q, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

export const startMemory = (world: AIWorld, ai: AIProfile, health: number): AIMemory => ({
  state: ai.states.includes(ai.start) ? ai.start : (ai.states[0] ?? 'idle'),
  pos: { ...(world.patrol[0] ?? { x: 0, y: 0 }) },
  facing: 0,
  timer: 0,
  sinceSeen: Infinity,
  patrolIndex: 0,
  health,
  maxHealth: health,
  cooldown: 0,
  attacks: 0,
});

/** What it senses of the target, and why. */
export const sense = (ai: AIProfile, m: AIMemory, world: AIWorld) => {
  const t = world.target;
  const distance = dist(m.pos, t);
  if (!t.alive) return { sees: false, hears: false, near: false, distance, why: 'No target.' };
  const off = Math.abs(wrap(angleTo(m.pos, t) - m.facing)) * (180 / Math.PI);
  const inCone = ai.visionAngle >= 360 || off <= ai.visionAngle / 2;
  const blocked = ai.lineOfSight && (world.walls.some(([a, b]) => crosses(m.pos, t, a, b)) || !!world.blocked?.(m.pos, t));
  const sees = distance <= ai.viewDistance && inCone && !blocked;
  const hears = t.noisy && distance <= ai.hearingRadius;
  const near = distance <= ai.proximityRadius;
  const why = sees
    ? `Sees it ${distance.toFixed(1)} m away, ${Math.round(off)}° off its facing (cone ${ai.visionAngle}°).`
    : distance > ai.viewDistance
      ? `Out of sight range (${distance.toFixed(1)} m > ${ai.viewDistance} m).`
      : !inCone
        ? `Outside its ${ai.visionAngle}° view (${Math.round(off)}° off its facing).`
        : 'A wall blocks its line of sight.';
  return { sees, hears, near, distance, why: `${why}${hears ? ' Hears it.' : ''}${near ? ' Close enough to sense.' : ''}` };
};

const TIMERS: Partial<Record<AIState, keyof AIProfile>> = { investigate: 'investigateSeconds', search: 'searchSeconds', stunned: 'stunSeconds', alert: 'reaction' };

/**
 * One step of the machine: sense, pick the first enabled transition from the
 * current state (or Any) whose trigger holds, then move. Alert holds for its
 * reaction time before anything but Any-state transitions can fire.
 */
export const aiStep = (ai: AIProfile, speed: number, m0: AIMemory, world: AIWorld, dt: number): AIStepResult => {
  const m: AIMemory = { ...m0, pos: { ...m0.pos }, timer: m0.timer + dt, cooldown: Math.max(0, m0.cooldown - dt), hit: false };
  const s = sense(ai, m, world);
  const noticed = s.sees || s.near;
  m.sinceSeen = noticed ? 0 : m0.sinceSeen + dt;
  if (noticed || s.hears) m.lastKnown = { x: world.target.x, y: world.target.y };
  const post = world.patrol[0] ?? { x: 0, y: 0 };
  const fromPost = dist(m.pos, post);
  const timerKey = TIMERS[m.state];
  const timerDone = timerKey ? m.timer >= Number(ai[timerKey]) : false;
  const holds = (t: AITransition): string | undefined => {
    switch (t.trigger) {
      case 'always':
        return 'At once.';
      case 'seesTarget':
        return s.sees ? s.why : undefined;
      case 'hearsTarget':
        return s.hears ? `Hears it ${s.distance.toFixed(1)} m away (hearing ${ai.hearingRadius} m).` : undefined;
      case 'inProximity':
        return s.near ? `It is ${s.distance.toFixed(1)} m away, inside its ${ai.proximityRadius} m proximity radius.` : undefined;
      case 'inAttackRange':
        return noticed && s.distance <= ai.attackRange ? `In attack range (${s.distance.toFixed(1)} m ≤ ${ai.attackRange} m).` : undefined;
      case 'outOfAttackRange':
        return s.distance > ai.attackRange * 1.25 ? `Out of attack range (${s.distance.toFixed(1)} m).` : undefined;
      case 'lostTarget':
        return !noticed ? `Lost it: ${s.why}` : undefined;
      case 'chaseTimeout':
        return m.sinceSeen >= ai.chaseTimeout ? `Hasn’t seen it for ${ai.chaseTimeout} s (chase timeout).` : undefined;
      case 'tooFarFromPost':
        return fromPost > ai.disengageDistance ? `${fromPost.toFixed(1)} m from its post, past its ${ai.disengageDistance} m disengage distance.` : undefined;
      case 'timerDone':
        return timerDone ? `Its ${timerKey === 'reaction' ? 'reaction' : String(timerKey).replace('Seconds', '')} time (${String(ai[timerKey!])} s) is up.` : undefined;
      case 'reachedPost':
        return fromPost < 0.5 ? 'Back at its post.' : undefined;
      case 'healthBelow':
        return m.health / m.maxHealth < Number(t.value ?? 0) / 100 && m.health > 0 ? `Health ${Math.round((m.health / m.maxHealth) * 100)}%, below ${t.value}%.` : undefined;
      case 'hit':
        return m0.hit ? 'It was hit.' : undefined;
      case 'killed':
        return m.health <= 0 ? 'Out of health.' : undefined;
    }
  };
  let reason: string | undefined;
  const on = new Set(ai.states);
  const held = m.state === 'alert' && !timerDone;
  if (m.state !== 'dead' && m.state !== 'disabled') {
    for (const t of ai.transitions) {
      if (!t.enabled || !on.has(t.to) || t.to === m.state) continue;
      if (t.from !== m.state && t.from !== 'any') continue;
      if (held && t.from !== 'any') continue;
      const why = holds(t);
      if (!why) continue;
      reason = `${stateLabel(m.state)} → ${stateLabel(t.to)}: ${why}`;
      m.state = t.to;
      m.timer = 0;
      delete m.pause;
      break;
    }
  }

  // Move.
  // Toward a place, by the way round walls when the world knows one (standing when there is none).
  const walk = (to: Vec, pace: number) => {
    if (dist(m.pos, to) < 0.01) return true;
    const via = world.steer ? world.steer(m.pos, to) : to;
    if (!via) return false;
    const d = dist(m.pos, via);
    if (d < 1e-6) return false;
    const turn = angleTo(m.pos, via);
    m.facing = turn;
    const step = Math.min(d, pace * dt);
    m.pos.x += Math.cos(turn) * step;
    m.pos.y += Math.sin(turn) * step;
    // There only on the last leg of the way.
    return via === to && step >= d;
  };
  const chaseSpeed = speed * (0.7 + 0.6 * (ai.skill.pursuit / 100));
  let attacked = false;
  switch (m.state) {
    case 'patrol': {
      const stops = world.patrol.length ? world.patrol : [post];
      // Standing at the stop it reached, for as long as the stop says.
      if ((m.pause ?? 0) > 0) {
        m.pause = Math.max(0, m.pause! - dt);
        if (!m.pause) delete m.pause;
        break;
      }
      const goal = stops[m.patrolIndex % stops.length]!;
      if (walk(goal, speed * 0.45)) {
        m.patrolIndex = (m.patrolIndex + 1) % stops.length;
        if ((goal.wait ?? 0) > 0) m.pause = goal.wait;
      }
      break;
    }
    case 'alert':
      m.facing = m.lastKnown ? angleTo(m.pos, m.lastKnown) : m.facing;
      break;
    case 'investigate':
      if (m.lastKnown) walk(m.lastKnown, speed * 0.6);
      break;
    case 'chase':
      walk(noticed ? world.target : (m.lastKnown ?? world.target), chaseSpeed);
      break;
    case 'attack':
      m.facing = angleTo(m.pos, world.target);
      if (m.cooldown <= 0 && s.distance <= ai.attackRange) {
        m.cooldown = ai.attackCooldown;
        m.attacks += 1;
        attacked = true;
      }
      break;
    case 'search': {
      const c = m.lastKnown ?? m.pos;
      const r = 2;
      const a = m.timer * 1.2;
      walk({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, speed * 0.5);
      break;
    }
    case 'return':
      walk(ai.resetToPost ? post : m.pos, speed * 0.6);
      if (!ai.resetToPost) m.state = 'idle';
      break;
    case 'flee': {
      const away = angleTo(world.target, m.pos);
      walk({ x: m.pos.x + Math.cos(away) * 5, y: m.pos.y + Math.sin(away) * 5 }, speed);
      break;
    }
    default:
      break;
  }
  return { memory: m, ...(reason ? { reason } : {}), senses: s, ...(attacked ? { attacked } : {}) };
};
