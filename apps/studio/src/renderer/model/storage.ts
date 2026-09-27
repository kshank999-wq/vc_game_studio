import type { Project } from './types';

/**
 * The working copy, kept in local storage so nothing is lost between
 * sessions. Saving for real writes a project file (.vcgs, see files.ts);
 * the preview edition saves neither.
 */

const KEY = 'vcgs.project.v1';

export const canSave = (): boolean => __EDITION__ === 'full';

const isProject = (value: unknown): value is Project => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Project>;
  return (
    p.format === 'vcgs' &&
    p.version === 1 &&
    typeof p.objects === 'object' &&
    Array.isArray(p.lanes) &&
    p.lanes.some((l) => l.kind === 'spine') &&
    typeof p.placements === 'object'
  );
};

/** A project from parsed JSON, or null when it isn't one. Older projects gain what they lack. */
export const readProject = (parsed: unknown): Project | null => {
  // Projects saved before scenes had scripts have no lines yet.
  if (!isProject(parsed)) return null;
  const list = <T,>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  return { ...parsed, lines: list(parsed.lines), events: list(parsed.events), branches: list(parsed.branches) };
};

export const loadProject = (): Project | null => {
  if (!canSave()) return null;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    return readProject(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const saveProject = (project: Project): boolean => {
  if (!canSave()) return false;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
};
