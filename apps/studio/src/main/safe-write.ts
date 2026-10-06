import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writing a project without ever leaving a half-written file, and keeping
 * earlier versions to go back to.
 *
 * A save goes to a temporary file beside the project and is renamed over it,
 * so a crash or power cut mid-write leaves the old file whole. Before the old
 * file is replaced, a copy of it goes to the backups folder: at most one copy
 * per project every ten minutes (autosave writes every few seconds), and the
 * newest twenty are kept.
 */

export const BACKUP_EVERY_MS = 10 * 60 * 1000;
export const BACKUPS_KEPT = 20;

/** One folder per project file: its name (readable) and a hash of its path (two projects of the same name stay apart). */
export const backupFolderFor = (root: string, projectPath: string): string => {
  const name = basename(projectPath).replace(/\.vcgs$/i, '').replace(/[^\w .-]+/g, ' ').trim().slice(0, 60) || 'Untitled';
  const hash = createHash('sha256').update(projectPath).digest('hex').slice(0, 8);
  return join(root, `${name} ${hash}`);
};

/** A file name that sorts by time and is safe on every system. */
export const stamp = (now: Date): string => `${now.toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z')}.vcgs`;

const exists = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** Copy the file as it is now into its backups folder, if the last copy is old enough, and trim the oldest. */
export const backUp = async (projectPath: string, root: string, now = new Date()): Promise<string | null> => {
  if (!(await exists(projectPath))) return null;
  const folder = backupFolderFor(root, projectPath);
  await mkdir(folder, { recursive: true });
  const copies = (await readdir(folder)).filter((f) => f.endsWith('.vcgs')).sort();
  const newest = copies.at(-1);
  if (newest) {
    const when = (await stat(join(folder, newest))).mtimeMs;
    if (now.getTime() - when < BACKUP_EVERY_MS) return null;
  }
  const target = join(folder, stamp(now));
  await copyFile(projectPath, target);
  const all = [...copies, basename(target)];
  for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) await rm(join(folder, old), { force: true });
  return target;
};

/** Write the whole file under another name beside it, then put it in place in one step. */
export const writeAtomically = async (path: string, content: string): Promise<void> => {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.saving`);
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

/** A save: back the old file up (best effort; a backup that fails never blocks the save), then write the new one safely. */
export const saveSafely = async (path: string, content: string, backupsRoot: string): Promise<void> => {
  await backUp(path, backupsRoot).catch(() => null);
  await writeAtomically(path, content);
};
