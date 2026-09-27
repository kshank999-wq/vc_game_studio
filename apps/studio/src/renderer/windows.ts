import { desktop } from './desktop';
import type { Destination } from './model/details';
import type { Project } from './model/types';

/**
 * Several windows on one project, one per monitor: the main window keeps the
 * story graph (the spine) and owns the project, its undo history and its
 * file; other windows show the Game Bible, the engine handoff, a scene or
 * another view of the graph, and send every edit to the main window, which
 * sends the new project to all of them.
 *
 * On the desktop the messages go through the host process; in a browser
 * through a BroadcastChannel named for the main window's session.
 */

export type PanelView =
  | { view: 'graph' }
  | { view: 'bible'; focus?: string }
  | { view: 'engine' }
  | { view: 'play' }
  | { view: 'level'; focus?: string }
  | { view: 'scene'; sceneId: string; mode: 'open' | 'exploded' | 'timeline' };

export type Role = { kind: 'main'; session: string } | { kind: 'panel'; session: string; start: PanelView };

export interface Shared {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  saveState: string;
  fileName?: string;
  unsaved: boolean;
}

export type Command = 'save' | 'saveAs' | 'new' | 'newSample' | 'open' | 'openRecent' | 'preferences';

export type Message =
  | ({ t: 'state' } & Shared)
  | { t: 'closed' }
  | { t: 'hello' }
  | { t: 'commit'; project: Project }
  | { t: 'replace'; project: Project }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'command'; name: Command; arg?: string }
  | { t: 'navigate'; to: Destination };

const newSession = () => Math.random().toString(36).slice(2, 10);

export const parseView = (params: URLSearchParams): PanelView => {
  const view = params.get('view');
  if (view === 'bible' || view === 'level') return { view, ...(params.get('focus') ? { focus: params.get('focus')! } : {}) };
  if (view === 'engine' || view === 'play') return { view };
  if (view === 'scene' && params.get('scene')) {
    const mode = params.get('mode');
    return { view, sceneId: params.get('scene')!, mode: mode === 'exploded' || mode === 'timeline' ? mode : 'open' };
  }
  return { view: 'graph' };
};

export const viewQuery = (view: PanelView, session: string): string => {
  const q = new URLSearchParams({ window: 'panel', session, view: view.view });
  if ((view.view === 'bible' || view.view === 'level') && view.focus) q.set('focus', view.focus);
  if (view.view === 'scene') {
    q.set('scene', view.sceneId);
    q.set('mode', view.mode);
  }
  return q.toString();
};

const readRole = (): Role => {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  if (params.get('window') === 'panel' && params.get('session')) return { kind: 'panel', session: params.get('session')!, start: parseView(params) };
  return { kind: 'main', session: newSession() };
};

export const role: Role = readRole();
export const isPanel = role.kind === 'panel';

// ---------------------------------------------------------------- the message bus

type Listener = (message: Message) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

const deliver = (message: Message) => {
  for (const l of listeners) l(message);
};

const connect = () => {
  const bridge = desktop();
  if (bridge?.onBus) {
    bridge.onBus((m) => deliver(m as Message));
    return;
  }
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(`vcgs:${role.session}`);
  channel.onmessage = (e: MessageEvent<Message>) => deliver(e.data);
};
connect();

export const post = (message: Message): void => {
  const bridge = desktop();
  if (bridge?.postBus) bridge.postBus(message);
  else channel?.postMessage(message);
};

export const listen = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ---------------------------------------------------------------- a panel's copy of the project

let shared: Shared | null = null;
let mainClosed = false;
const sharedListeners = new Set<() => void>();
const notify = () => sharedListeners.forEach((l) => l());

if (isPanel) {
  listen((m) => {
    if (m.t === 'state') {
      const { t: _t, ...state } = m;
      shared = state;
      notify();
    } else if (m.t === 'closed') {
      mainClosed = true;
      notify();
    }
  });
  post({ t: 'hello' });
  // Ask again in case the main window was still starting.
  setTimeout(() => !shared && post({ t: 'hello' }), 600);
}

export const subscribeShared = (listener: () => void) => {
  sharedListeners.add(listener);
  return () => sharedListeners.delete(listener);
};
export const getShared = (): Shared | null => shared;
export const isMainClosed = (): boolean => mainClosed;

/** A panel's own edit shows at once; the main window's answer replaces it. */
export const setSharedProject = (project: Project): void => {
  if (!shared) return;
  shared = { ...shared, project };
  notify();
};

// ---------------------------------------------------------------- opening windows

export type Side = 'left' | 'right';

/** The side a view opens on, with the spine's window in the middle. */
export const sideFor = (view: PanelView): Side => (view.view === 'bible' ? 'left' : 'right');

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  left: number;
}
interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

/**
 * In a browser, put the window on the monitor beside this one when the
 * browser can say where the monitors are (the Window Management API asks
 * the first time); otherwise beside this window.
 */
const browserPlacement = async (side: Side): Promise<string> => {
  const w = globalThis as unknown as { getScreenDetails?: () => Promise<ScreenDetails> };
  try {
    if (w.getScreenDetails) {
      const details = await w.getScreenDetails();
      const screens = [...details.screens].sort((a, b) => a.left - b.left);
      const at = screens.indexOf(details.currentScreen);
      const next = screens[side === 'left' ? at - 1 : at + 1] ?? screens.find((s) => s !== details.currentScreen);
      if (next) return `left=${next.availLeft},top=${next.availTop},width=${next.availWidth},height=${next.availHeight}`;
    }
  } catch {
    // Not allowed: place it beside this window instead.
  }
  const width = Math.round(window.outerWidth * 0.6);
  const left = side === 'left' ? window.screenX - width : window.screenX + window.outerWidth;
  return `left=${Math.max(0, left)},top=${window.screenY},width=${width},height=${window.outerHeight}`;
};

/** Open a view in its own window (one window per kind of view; opening it again brings it forward there). */
export const openWindow = async (view: PanelView): Promise<void> => {
  const query = viewQuery(view, role.session);
  const bridge = desktop();
  if (bridge?.openWindow) {
    await bridge.openWindow(query, sideFor(view));
    return;
  }
  const url = `${location.pathname}?${query}`;
  const features = `popup,${await browserPlacement(sideFor(view))}`;
  const opened = window.open(url, `vcgs-${role.session}-${view.view}`, features);
  opened?.focus();
};
