import type { Project } from './types';

/**
 * Autosave for the browser build. The desktop app will write project files
 * instead; the preview edition never saves at all.
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

export const loadProject = (): Project | null => {
  if (!canSave()) return null;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Projects saved before scenes had scripts have no lines yet.
    return isProject(parsed) ? { ...parsed, lines: Array.isArray(parsed.lines) ? parsed.lines : [] } : null;
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
