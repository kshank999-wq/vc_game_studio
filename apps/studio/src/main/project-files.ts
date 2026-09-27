import { app, dialog, ipcMain, Menu, type BrowserWindow, type MenuItemConstructorOptions, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';

/**
 * Project files (.vcgs): open and save through the system dialogs, reopen a
 * recent one, and ask before closing a window with unsaved changes. Only
 * absolute paths to .vcgs files are ever read or written.
 */

const FILTERS = [{ name: 'VC Game Studio project', extensions: ['vcgs'] }];
const isProjectPath = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && extname(path).toLowerCase() === '.vcgs' && !path.includes('\0');

const dirty = new WeakSet<Electron.WebContents>();

export const registerProjectFiles = (getWindow: () => BrowserWindow | null): void => {
  ipcMain.handle('vcgs:open-project', async () => {
    const window = getWindow();
    const options: OpenDialogOptions = { title: 'Open a project', filters: FILTERS, properties: ['openFile'] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!isProjectPath(path)) return null;
    app.addRecentDocument(path);
    return { path, content: await readFile(path, 'utf8') };
  });

  ipcMain.handle('vcgs:read-project', async (_e, path: unknown) => {
    if (!isProjectPath(path)) return null;
    try {
      const content = await readFile(path, 'utf8');
      app.addRecentDocument(path);
      return { path, content };
    } catch {
      return null;
    }
  });

  ipcMain.handle('vcgs:save-project', async (_e, path: unknown, content: unknown, suggestedName: unknown) => {
    if (typeof content !== 'string') throw new Error('Nothing to save.');
    let target = isProjectPath(path) ? path : null;
    if (!target) {
      const window = getWindow();
      const options: SaveDialogOptions = { title: 'Save the project', filters: FILTERS, defaultPath: typeof suggestedName === 'string' ? suggestedName : 'Untitled.vcgs' };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      target = extname(result.filePath) ? result.filePath : `${result.filePath}.vcgs`;
      if (!isProjectPath(target)) throw new Error('Projects are saved as .vcgs files.');
    }
    await writeFile(target, content, 'utf8');
    app.addRecentDocument(target);
    return target;
  });

  ipcMain.on('vcgs:set-dirty', (e, value: unknown) => {
    if (value) dirty.add(e.sender);
    else dirty.delete(e.sender);
  });

  ipcMain.on('vcgs:close', (e) => {
    dirty.delete(e.sender);
    getWindow()?.close();
  });
};

/** Before a window with unsaved changes closes, offer to save them. */
export const guardClose = (window: BrowserWindow): void => {
  window.on('close', (e) => {
    if (!dirty.has(window.webContents)) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Save', 'Don’t save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save your changes before closing?',
      detail: 'Your changes will be lost if you don’t save them.',
    });
    if (choice === 0) window.webContents.send('vcgs:command', 'save-then-close');
    if (choice === 1) {
      dirty.delete(window.webContents);
      window.destroy();
    }
  });
};

/**
 * The studio has its own menu bar inside the window. The native one is kept
 * only where the system expects it: the macOS app menu (About, Preferences,
 * Quit) and the clipboard commands text fields need there.
 */
export const setNativeMenu = (getWindow: () => BrowserWindow | null): void => {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const send = (command: string) => () => getWindow()?.webContents.send('vcgs:command', command);
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: 'About VC Game Studio', click: send('about') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: send('preferences') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
