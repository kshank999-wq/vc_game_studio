import type { Project } from './types';

/** Undo works at the level of one user interaction: one drop, one drag, one rename. */
export interface History {
  past: Project[];
  present: Project;
  future: Project[];
}

const LIMIT = 200;

export const startHistory = (present: Project): History => ({ past: [], present, future: [] });

export const commit = (history: History, next: Project): History =>
  next === history.present
    ? history
    : { past: [...history.past, history.present].slice(-LIMIT), present: next, future: [] };

export const undo = (history: History): History => {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
};

export const redo = (history: History): History => {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
};
