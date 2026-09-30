/**
 * An engine project's folder in the browser, through the File System Access
 * API where the browser has it (Chrome and Edge): files read and written by
 * their paths under it, so a browser export can keep custom code and be
 * reviewed like the desktop app's. Elsewhere (and in embedded pages that may
 * not use it) the export downloads as a .zip instead.
 */

interface DirHandle {
  name: string;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{ getFile: () => Promise<File>; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;
}

export interface FolderAccess {
  name: string;
  read: (paths: readonly string[]) => Promise<Record<string, string | null>>;
  write: (files: readonly { path: string; content: string }[]) => Promise<number>;
}

const picker = () => (globalThis as { showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker;

/** Whether this browser can send to a folder. */
export const canPickFolder = (): boolean => typeof picker() === 'function';

const readFile = (file: File): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });

/** A folder's access, from a directory handle. */
export const folderAccess = (root: DirHandle): FolderAccess => {
  const dirOf = async (parts: string[], create: boolean): Promise<DirHandle> => {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };
  return {
    name: root.name,
    read: async (paths) => {
      const out: Record<string, string | null> = {};
      for (const path of paths) {
        const parts = path.split('/');
        try {
          const dir = await dirOf(parts.slice(0, -1), false);
          out[path] = await readFile(await (await dir.getFileHandle(parts.at(-1)!)).getFile());
        } catch {
          out[path] = null;
        }
      }
      return out;
    },
    write: async (files) => {
      for (const f of files) {
        const parts = f.path.split('/');
        const dir = await dirOf(parts.slice(0, -1), true);
        const writable = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
        await writable.write(f.content);
        await writable.close();
      }
      return files.length;
    },
  };
};

/** Ask for a folder; null when the person cancels (or the page may not ask). */
export const pickBrowserFolder = async (): Promise<FolderAccess | null> => {
  const pick = picker();
  if (!pick) return null;
  try {
    return folderAccess(await pick({ mode: 'readwrite' }));
  } catch {
    return null;
  }
};
