import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { licensing } from './licensing-ipc';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * The only things the renderer may do to the disk for the engine handoff:
 * pick an engine project folder, look at it, read back files it wrote there
 * (to notice edits made in the engine), and write generated files inside it.
 * A path that would land outside the folder is refused.
 */

interface File {
  path: string;
  content: string;
}

const inside = (root: string, path: string): string | null => {
  if (isAbsolute(path) || path.includes('\0')) return null;
  const target = resolve(root, path);
  const rel = relative(root, target);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? target : null;
};

export const registerHandoff = (getWindow: () => BrowserWindow | null): void => {
  ipcMain.handle('vcgs:pick-folder', async (e) => {
    // The dialog belongs to the window that asked (the handoff may be in a window of its own).
    const window = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    const options: OpenDialogOptions = { title: 'Choose your engine project folder', properties: ['openDirectory', 'createDirectory'] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('vcgs:check-folder', (_e, folder: unknown) => {
    if (typeof folder !== 'string' || !folder) return { exists: false, engineProject: false, unity: false, unreal: false };
    return {
      exists: existsSync(folder),
      // A Godot project has project.godot; a Unity project has Assets and ProjectSettings.
      engineProject: existsSync(join(folder, 'project.godot')),
      unity: existsSync(join(folder, 'Assets')) && existsSync(join(folder, 'ProjectSettings')),
      // An Unreal project has a .uproject file.
      unreal: existsSync(folder) && readdirSync(folder).some((f) => f.endsWith('.uproject')),
    };
  });

  // What is on disk now at the paths the last export wrote: null where there is nothing (or nothing readable).
  ipcMain.handle('vcgs:read-files', async (_e, folder: unknown, paths: unknown) => {
    if (typeof folder !== 'string' || !folder || !existsSync(folder) || !Array.isArray(paths)) return {};
    const root = resolve(folder);
    const out: Record<string, string | null> = {};
    for (const path of paths.slice(0, 5000)) {
      if (typeof path !== 'string') continue;
      const target = inside(root, path);
      if (!target || !existsSync(target)) {
        out[path] = null;
        continue;
      }
      try {
        out[path] = (await stat(target)).size > 8 * 1024 * 1024 ? null : await readFile(target, 'utf8');
      } catch {
        out[path] = null;
      }
    }
    return out;
  });

  ipcMain.handle('vcgs:write-files', async (_e, folder: unknown, files: unknown) => {
    if (typeof folder !== 'string' || !folder || !existsSync(folder)) throw new Error('That folder is not there any more. Choose it again.');
    if (!Array.isArray(files)) throw new Error('Nothing to write.');
    if (!licensing.canExport()) throw new Error('Engine export is part of the VC Game Studio plan. Upgrade on your account page.');
    const root = resolve(folder);
    let written = 0;
    for (const file of files as File[]) {
      if (typeof file?.path !== 'string' || typeof file?.content !== 'string') continue;
      const target = inside(root, file.path);
      if (!target) throw new Error(`Refused to write outside the project: ${file.path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
      written++;
    }
    return { written };
  });
};
