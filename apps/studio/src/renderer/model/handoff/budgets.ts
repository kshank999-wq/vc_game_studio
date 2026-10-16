import { countLabel, METRICS, PLATFORMS } from '../level/budget';
import type { IrLevel } from './levels';

/**
 * BUDGETS.md (spec §19 performance budgets): each level's platform, its
 * limits and what the studio counted against them, for the engine and art
 * teams to profile the real thing against. Null when no level has a budget.
 */
export const budgetsMarkdown = (ir: { levels: readonly IrLevel[] }, engine: string, nameOf: (level: IrLevel) => string): string | null => {
  const levels = ir.levels.filter((l) => l.budget);
  if (!levels.length) return null;
  const out = [
    '# Performance budgets',
    '',
    `What each level may cost on the platform it is made for, set in VC Game Studio, and what the studio counted from its graybox. The counts are estimates from what is placed (graybox pieces, imported models, lights, people, walkable cells); profile the real level in ${engine} against the same limits. Over budget is marked **over**.`,
    '',
  ];
  for (const l of levels) {
    const b = l.budget!;
    out.push(`## ${l.name} · ${nameOf(l)}`, '', `Made for: **${PLATFORMS.find((p) => p.id === b.platform)?.label ?? b.platform}**`, '', '| | Counted | Budget | |', '|---|---:|---:|---|');
    for (const m of METRICS) out.push(`| ${m.label} | ${countLabel(b.counts[m.id])} | ${countLabel(b.limits[m.id])} | ${b.over.includes(m.id) ? '**over**' : ''} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
};
