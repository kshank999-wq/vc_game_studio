import type { Condition, Effect } from '../rules';
import type { StoryObject } from '../types';

/**
 * The puzzle tree's types and the two reads the rest of the studio needs (the
 * Bible asks whether a puzzle's steps write its rule), kept apart from the
 * Puzzle Creator's model so they load with the studio and it loads on demand.
 */

/** What a node is in the hierarchy (§5): a goal, what it breaks into, what each needs, and what the player does. */
export type NodeKind = 'goal' | 'requirement' | 'interaction';

export interface PuzzleNode {
  id: string;
  /** The sub-goal it is part of; the puzzle's own goal when null. */
  parentId: string | null;
  kind: NodeKind;
  label: string;
  notes?: string;
  /** For a sub-goal (§6): all of its steps (AND), any one of them (OR: alternate paths), or all in order (sequence). */
  gate?: 'all' | 'any' | 'sequence';
  /** For a sub-goal: done within this many seconds of its first step, or its steps are undone (a timed gate). */
  within?: number;
  /** Other steps that must be done before this one can be: dependency links across the tree (§6, §15 PuzzleEdge). */
  requires?: string[];
  /** What doing it gives, the first time: an optional branch's reward, an extra clue, a state change. */
  effects?: Effect[];
  /** What an optional step is for (§6). */
  branch?: 'reward' | 'shortcut' | 'clue' | 'alternate';
  /**
   * A wrong move (§6): when this holds the step has failed; its effects change
   * the puzzle. Fail-forward, the step still counts as done; otherwise it
   * blocks until the puzzle resets.
   */
  fail?: { when?: Condition; effects?: Effect[]; forward?: boolean };
  /** For a requirement or interaction: what in the game means it is done. Without one it can't be done yet. */
  when?: Condition;
  /** Not needed to solve: a reward, a shortcut, an extra clue. */
  optional?: boolean;
  /** Not shown to the player until it is reached (for the designer's notes; play is unchanged). */
  hidden?: boolean;
  /** A label the designer groups steps by. */
  group?: string;
}

export const nodesOf = (puzzle: StoryObject | undefined): PuzzleNode[] => {
  const raw = puzzle?.data.tree;
  return Array.isArray(raw) ? (raw as PuzzleNode[]).filter((n) => n && typeof n.id === 'string') : [];
};

/** Whether the tree writes the puzzle's "Solved when" rule (on unless the designer keeps a rule of their own). */
export const treeDrives = (puzzle: StoryObject | undefined): boolean => nodesOf(puzzle).length > 0 && puzzle?.data.treeRule !== false;


/** Whether a puzzle's steps need its progress remembered (order, time, links, rewards, wrong moves), not just its rule. */
export const usesProgress = (nodes: readonly PuzzleNode[]): boolean =>
  nodes.some((n) => n.gate === 'sequence' || (n.within ?? 0) > 0 || !!n.requires?.length || !!n.effects?.length || !!n.fail?.when);
