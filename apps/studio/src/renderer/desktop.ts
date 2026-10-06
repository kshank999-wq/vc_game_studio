/** The desktop host's bridge (src/preload), or undefined in a browser. */
export interface DesktopBridge {
  platform: string;
  desktop: true;
  pickFolder: () => Promise<string | null>;
  checkFolder: (folder: string) => Promise<{ exists: boolean; engineProject: boolean; unity?: boolean; unreal?: boolean }>;
  writeFiles: (folder: string, files: { path: string; content: string }[]) => Promise<{ written: number }>;
  /** What is on disk now at these paths inside the folder (null for nothing), to notice edits made in the engine. */
  readFiles?: (folder: string, paths: string[]) => Promise<Record<string, string | null>>;
  openProject?: () => Promise<{ path: string; content: string } | null>;
  readProject?: (path: string) => Promise<{ path: string; content: string } | null>;
  saveProject?: (path: string | null, content: string, suggestedName: string) => Promise<string | null>;
  setDirty?: (dirty: boolean) => void;
  close?: () => void;
  setZoom?: (factor: number) => void;
  /** Commands from the native menu and the close dialog. */
  onCommand?: (listener: (command: string) => void) => () => void;
  /** A .vcgs file the app was launched to open, once. */
  takeOpenFile?: () => Promise<string | null>;
  /** Show the folder of project backups. */
  showBackups?: () => Promise<void>;
  /** Show the folder of the app's logs (for support). */
  showLogs?: () => Promise<void>;
  /** Windows: open a view in its own window, on the monitor to that side of the main one. */
  openWindow?: (query: string, side: 'left' | 'right') => Promise<void>;
  /** Put the main window on the middle monitor and the others beside it. */
  arrangeWindows?: () => Promise<{ displays: number; windows: number }>;
  focusMain?: () => void;
  displayCount?: () => Promise<number>;
  postBus?: (message: unknown) => void;
  onBus?: (listener: (message: unknown) => void) => () => void;
}

export const desktop = (): DesktopBridge | undefined => (globalThis as { vcgs?: DesktopBridge }).vcgs;
