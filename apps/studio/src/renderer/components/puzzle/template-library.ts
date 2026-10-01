import { useSyncExternalStore } from 'react';
import { BUILT_IN_TEMPLATES, type PuzzleTemplate } from '../../model/puzzle/templates';

/**
 * Personal puzzle templates (puzzle spec §9): kept on this computer, for any
 * project, next to the built-in ones. A puzzle made from one is the
 * project's own; the template stays as it was.
 */

const KEY = 'vcgs.puzzle-templates.v1';
const listeners = new Set<() => void>();
let cache: PuzzleTemplate[] | null = null;

const read = (): PuzzleTemplate[] => {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    cache = Array.isArray(parsed) ? (parsed as PuzzleTemplate[]).filter((t) => t && typeof t.id === 'string' && Array.isArray(t.elements)) : [];
  } catch {
    cache = [];
  }
  return cache;
};

/** False when the browser wouldn't keep it (out of room): it is there until the page closes. */
const write = (list: PuzzleTemplate[]): boolean => {
  cache = list;
  let kept = true;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    kept = false;
  }
  for (const l of listeners) l();
  return kept;
};

export const personalTemplates = (): PuzzleTemplate[] => read();

export const saveTemplate = (t: PuzzleTemplate): boolean => write([...read().filter((x) => x.id !== t.id), { ...t, builtIn: undefined }]);

export const forgetTemplate = (id: string): void => {
  write(read().filter((t) => t.id !== id));
};

/** For tests: forget what was read. */
export const resetTemplateCache = () => {
  cache = null;
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Built-in templates, then this computer's. */
export const useTemplates = (): PuzzleTemplate[] => {
  const mine = useSyncExternalStore(subscribe, read, read);
  return [...BUILT_IN_TEMPLATES, ...mine];
};
