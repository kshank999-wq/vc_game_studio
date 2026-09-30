import { desktop } from './desktop';
import { readProject } from './model/storage';
import type { Project } from './model/types';

/**
 * Project files: one .vcgs file per project, plain JSON. On the desktop they
 * go through the host's open and save dialogs; in a browser through the File
 * System Access API where there is one, else a download and a file picker.
 */

export const EXTENSION = '.vcgs';

/** Where the open project lives on disk, if anywhere. */
export interface ProjectFile {
  name: string;
  /** Desktop: the full path. */
  path?: string;
  /** Browser: a handle to write back to. */
  handle?: FileSystemFileHandleLike;
}

/** The part of the File System Access API this uses (not in every TypeScript lib yet). */
interface FileSystemFileHandleLike {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}
type PickerOptions = { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[]; excludeAcceptAllOption?: boolean };
interface FilePickers {
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (options: PickerOptions & { multiple?: boolean }) => Promise<FileSystemFileHandleLike[]>;
}
const pickers = (): FilePickers => globalThis as unknown as FilePickers;
const TYPES = [{ description: 'VC Game Studio project', accept: { 'application/json': [EXTENSION] } }];

export const serialize = (project: Project): string => `${JSON.stringify(project, null, 1)}\n`;

export const parse = (text: string): Project | null => {
  try {
    return readProject(JSON.parse(text));
  } catch {
    return null;
  }
};

export const fileNameFor = (project: Project): string =>
  `${project.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'}${EXTENSION}`;

const isCancel = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export type Opened = { project: Project; file: ProjectFile } | { error: string } | null;

const opened = (text: string, file: ProjectFile): Opened => {
  const project = parse(text);
  return project ? { project, file } : { error: `“${file.name}” is not a VC Game Studio project.` };
};

/** Ask for a project file and read it. Null when the user cancels. */
export const openProjectFile = async (): Promise<Opened> => {
  const bridge = desktop();
  if (bridge?.openProject) {
    const result = await bridge.openProject();
    return result && opened(result.content, { name: baseName(result.path), path: result.path });
  }
  const { showOpenFilePicker } = pickers();
  if (showOpenFilePicker) {
    try {
      const [handle] = await showOpenFilePicker({ types: TYPES, multiple: false });
      if (!handle) return null;
      return opened(await (await handle.getFile()).text(), { name: handle.name, handle });
    } catch (error) {
      if (isCancel(error)) return null;
      // Pickers can be refused (an embedded page, say): fall back to a plain file input.
    }
  }
  return pickWithInput();
};

/** Reopen a recent file by its path (desktop). */
export const openRecent = async (path: string): Promise<Opened> => {
  const bridge = desktop();
  if (!bridge?.readProject) return { error: 'Recent files open in the desktop app.' };
  const result = await bridge.readProject(path);
  return result ? opened(result.content, { name: baseName(path), path }) : { error: `“${baseName(path)}” is not there any more.` };
};

const pickWithInput = (): Promise<Opened> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${EXTENSION},application/json`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void file.text().then((text) => resolve(opened(text, { name: file.name })));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });

/**
 * Write the project. With a file that can be written back to, it saves in
 * place; otherwise (or with `as`) it asks where. Null when the user cancels.
 */
export const saveProjectFile = async (project: Project, file: ProjectFile | null, as = false): Promise<ProjectFile | null> => {
  const content = serialize(project);
  const bridge = desktop();
  if (bridge?.saveProject) {
    const path = await bridge.saveProject(as ? null : (file?.path ?? null), content, file?.name ?? fileNameFor(project));
    return path ? { name: baseName(path), path } : null;
  }
  const { showSaveFilePicker } = pickers();
  if (showSaveFilePicker) {
    try {
      const handle = !as && file?.handle ? file.handle : await showSaveFilePicker({ suggestedName: file?.name ?? fileNameFor(project), types: TYPES });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { name: handle.name, handle };
    } catch (error) {
      if (isCancel(error)) return null;
      // Refused (an embedded page, say): download a copy instead.
    }
  }
  // No way to write back: download a copy each time.
  const name = file?.name ?? fileNameFor(project);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name };
};

/** Hand the person a text file to keep (a download). */
export const downloadText = (name: string, text: string, type = 'text/plain'): void => {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Put text on the clipboard: the clipboard itself where the page may use it,
 * else the older copy command. False when neither works (an embedded page
 * that is not allowed to, say).
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not allowed here: try the older way.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove();
    return !!done;
  } catch {
    return false;
  }
};

/** A text file's contents. */
export const readText = (file: Blob): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((done, fail) => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result));
        reader.onerror = () => fail(reader.error);
        reader.readAsText(file);
      });

/** The name for a project's exported codex notes. */
export const notesFileNameFor = (project: Project): string => fileNameFor(project).replace(/\.[^.]+$/, '') + ' codex notes.txt';

/** The printable notes page's file name, beside the notes' own. */
export const notesPageNameFor = (project: Project): string => notesFileNameFor(project).replace(/\.txt$/, '.html');

/**
 * Print a page: it loads in a hidden frame, which then asks for the print
 * dialog. False when the page may not print (an embedded page, say).
 */
export const printHtml = (html: string): Promise<boolean> =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      try {
        if (!win) throw new Error('no frame');
        win.focus();
        win.print();
        resolve(true);
      } catch {
        resolve(false);
      }
      setTimeout(() => frame.remove(), 60_000);
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });

/** Can this file be written back to without asking (so autosave can use it)? */
export const canWriteBack = (file: ProjectFile | null): boolean => !!file && (!!file.path || !!file.handle);

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

// ---------------------------------------------------------------- recent files (desktop)

const RECENT = 'vcgs.recent.v1';
const MAX_RECENT = 8;

export interface Recent {
  name: string;
  path: string;
}

export const recentFiles = (): Recent[] => {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENT) ?? '[]');
    return Array.isArray(list) ? list.filter((r): r is Recent => typeof r?.path === 'string' && typeof r?.name === 'string') : [];
  } catch {
    return [];
  }
};

export const rememberRecent = (file: ProjectFile): Recent[] => {
  if (!file.path) return recentFiles();
  const list = [{ name: file.name, path: file.path }, ...recentFiles().filter((r) => r.path !== file.path)].slice(0, MAX_RECENT);
  try {
    globalThis.localStorage?.setItem(RECENT, JSON.stringify(list));
  } catch {
    // Not remembered; nothing else depends on it.
  }
  return list;
};

export const clearRecent = (): void => {
  try {
    globalThis.localStorage?.removeItem(RECENT);
  } catch {
    // Nothing to clear.
  }
};
