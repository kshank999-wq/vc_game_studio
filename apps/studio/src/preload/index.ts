import { contextBridge, ipcRenderer, webFrame } from 'electron';

/** What the renderer may ask of its host: project files, and the engine handoff's writes. */
contextBridge.exposeInMainWorld('vcgs', {
  platform: process.platform,
  desktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('vcgs:pick-folder'),
  checkFolder: (folder: string): Promise<{ exists: boolean; engineProject: boolean }> => ipcRenderer.invoke('vcgs:check-folder', folder),
  writeFiles: (folder: string, files: { path: string; content: string }[]): Promise<{ written: number }> =>
    ipcRenderer.invoke('vcgs:write-files', folder, files),
  openProject: (): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('vcgs:open-project'),
  readProject: (path: string): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('vcgs:read-project', path),
  saveProject: (path: string | null, content: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('vcgs:save-project', path, content, suggestedName),
  setDirty: (dirty: boolean): void => ipcRenderer.send('vcgs:set-dirty', dirty),
  close: (): void => ipcRenderer.send('vcgs:close'),
  setZoom: (factor: number): void => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  onCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_e: unknown, command: string) => listener(command);
    ipcRenderer.on('vcgs:command', handler);
    return () => ipcRenderer.removeListener('vcgs:command', handler);
  },
});
