import { app, BrowserWindow } from 'electron';
import { registerHandoff } from './handoff';
import { registerLicensing } from './licensing-ipc';
import { guardClose, registerProjectFiles, setNativeMenu } from './project-files';
import { createMainWindow, mainWindow, registerWindows } from './windows';

/**
 * Electron main process for VC Game Studio.
 *
 * The renderer is the whole app; this process owns the windows (one per
 * monitor if you like, see windows.ts), the file dialogs and the few disk
 * writes the renderer may ask for.
 */

registerHandoff(mainWindow);
registerProjectFiles(mainWindow);

void app.whenReady().then(async () => {
  // Before the first window, so it opens knowing whether it may save.
  await registerLicensing();
  registerWindows();
  setNativeMenu(mainWindow);
  createMainWindow(guardClose);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(guardClose);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
