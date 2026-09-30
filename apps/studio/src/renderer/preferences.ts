import { useSyncExternalStore } from 'react';
import { setDefaultVo } from './model/scene';
import type { DialogueLine } from './model/types';

/**
 * Preferences belong to this computer, not to the project: they live in the
 * browser's (or the desktop app's) local storage and never travel in a file.
 */
export interface Preferences {
  /** With a project file open, save it by itself a moment after each edit. */
  autosave: boolean;
  /** Start where you left off; off starts each session on a blank project. */
  reopenLast: boolean;
  /** What a mouse wheel does on the graph and the mind map. A trackpad always pans. */
  wheel: 'zoom' | 'pan';
  showMinimap: boolean;
  showGrid: boolean;
  /** Resting the pointer on a scene card shows its summary and key flags. */
  scenePreviews: boolean;
  /** Script text size, in pixels. */
  scriptSize: number;
  /** The VO status a new dialogue line starts with. */
  defaultVo: DialogueLine['vo'];
  /** Mark a speaker's cue (CONT'D) when they speak again with only action in between. */
  contd: boolean;
  /** Interface scale, in percent (desktop). */
  uiScale: number;
  /** Palette tools pinned to the top, on the graph and inside a scene (spec §4). */
  pinned: { graph: string[]; scene: string[] };
  /** Palette groups folded away. */
  paletteCollapsed: Record<string, boolean>;
  /** Level Play Mode's controls (spec §9.2): only what differs from the defaults in components/level/input.ts. */
  playControls: PlayControlPrefs;
  /** Your name and role, on your comments and in each thing's edit history (spec §16). */
  authorName: string;
  authorRole: string;
}

export interface PlayControlPrefs {
  keys: Record<string, string[]>;
  pad: Record<string, number[]>;
  lookSpeed: number;
  invertY: boolean;
  deadzone: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  autosave: true,
  reopenLast: true,
  wheel: 'zoom',
  showMinimap: true,
  showGrid: true,
  scenePreviews: true,
  scriptSize: 14,
  defaultVo: 'todo',
  contd: true,
  uiScale: 100,
  pinned: { graph: [], scene: [] },
  paletteCollapsed: {},
  playControls: { keys: {}, pad: {}, lookSpeed: 1, invertY: false, deadzone: 0.18 },
  authorName: '',
  authorRole: '',
};

/** Who you are in comments and history: your name (or "You") and role. */
export const whoAmI = (p: Preferences = current): { name: string; role?: import('./model/collab').Role } => ({
  name: p.authorName.trim() || 'You',
  ...(p.authorRole ? { role: p.authorRole as import('./model/collab').Role } : {}),
});

const KEY = 'vcgs.prefs.v1';

const read = (): Preferences => {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    const merged = { ...DEFAULT_PREFERENCES };
    for (const k of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
      if (typeof stored[k] === typeof DEFAULT_PREFERENCES[k]) (merged as Record<string, unknown>)[k] = stored[k];
    }
    return merged;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
};

let current = read();
const listeners = new Set<() => void>();

const applySideEffects = (p: Preferences) => {
  setDefaultVo(p.defaultVo);
  (globalThis as { vcgs?: { setZoom?: (f: number) => void } }).vcgs?.setZoom?.(p.uiScale / 100);
};
applySideEffects(current);

// Another window changed them: take them up here too.
globalThis.addEventListener?.('storage', (e: StorageEvent) => {
  if (e.key !== KEY) return;
  current = read();
  applySideEffects(current);
  for (const l of listeners) l();
});

export const getPreferences = (): Preferences => current;

export const setPreferences = (patch: Partial<Preferences>): void => {
  current = { ...current, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private windows: the preference lasts until the page closes.
  }
  applySideEffects(current);
  for (const l of listeners) l();
};

export const resetPreferences = (): void => setPreferences({ ...DEFAULT_PREFERENCES });

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePreferences = (): Preferences => useSyncExternalStore(subscribe, getPreferences, getPreferences);
