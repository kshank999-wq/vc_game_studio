import type { Condition } from '../../model/rules';
import type { PuzzleNode } from '../../model/puzzle/tree';

/** What kind of gate a step's condition is (puzzle spec §6): state, an item, knowledge, a place. */
const GATE_OF: Partial<Record<Condition['kind'], string>> = {
  flag: 'STATE',
  object: 'STATE',
  item: 'ITEM',
  equipped: 'ITEM',
  lore: 'KNOW',
  visited: 'PLACE',
  skill: 'SKILL',
  stat: 'SKILL',
};

const BRANCH: Record<NonNullable<PuzzleNode['branch']>, string> = { reward: '★ reward', shortcut: '↷ shortcut', clue: '? clue', alternate: '⑂ alternate' };

/** The small marks a step carries in the tree and the graph. */
export const badgesOf = (n: PuzzleNode): string[] => [
  ...(n.kind !== 'goal' && n.when ? [GATE_OF[n.when.kind] ?? n.when.kind.toUpperCase()] : []),
  ...((n.within ?? 0) > 0 ? [`⏱ ${n.within}s`] : []),
  ...(n.requires?.length ? [`needs ${n.requires.length}`] : []),
  ...(n.fail?.when ? [n.fail.forward ? '⚠ fail-forward' : '⚠ wrong move'] : []),
  ...(n.effects?.length ? ['✦'] : []),
  ...(n.optional && n.branch ? [BRANCH[n.branch]] : []),
];
