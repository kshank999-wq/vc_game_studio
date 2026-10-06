import type { StoryObject } from './types';

/**
 * Timed choices (spec §7): a choice can give the player a number of seconds
 * to answer, and say which option it takes when time runs out (the first one
 * on offer when it doesn't say, or names one that isn't on offer).
 */

/** Seconds to answer; 0 when there is no limit. */
export const timeLimitOf = (choice: StoryObject | undefined): number => {
  const n = Number(choice?.data.timeLimit);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The option named to take when time runs out, as written ('' for the first on offer). */
export const timeoutLabelOf = (choice: StoryObject | undefined): string => String(choice?.data.onTimeout ?? '').trim();

/** Which of these options time running out picks: the named one if it is on offer, else the first that is; -1 when none is. */
export const timeoutPick = (options: readonly { label: string; available: boolean }[], label: string): number => {
  const want = label.trim().toLowerCase();
  const named = want ? options.findIndex((o) => o.available && o.label.trim().toLowerCase() === want) : -1;
  return named >= 0 ? named : options.findIndex((o) => o.available);
};
