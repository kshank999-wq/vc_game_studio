import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * The only things the renderer may do to the disk for the engine handoff:
 * pick an engine project folder, look at it, and write generated files
 * inside it. A path that would land outside the folder is refused.
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
  ipcMain.handle('vcgs:pick-folder', async () => {
    const window = getWindow();
    const options: OpenDialogOptions = { title: 'Choose your engine project folder', properties: ['openDirectory', 'createDirectory'] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('vcgs:check-folder', (_e, folder: unknown) => {
    if (typeof folder !== 'string' || !folder) return { exists: false, engineProject: false };
    return { exists: existsSync(folder), engineProject: existsSync(join(folder, 'project.godot')) };
  });

  ipcMain.handle('vcgs:write-files', async (_e, folder: unknown, files: unknown) => {
    if (typeof folder !== 'string' || !folder || !existsSync(folder)) throw new Error('That folder is not there any more. Choose it again.');
    if (!Array.isArray(files)) throw new Error('Nothing to write.');
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
