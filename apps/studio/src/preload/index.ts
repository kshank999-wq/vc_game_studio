import { contextBridge, ipcRenderer } from 'electron';

/** What the renderer may ask of its host. The engine handoff is the only thing that writes to disk. */
contextBridge.exposeInMainWorld('vcgs', {
  platform: process.platform,
  desktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('vcgs:pick-folder'),
  checkFolder: (folder: string): Promise<{ exists: boolean; engineProject: boolean }> => ipcRenderer.invoke('vcgs:check-folder', folder),
  writeFiles: (folder: string, files: { path: string; content: string }[]): Promise<{ written: number }> =>
    ipcRenderer.invoke('vcgs:write-files', folder, files),
});
