import { contextBridge } from 'electron';

/** What the renderer may know about its host. Nothing else crosses the bridge yet. */
contextBridge.exposeInMainWorld('vcgs', { platform: process.platform, desktop: true });
