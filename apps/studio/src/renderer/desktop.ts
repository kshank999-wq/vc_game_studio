/** The desktop host's bridge (src/preload), or undefined in a browser. */
export interface DesktopBridge {
  platform: string;
  desktop: true;
  pickFolder: () => Promise<string | null>;
  checkFolder: (folder: string) => Promise<{ exists: boolean; engineProject: boolean }>;
  writeFiles: (folder: string, files: { path: string; content: string }[]) => Promise<{ written: number }>;
  openProject?: () => Promise<{ path: string; content: string } | null>;
  readProject?: (path: string) => Promise<{ path: string; content: string } | null>;
  saveProject?: (path: string | null, content: string, suggestedName: string) => Promise<string | null>;
  setDirty?: (dirty: boolean) => void;
  close?: () => void;
  setZoom?: (factor: number) => void;
  /** Commands from the native menu and the close dialog. */
  onCommand?: (listener: (command: string) => void) => () => void;
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
