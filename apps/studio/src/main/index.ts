import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { checkForUpdate, guardProcess, guardWindow, log, logsFolder } from './guard';
import { registerHandoff } from './handoff';
import { projectInArgv } from './launch';
import { registerLicensing } from './licensing-ipc';
import { guardClose, registerProjectFiles, setNativeMenu } from './project-files';
import { createMainWindow, mainWindow, registerWindows } from './windows';

/**
 * Electron main process for VC Game Studio.
 *
 * The renderer is the whole app; this process owns the windows (one per
 * monitor if you like, see windows.ts), the file dialogs and the few disk
 * writes the renderer may ask for.
 *
 * One copy runs at a time: a second launch (a project double-clicked while
 * the app is open) hands its file to the running copy and quits, so two
 * copies never share one working copy.
 */

const SITE_URL = (import.meta.env.MAIN_VITE_SITE_URL || 'https://vc-gamestudio.com').replace(/\/+$/, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  guardProcess();

  /** A project the app was asked to open before its window could take it. */
  let pending: string | null = projectInArgv(process.argv, process.cwd());

  const openInApp = (path: string) => {
    const window = mainWindow();
    if (!window || window.webContents.isLoading()) {
      pending = path;
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send('vcgs:command', `open:${path}`);
  };

  // macOS: a project opened from Finder or dropped on the Dock icon, possibly before ready.
  app.on('open-file', (e, path) => {
    e.preventDefault();
    if (app.isReady()) openInApp(path);
    else pending = path;
  });

  // Windows: double-clicking a project while the app is open launches a second copy, which lands here.
  app.on('second-instance', (_e, argv, cwd) => {
    const path = projectInArgv(argv, cwd);
    if (path) openInApp(path);
    else {
      const window = mainWindow();
      if (window?.isMinimized()) window.restore();
      window?.focus();
    }
  });

  // The window asks once it is ready; the file is handed over only once.
  ipcMain.handle('vcgs:take-open-file', () => {
    const path = pending;
    pending = null;
    return path;
  });
  ipcMain.handle('vcgs:show-logs', () => shell.openPath(logsFolder()));

  registerHandoff(mainWindow);
  registerProjectFiles(mainWindow);

  const open = () =>
    createMainWindow((window) => {
      guardClose(window);
      guardWindow(window);
    });

  void app.whenReady().then(async () => {
    log('started');
    // Before the first window, so it opens knowing whether it may save.
    await registerLicensing();
    registerWindows();
    setNativeMenu(mainWindow);
    open();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) open();
    });
    // A little after start, so it never slows the first window.
    setTimeout(() => void checkForUpdate(SITE_URL, mainWindow), 15_000);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
