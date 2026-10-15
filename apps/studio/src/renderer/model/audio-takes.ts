import { newId } from './project';
import { lineKey } from './script-export';
import type { AudioTake, DialogueLine, Project } from './types';

/**
 * Recorded takes: the audio for a line, uploaded once the voice actor has
 * recorded it. Giving a line its take marks it recorded.
 *
 * Audio is far too big for the project file (which also lives in the
 * browser's small local storage), so the sound itself is kept in this
 * computer's own database (IndexedDB), and the line keeps what it is: its
 * name, type, size and length. A project opened on another computer still
 * knows which lines are recorded, and says where the audio isn't there.
 */

// ---------------------------------------------------------------- the audio itself

const DB = 'vcgs-audio';
const STORE = 'takes';

/** Where indexedDB isn't (tests, a locked-down browser), takes are kept for the session only. */
const memory = new Map<string, Blob>();

let opening: Promise<IDBDatabase | null> | null = null;
const db = (): Promise<IDBDatabase | null> => {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
};

const run = async <T,>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve, reject) => {
    try {
      const req = act(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not keep the audio.'));
    } catch (e) {
      reject(e);
    }
  });
};

/** Keep a take's audio. Throws when the computer won't keep it (out of room). */
export const putAudio = async (id: string, blob: Blob): Promise<void> => {
  memory.set(id, blob);
  if (!(await db())) return;
  await run('readwrite', (s) => s.put(blob, id));
};

/** The sample's takes (sample-takes.ts) ship with the app rather than living in this computer's store. */
export const SAMPLE_TAKE_PREFIX = 'take_sample_';

const sampleUrl = async (id: string): Promise<string | undefined> => {
  if (!id.startsWith(SAMPLE_TAKE_PREFIX)) return undefined;
  try {
    const { SAMPLE_TAKE_URLS } = await import('./sample-take-urls');
    return SAMPLE_TAKE_URLS[id.slice(SAMPLE_TAKE_PREFIX.length)];
  } catch {
    return undefined;
  }
};

/** A file the app ships, as bytes: fetch, or the older request where fetch can't read it (the desktop app's own files). */
const fetchBlob = async (url: string): Promise<Blob | undefined> => {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.blob();
  } catch {
    // Try the older way.
  }
  return new Promise((resolve) => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', url);
      x.responseType = 'blob';
      x.onload = () => resolve(x.status === 0 || (x.status >= 200 && x.status < 300) ? (x.response as Blob) : undefined);
      x.onerror = () => resolve(undefined);
      x.send();
    } catch {
      resolve(undefined);
    }
  });
};

/** A take's audio kept on this computer, or undefined when it isn't here. */
const storedAudio = async (id: string): Promise<Blob | undefined> => {
  if (memory.has(id)) return memory.get(id);
  try {
    const found = await run<unknown>('readonly', (s) => s.get(id));
    return found instanceof Blob ? found : undefined;
  } catch {
    return undefined;
  }
};

/** A take's audio, or undefined when it isn't on this computer (nor one the app ships). */
export const getAudio = async (id: string): Promise<Blob | undefined> => {
  const stored = await storedAudio(id);
  if (stored) return stored;
  const url = await sampleUrl(id);
  // Tests have no server to fetch the app's files from: the sample's takes read as not here.
  const blob = url && import.meta.env?.MODE !== 'test' ? await fetchBlob(url) : undefined;
  if (blob) memory.set(id, blob);
  return blob;
};

/** Whether a take can be heard here. */
export const hasAudio = async (id: string): Promise<boolean> => !!(await storedAudio(id)) || !!(await sampleUrl(id));

/** Where to play a take from, and what to let go of once it has played. */
export const takeSource = async (id: string): Promise<{ url: string; release: () => void } | undefined> => {
  const stored = await storedAudio(id);
  if (stored && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(stored);
    return { url, release: () => URL.revokeObjectURL(url) };
  }
  const url = await sampleUrl(id);
  return url ? { url, release: () => {} } : undefined;
};

/** Which of these takes have their audio here. */
export const audioHere = async (ids: readonly string[]): Promise<Set<string>> => {
  const out = new Set<string>();
  for (const id of ids) if (await hasAudio(id)) out.add(id);
  return out;
};

// ---------------------------------------------------------------- files

const AUDIO_EXT = ['wav', 'mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'webm'] as const;

/** What the take upload accepts. */
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXT.map((e) => `.${e}`)].join(',');

const extOf = (name: string): string => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** Whether a file is audio we take: by its type, or its name where the type is missing. */
export const isAudioFile = (file: { name: string; type: string }): boolean => file.type.startsWith('audio/') || (AUDIO_EXT as readonly string[]).includes(extOf(file.name));

/** The extension a take is saved with: its own, else one for its type. */
export const takeExt = (take: Pick<AudioTake, 'name' | 'type'>): string =>
  extOf(take.name) || { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/webm': 'webm' }[take.type] || 'audio';

/** How long a piece of audio plays, where the browser can tell (undefined otherwise). */
export const audioSeconds = (blob: Blob): Promise<number | undefined> =>
  new Promise((resolve) => {
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve(undefined);
    let url = '';
    try {
      url = URL.createObjectURL(blob);
    } catch {
      return resolve(undefined);
    }
    const a = new Audio();
    const done = (s?: number) => {
      URL.revokeObjectURL(url);
      resolve(s !== undefined && Number.isFinite(s) && s > 0 ? Math.round(s * 10) / 10 : undefined);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done();
    setTimeout(() => done(), 4000);
    a.src = url;
  });

// ---------------------------------------------------------------- the lines

/** A line's take recorded: it is marked recorded. */
export const attachTake = (project: Project, lineId: string, take: AudioTake): Project => ({
  ...project,
  lines: project.lines.map((l) => (l.id === lineId && l.kind === 'dialogue' ? { ...l, take, vo: 'recorded' } : l)),
});

/** A line's take taken off: it goes back to be recorded. (The audio stays, so undo brings it back.) */
export const detachTake = (project: Project, lineId: string): Project => ({
  ...project,
  lines: project.lines.map((l) => {
    if (l.id !== lineId || !l.take) return l;
    const { take: _gone, ...rest } = l;
    return { ...rest, vo: 'todo' };
  }),
});

/** Keep a file's audio as a take, and say what it is (to attach to a line). */
export const storeTake = async (file: File): Promise<AudioTake> => {
  const id = newId('take');
  await putAudio(id, file);
  const seconds = await audioSeconds(file);
  return { id, name: file.name, type: file.type || `audio/${takeExt({ name: file.name, type: '' })}`, bytes: file.size, ...(seconds ? { seconds } : {}), at: new Date().toISOString() };
};

/** Dialogue that can be recorded: every spoken line with something to say. */
const recordable = (project: Project): DialogueLine[] => project.lines.filter((l) => l.kind === 'dialogue' && l.text.trim() && project.objects[l.sceneId]);

/**
 * Which line each file is for, by its name: the recording script's file name
 * for the line (sc_03_line_02.wav), with anything after it ignored
 * (sc_03_line_02_take3.wav, SC_03_LINE_02 Mara.wav). The longest name wins,
 * so sc_03_line_1 never takes sc_03_line_12's file.
 */
export const matchTakes = <F extends { name: string }>(project: Project, files: readonly F[], among?: readonly string[]): { matched: { file: F; lineId: string; key: string }[]; unmatched: F[] } => {
  const pool = recordable(project).filter((l) => !among || among.includes(l.id));
  const keys = pool.map((l) => ({ key: lineKey(project, l), lineId: l.id })).sort((a, b) => b.key.length - a.key.length);
  const matched: { file: F; lineId: string; key: string }[] = [];
  const unmatched: F[] = [];
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[\s-]+/g, '_');
    const hit = keys.find((k) => base === k.key || (base.startsWith(k.key) && !/[a-z0-9]/.test(base[k.key.length]!)));
    if (hit) matched.push({ file, ...hit });
    else unmatched.push(file);
  }
  return { matched, unmatched };
};

/** The takes as files, each named for its line as the engines play it: audio/vo/sc_03_line_02.wav. */
export const takeFiles = async (project: Project, lineIds?: readonly string[]): Promise<{ files: { path: string; content: Uint8Array }[]; missing: DialogueLine[] }> => {
  const files: { path: string; content: Uint8Array }[] = [];
  const missing: DialogueLine[] = [];
  for (const line of recordable(project)) {
    if (!line.take || (lineIds && !lineIds.includes(line.id))) continue;
    const blob = await getAudio(line.take.id);
    if (!blob) {
      missing.push(line);
      continue;
    }
    files.push({ path: `audio/vo/${lineKey(project, line)}.${takeExt(line.take)}`, content: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { files, missing };
};

/** Where a line's take goes in an engine project, under the takes folder: vo/sc_03_line_02.mp3. */
export const takeFileOf = (project: Project, line: DialogueLine): string | undefined =>
  line.kind === 'dialogue' && line.take && line.text.trim() ? `vo/${lineKey(project, line)}.${takeExt(line.take)}` : undefined;

/** A take's size and length, short: 1.2 MB · 3.4 s. */
export const takeSummary = (take: AudioTake): string => {
  const size = take.bytes >= 1_000_000 ? `${(take.bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(take.bytes / 1000))} KB`;
  return take.seconds ? `${size} · ${take.seconds} s` : size;
};
