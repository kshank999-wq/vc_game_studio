import { isPreview } from '../edition';
import type { Project } from './types';

/**
 * The working copy, kept in local storage so nothing is lost between
 * sessions. Saving for real writes a project file (.vcgs, see files.ts);
 * the preview edition saves neither.
 */

const KEY = 'vcgs.project.v1';

export const canSave = (): boolean => !isPreview();

/** The project format this version writes. Raise it with a migration below whenever the shape changes. */
export const PROJECT_VERSION = 1;

/**
 * Each step lifts a project from one version to the next, so a file saved by
 * any earlier version opens. None yet: version 1 is the first.
 */
const MIGRATIONS: Record<number, (project: Record<string, unknown>) => Record<string, unknown>> = {};

const isProject = (value: unknown): value is Project => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Project>;
  return typeof p.objects === 'object' && Array.isArray(p.lanes) && p.lanes.some((l) => l.kind === 'spine') && typeof p.placements === 'object';
};

/** Why a file did not open: not a project at all, or one saved by a newer version of the app. */
export type Unreadable = 'not-a-project' | 'newer';

/** A project from parsed JSON, brought up to this version, or why it can't be. */
export const readProjectOrWhy = (parsed: unknown): Project | Unreadable => {
  if (!parsed || typeof parsed !== 'object' || (parsed as { format?: unknown }).format !== 'vcgs') return 'not-a-project';
  let p = parsed as Record<string, unknown>;
  const version = typeof p['version'] === 'number' ? p['version'] : 0;
  if (version > PROJECT_VERSION) return 'newer';
  for (let v = Math.max(1, version); v < PROJECT_VERSION; v++) p = { ...(MIGRATIONS[v]?.(p) ?? p), version: v + 1 };
  p = { ...p, version: PROJECT_VERSION };
  if (!isProject(p)) return 'not-a-project';
  // Projects saved before scenes had scripts have no lines yet.
  const list = <T,>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  return { ...p, lines: list(p.lines), events: list(p.events), branches: list(p.branches) };
};

/** A project from parsed JSON, or null when it isn't one. Older projects gain what they lack. */
export const readProject = (parsed: unknown): Project | null => {
  const read = readProjectOrWhy(parsed);
  return typeof read === 'string' ? null : read;
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
