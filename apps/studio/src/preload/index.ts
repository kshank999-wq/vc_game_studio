import { contextBridge, ipcRenderer, webFrame } from 'electron';

/** What the renderer may ask of its host: project files, windows across monitors, the engine handoff's writes and the license. */
contextBridge.exposeInMainWorld('vcgs', {
  platform: process.platform,
  desktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('vcgs:pick-folder'),
  checkFolder: (folder: string): Promise<{ exists: boolean; engineProject: boolean; unity?: boolean; unreal?: boolean }> => ipcRenderer.invoke('vcgs:check-folder', folder),
  writeFiles: (folder: string, files: { path: string; content: string }[]): Promise<{ written: number }> =>
    ipcRenderer.invoke('vcgs:write-files', folder, files),
  readFiles: (folder: string, paths: string[]): Promise<Record<string, string | null>> => ipcRenderer.invoke('vcgs:read-files', folder, paths),
  savePackage: (suggestedName: string, bytes: Uint8Array): Promise<string | null> => ipcRenderer.invoke('vcgs:save-package', suggestedName, bytes),
  openProject: (): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('vcgs:open-project'),
  readProject: (path: string): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('vcgs:read-project', path),
  saveProject: (path: string | null, content: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('vcgs:save-project', path, content, suggestedName),
  setDirty: (dirty: boolean): void => ipcRenderer.send('vcgs:set-dirty', dirty),
  close: (): void => ipcRenderer.send('vcgs:close'),
  setZoom: (factor: number): void => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  openWindow: (query: string, side: 'left' | 'right'): Promise<void> => ipcRenderer.invoke('vcgs:open-window', query, side),
  arrangeWindows: (): Promise<{ displays: number; windows: number }> => ipcRenderer.invoke('vcgs:arrange-windows'),
  displayCount: (): Promise<number> => ipcRenderer.invoke('vcgs:display-count'),
  focusMain: (): void => ipcRenderer.send('vcgs:focus-main'),
  postBus: (message: unknown): void => ipcRenderer.send('vcgs:bus', message),
  onBus: (listener: (message: unknown) => void): (() => void) => {
    const handler = (_e: unknown, message: unknown) => listener(message);
    ipcRenderer.on('vcgs:bus', handler);
    return () => ipcRenderer.removeListener('vcgs:bus', handler);
  },
  /** The license (src/main/licensing.ts): what this copy may do, and signing in to activate it. */
  license: {
    now: (): unknown => ipcRenderer.sendSync('vcgs:license-now'),
    onChange: (listener: (access: unknown) => void): (() => void) => {
      const handler = (_e: unknown, access: unknown) => listener(access);
      ipcRenderer.on('vcgs:license', handler);
      return () => ipcRenderer.removeListener('vcgs:license', handler);
    },
    requestCode: (email: string): Promise<unknown> => ipcRenderer.invoke('vcgs:license-request-code', email),
    verifyCode: (email: string, code: string): Promise<unknown> => ipcRenderer.invoke('vcgs:license-verify-code', email, code),
    activate: (serial?: string): Promise<unknown> => ipcRenderer.invoke('vcgs:license-activate', serial),
    refresh: (): Promise<unknown> => ipcRenderer.invoke('vcgs:license-refresh'),
    signOut: (): Promise<unknown> => ipcRenderer.invoke('vcgs:license-sign-out'),
    open: (page: string): Promise<void> => ipcRenderer.invoke('vcgs:license-open', page),
  },
  takeOpenFile: (): Promise<string | null> => ipcRenderer.invoke('vcgs:take-open-file'),
  showBackups: (): Promise<void> => ipcRenderer.invoke('vcgs:show-backups'),
  showLogs: (): Promise<void> => ipcRenderer.invoke('vcgs:show-logs'),
  onCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_e: unknown, command: string) => listener(command);
    ipcRenderer.on('vcgs:command', handler);
    return () => ipcRenderer.removeListener('vcgs:command', handler);
  },
});
