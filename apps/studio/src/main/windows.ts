import { app, BrowserWindow, ipcMain, screen, shell, type BrowserWindowConstructorOptions } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arrange, beside, centreDisplay, onScreen, sideDisplay, type Rect, type Side } from './placement';

/**
 * The studio's windows. The main window holds the story graph and owns the
 * project; the others (Game Bible, engine handoff, a scene, another graph)
 * are opened from its Window menu, one of each kind, each on the monitor to
 * its side. Where every window was is remembered for next time, and messages
 * between the windows are relayed through here.
 */

const isDevelopment = !app.isPackaged;
const layoutFile = () => join(app.getPath('userData'), 'window-layout.json');

type Layout = Record<string, Rect>;
let layout: Layout = {};
const readLayout = () => {
  try {
    layout = JSON.parse(readFileSync(layoutFile(), 'utf8')) as Layout;
  } catch {
    layout = {};
  }
};
const remember = (key: string, window: BrowserWindow) => {
  if (window.isDestroyed() || window.isMinimized()) return;
  layout[key] = window.isMaximized() ? screen.getDisplayMatching(window.getBounds()).workArea : window.getBounds();
  void writeFile(layoutFile(), JSON.stringify(layout, null, 1)).catch(() => undefined);
};

const displays = () => screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
/** Saved bounds, if they are still mostly on a monitor that is plugged in. */
const saved = (key: string): Rect | null => (layout[key] && onScreen(layout[key], displays()) > 0.6 ? layout[key] : null);

let main: BrowserWindow | null = null;
const panels = new Map<string, { window: BrowserWindow; side: Side }>();

const options = (bounds: Rect | null, extra: BrowserWindowConstructorOptions = {}): BrowserWindowConstructorOptions => ({
  ...(bounds ?? { width: 1440, height: 900 }),
  minWidth: 720,
  minHeight: 520,
  show: false,
  backgroundColor: '#0b0a07',
  title: 'VC Game Studio',
  ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
  ...extra,
});

const load = (window: BrowserWindow, query?: string) => {
  // External links (the store page, docs) open in the browser, never in the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDevelopment && devServerUrl) void window.loadURL(query ? `${devServerUrl}?${query}` : devServerUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: query } : undefined);
};

const track = (key: string, window: BrowserWindow) => {
  window.on('moved', () => remember(key, window));
  window.on('resized', () => remember(key, window));
  window.on('close', () => remember(key, window));
};

/** The main window: where it was last time, else filling the middle monitor. */
export const createMainWindow = (onCreated: (window: BrowserWindow) => void): BrowserWindow => {
  readLayout();
  const place = saved('main');
  const all = displays();
  const centre = centreDisplay(all, screen.getPrimaryDisplay().id);
  const window = new BrowserWindow(options(place ?? (all.length > 1 ? centre.workArea : null), { minWidth: 1024, minHeight: 640 }));
  main = window;
  track('main', window);
  window.on('ready-to-show', () => {
    if (!place && all.length > 1) window.maximize();
    window.show();
  });
  window.on('closed', () => {
    if (main === window) main = null;
    // The other windows work on the main window's project: they go with it.
    for (const { window: w } of panels.values()) if (!w.isDestroyed()) w.destroy();
    panels.clear();
  });
  onCreated(window);
  load(window);
  return window;
};

export const mainWindow = (): BrowserWindow | null => main;

const keyOf = (query: string) => new URLSearchParams(query).get('view') ?? 'graph';

const openPanel = (query: string, side: Side) => {
  const key = keyOf(query);
  const open = panels.get(key);
  if (open && !open.window.isDestroyed()) {
    open.window.webContents.send('vcgs:command', `route:${query}`);
    open.window.show();
    open.window.focus();
    return;
  }
  const all = displays();
  const from = main ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
  const target = sideDisplay(all, from.id, side);
  const bounds = saved(key) ?? (target ? target.workArea : beside(from.workArea, panels.size));
  const window = new BrowserWindow(options(bounds));
  panels.set(key, { window, side });
  track(key, window);
  window.on('ready-to-show', () => {
    if (!saved(key) && target) window.maximize();
    window.show();
  });
  window.on('closed', () => {
    if (panels.get(key)?.window === window) panels.delete(key);
  });
  load(window, query);
};

/** The main window on the middle monitor, the Bible to its left, the rest to its right. */
const arrangeAll = () => {
  const open = [...panels.entries()].filter(([, p]) => !p.window.isDestroyed());
  const plan = arrange(displays(), screen.getPrimaryDisplay().id, open.map(([key, p]) => ({ key, side: p.side })));
  const place = (window: BrowserWindow, rect: Rect) => {
    if (window.isMaximized()) window.unmaximize();
    if (window.isFullScreen()) window.setFullScreen(false);
    window.setBounds(rect);
    window.show();
  };
  if (main) place(main, plan.main);
  for (const [key, p] of open) if (plan.panels[key]) place(p.window, plan.panels[key]);
  main?.focus();
  return { displays: displays().length, windows: open.length + (main ? 1 : 0) };
};

export const registerWindows = (): void => {
  ipcMain.handle('vcgs:open-window', (_e, query: unknown, side: unknown) => {
    if (typeof query !== 'string' || query.length > 2000) return;
    openPanel(query, side === 'left' ? 'left' : 'right');
  });
  ipcMain.handle('vcgs:arrange-windows', () => arrangeAll());
  ipcMain.handle('vcgs:display-count', () => screen.getAllDisplays().length);
  ipcMain.on('vcgs:focus-main', () => {
    main?.show();
    main?.focus();
  });
  // Relay a message from one window to all the others.
  ipcMain.on('vcgs:bus', (e, message: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender && !w.isDestroyed()) w.webContents.send('vcgs:bus', message);
  });

  // A monitor unplugged: bring anything that was on it back onto one that is there.
  screen.on('display-removed', () => {
    const all = displays();
    for (const w of BrowserWindow.getAllWindows()) {
      if (onScreen(w.getBounds(), all) < 0.3) w.setBounds(beside(screen.getPrimaryDisplay().workArea, 0));
    }
  });
};
