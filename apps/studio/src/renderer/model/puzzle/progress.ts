import type { Condition, Effect, Rule } from '../rules';
import type { StoryObject } from '../types';
import { nodesOf, type PuzzleNode } from './tree';

/**
 * How far the player has got through a puzzle's steps (puzzle spec §6): what
 * is done and in what order, what went wrong, and when each timed sub-goal
 * began. A step, once done, stays done (unless a timed sub-goal runs out, or
 * a wrong move resets the puzzle), so order and time limits mean something.
 * The play-through and Play Mode keep this for puzzles whose steps need it;
 * a puzzle of plain all / any steps is solved by its rule alone.
 */
export interface StepProgress {
  /** Step id → the order it was done in (1, 2, 3…). */
  done: Record<string, number>;
  /** Step id → the order a wrong move was made at it. */
  failed: Record<string, number>;
  /** Timed sub-goal id → when its first step was done (play clock, seconds). */
  begun: Record<string, number>;
  /** The last order number given out. */
  seq: number;
  /** Wrong moves that weren't fail-forward. */
  fails: number;
  /** Step id → whether its wrong move held last time: a wrong move counts when it happens, not while it lasts. */
  wrong: Record<string, boolean>;
  /** Steps undone (out of time, or reset) whose condition still held: done again only once it stops holding and holds anew. */
  stale?: Record<string, boolean>;
}

export const emptyProgress = (): StepProgress => ({ done: {}, failed: {}, begun: {}, seq: 0, fails: 0, wrong: {} });

export interface StepEvent {
  nodeId: string;
  label: string;
  what: 'done' | 'failed' | 'expired' | 'reset';
}

export interface Advanced {
  progress: StepProgress;
  events: StepEvent[];
  /** What the steps done and the wrong moves made just now do. */
  effects: Effect[];
  solved: boolean;
  changed: boolean;
}

const childrenOf = (nodes: readonly PuzzleNode[], parentId: string | null) => nodes.filter((n) => (n.parentId ?? null) === parentId);

const descendants = (nodes: readonly PuzzleNode[], id: string): PuzzleNode[] => childrenOf(nodes, id).flatMap((c) => [c, ...descendants(nodes, c.id)]);

/** Whether a step may be done yet: what it needs is done, and in a sequence the step before it is. */
export const unlocked = (nodes: readonly PuzzleNode[], node: PuzzleNode, done: Record<string, number>): boolean => {
  if ((node.requires ?? []).some((r) => nodes.some((n) => n.id === r) && !done[r])) return false;
  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  if (parent?.gate === 'sequence' && !node.optional) {
    const steps = childrenOf(nodes, parent.id).filter((c) => !c.optional);
    const at = steps.findIndex((c) => c.id === node.id);
    if (at > 0 && !done[steps[at - 1]!.id]) return false;
  }
  // A step under a sub-goal that isn't open yet isn't open either.
  return parent ? unlocked(nodes, parent, done) : true;
};

/**
 * Move the puzzle on (§6): steps whose conditions hold now are done, in
 * dependency and sequence order; wrong moves are noticed; timed sub-goals
 * that ran out are undone. `holds` asks the game; `now` is the play clock
 * (none in the story play-through, where time limits don't apply).
 */
export const advance = (
  puzzle: StoryObject,
  before: StepProgress | undefined,
  holds: (rule: Rule) => boolean,
  now?: number,
): Advanced => {
  const nodes = nodesOf(puzzle);
  const resetOnFail = puzzle.data.reset === 'onFail';
  let p: StepProgress = before
    ? { done: { ...before.done }, failed: { ...before.failed }, begun: { ...before.begun }, seq: before.seq, fails: before.fails, wrong: { ...(before.wrong ?? {}) }, stale: { ...(before.stale ?? {}) } }
    : emptyProgress();
  const events: StepEvent[] = [];
  const effects: Effect[] = [];
  const cond = (c: Condition | undefined) => !!c && holds({ match: 'all', items: [c] });
  let changed = false;

  const markDone = (n: PuzzleNode) => {
    p.done[n.id] = ++p.seq;
    events.push({ nodeId: n.id, label: n.label, what: 'done' });
    effects.push(...(n.effects ?? []));
    changed = true;
    // Its first step done starts a timed sub-goal's clock.
    for (let at = n.parentId ? nodes.find((x) => x.id === n.parentId) : undefined; at; at = at.parentId ? nodes.find((x) => x.id === at!.parentId) : undefined) {
      if ((at.within ?? 0) > 0 && now !== undefined && p.begun[at.id] === undefined) p.begun[at.id] = now;
    }
  };

  // Time first: a timed sub-goal that ran out loses what was done under it.
  if (now !== undefined) {
    for (const g of nodes) {
      const start = p.begun[g.id];
      if (g.kind !== 'goal' || !(g.within ?? 0) || start === undefined || p.done[g.id] || now - start <= g.within!) continue;
      for (const d of descendants(nodes, g.id)) {
        if (p.done[d.id] && d.kind !== 'goal') p.stale = { ...p.stale, [d.id]: true };
        delete p.done[d.id];
        delete p.failed[d.id];
      }
      delete p.begun[g.id];
      events.push({ nodeId: g.id, label: g.label, what: 'expired' });
      changed = true;
    }
  }

  // Then as many passes as there are steps: each can open the next.
  for (let pass = 0; pass <= nodes.length; pass++) {
    let moved = false;
    for (const n of nodes) {
      if (p.done[n.id]) continue;
      if (n.kind !== 'goal') {
        // A wrong move is noticed when it happens, whether or not the step is open yet.
        const wrongNow = !!n.fail?.when && cond(n.fail.when);
        const happened = wrongNow && !p.wrong[n.id];
        if (!!p.wrong[n.id] !== wrongNow) {
          p.wrong[n.id] = wrongNow;
          changed = true;
        }
        if (happened && !p.failed[n.id]) {
          p.failed[n.id] = ++p.seq;
          events.push({ nodeId: n.id, label: n.label, what: 'failed' });
          effects.push(...(n.fail!.effects ?? []));
          changed = moved = true;
          if (n.fail!.forward) {
            markDone(n);
            continue;
          }
          p.fails++;
          if (resetOnFail) {
            const stale = Object.fromEntries(nodes.filter((x) => x.kind !== 'goal' && (p.done[x.id] || x.id === n.id)).map((x) => [x.id, true]));
            p = { ...emptyProgress(), seq: p.seq, fails: p.fails, wrong: p.wrong, stale };
            events.push({ nodeId: n.id, label: n.label, what: 'reset' });
            break;
          }
          continue;
        }
        if (p.stale?.[n.id]) {
          // Undone while it held: it must stop holding first.
          if (cond(n.when)) continue;
          const { [n.id]: _gone, ...rest } = p.stale;
          p.stale = rest;
          changed = true;
          continue;
        }
        if (unlocked(nodes, n, p.done) && cond(n.when)) {
          markDone(n);
          moved = true;
        }
        continue;
      }
      if (!unlocked(nodes, n, p.done)) continue;
      const steps = childrenOf(nodes, n.id).filter((c) => !c.optional);
      if (!steps.length) continue;
      const ok = n.gate === 'any' ? steps.some((c) => p.done[c.id]) : steps.every((c) => p.done[c.id]);
      if (ok) {
        markDone(n);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const top = childrenOf(nodes, null).filter((c) => !c.optional);
  const solved = top.length > 0 && top.every((c) => p.done[c.id]);
  return { progress: p, events, effects, solved, changed };
};

/** Where each step stands, for the tree and the graph's ticks. */
export const stepStatus = (nodes: readonly PuzzleNode[], progress: StepProgress | undefined, node: PuzzleNode): 'done' | 'failed' | 'open' | 'locked' => {
  const p = progress ?? emptyProgress();
  if (p.done[node.id]) return 'done';
  if (p.failed[node.id]) return 'failed';
  return unlocked(nodes, node, p.done) ? 'open' : 'locked';
};
