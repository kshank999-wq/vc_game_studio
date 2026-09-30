import type { ExportRecord } from '../types';
import { keepCustom, withoutCustom } from './custom';
import { fingerprint, type GeneratedFile } from './engines';

/**
 * The review before sending to a folder that already has an export in it
 * (spec §13): what each file becomes, as a line diff against what is there,
 * with the custom code carried over from it, and the files changed in the
 * engine outside their custom regions (which are the person's to keep or
 * overwrite, never silently).
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/** Past this many cells the middle of a diff is shown as all removed, then all added. */
const MAX_CELLS = 4_000_000;

/** The lines of b against a: kept, removed and added, in order (a longest common subsequence). */
export const lineDiff = (a: string, b: string): DiffLine[] => {
  const x = splitLines(a);
  const y = splitLines(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const out: DiffLine[] = x.slice(0, start).map((text) => ({ kind: 'same', text }));
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  if (mx.length * my.length > MAX_CELLS) {
    out.push(...mx.map((text): DiffLine => ({ kind: 'del', text })), ...my.map((text): DiffLine => ({ kind: 'add', text })));
  } else {
    // lcs[i][j]: the longest common run of mx[i..] and my[j..].
    const w = my.length + 1;
    const lcs = new Uint32Array((mx.length + 1) * w);
    for (let i = mx.length - 1; i >= 0; i--)
      for (let j = my.length - 1; j >= 0; j--) lcs[i * w + j] = mx[i] === my[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < mx.length || j < my.length) {
      if (i < mx.length && j < my.length && mx[i] === my[j]) {
        out.push({ kind: 'same', text: mx[i]! });
        i++;
        j++;
      } else if (i < mx.length && (j >= my.length || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) out.push({ kind: 'del', text: mx[i++]! });
      else out.push({ kind: 'add', text: my[j++]! });
    }
  }
  out.push(...x.slice(endX).map((text): DiffLine => ({ kind: 'same', text })));
  return out;
};

/** The changed parts of a diff with a few lines around each, as runs; `skipped` lines between them are left out. */
export const hunksOf = (diff: readonly DiffLine[], context = 3): { at: number; lines: DiffLine[] }[] => {
  const near = new Set<number>();
  diff.forEach((d, i) => {
    if (d.kind !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) near.add(k);
  });
  const out: { at: number; lines: DiffLine[] }[] = [];
  let line = 0;
  diff.forEach((d, i) => {
    if (d.kind !== 'add') line++;
    if (!near.has(i)) return;
    const last = out[out.length - 1];
    if (last && near.has(i - 1)) last.lines.push(d);
    else out.push({ at: d.kind === 'add' ? line + 1 : line, lines: [d] });
  });
  return out;
};

export interface SendFile {
  path: string;
  kind: GeneratedFile['kind'];
  /** What would be written: the new file, with the custom code from the one there. */
  content: string;
  /** What is there now (null for nothing). */
  before: string | null;
  status: 'new' | 'changed' | 'same';
  /** Changed in the engine outside its custom regions since the last export. */
  edited: boolean;
  added: number;
  removed: number;
  kept: string[];
  moved: string[];
  lost: string[];
}

export interface SendReview {
  files: SendFile[];
  /** Files that would change, or be new. */
  changes: number;
  /** Custom regions whose code is carried over. */
  kept: number;
  /** Files changed in the engine outside their regions: keep them or overwrite them. */
  edited: string[];
  /** Files whose custom code would have nowhere to go. */
  lost: string[];
}

/** What a hash of a written file records: the file without its custom code, so edits inside the regions are the person's own. */
export const fileHash = (content: string): string => fingerprint(withoutCustom(content));

/** Review sending these files over what is on disk (null for missing), against the last export's record. */
export const reviewSend = (files: readonly GeneratedFile[], onDisk: Record<string, string | null>, last?: ExportRecord): SendReview => {
  const out = files.map((f): SendFile => {
    const before = onDisk[f.path] ?? null;
    const merged = f.kind === 'generated' ? keepCustom(f.content, before) : { content: f.content, kept: [], moved: [], lost: [] };
    const diff = before === null ? [] : lineDiff(before, merged.content);
    const was = last?.fileHashes?.[f.path];
    const edited = f.kind === 'generated' && before !== null && was !== undefined && fileHash(before) !== was && fileHash(before) !== fileHash(merged.content) && fingerprint(before) !== was;
    return {
      path: f.path,
      kind: f.kind,
      content: merged.content,
      before,
      status: before === null ? 'new' : before === merged.content ? 'same' : 'changed',
      edited,
      added: before === null ? splitLines(merged.content).length : diff.filter((d) => d.kind === 'add').length,
      removed: diff.filter((d) => d.kind === 'del').length,
      kept: merged.kept,
      moved: merged.moved,
      lost: merged.lost,
    };
  });
  return {
    files: out,
    changes: out.filter((f) => f.status !== 'same').length,
    kept: out.reduce((n, f) => n + f.kept.length, 0),
    edited: out.filter((f) => f.edited).map((f) => f.path),
    lost: out.filter((f) => f.lost.length).map((f) => f.path),
  };
};
