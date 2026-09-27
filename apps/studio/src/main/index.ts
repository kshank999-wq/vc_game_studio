import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerHandoff } from './handoff';
import { guardClose, registerProjectFiles, setNativeMenu } from './project-files';

/**
 * Electron main process for VC Game Studio.
 *
 * The renderer is the whole app; this process owns the window, the file
 * dialogs and the few disk writes the renderer may ask for.
 */

const isDevelopment = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
registerHandoff(() => mainWindow);
registerProjectFiles(() => mainWindow);

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
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
  });

  mainWindow = window;
  guardClose(window);
  window.on('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  // External links (the store page, docs) open in the browser, never in the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDevelopment && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

void app.whenReady().then(() => {
  setNativeMenu(() => mainWindow);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
