import type { Condition } from '../rules';
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
  /** For a sub-goal: all of its steps, or any one of them (alternate paths). */
  gate?: 'all' | 'any';
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

