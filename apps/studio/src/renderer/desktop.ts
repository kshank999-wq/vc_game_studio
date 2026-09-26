/** The desktop host's bridge (src/preload), or undefined in a browser. */
export interface DesktopBridge {
  platform: string;
  desktop: true;
  pickFolder: () => Promise<string | null>;
  checkFolder: (folder: string) => Promise<{ exists: boolean; engineProject: boolean }>;
  writeFiles: (folder: string, files: { path: string; content: string }[]) => Promise<{ written: number }>;
}

export const desktop = (): DesktopBridge | undefined => (globalThis as { vcgs?: DesktopBridge }).vcgs;
