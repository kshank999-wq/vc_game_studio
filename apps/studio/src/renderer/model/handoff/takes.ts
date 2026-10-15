import { getAudio, takeFileOf } from '../audio-takes';
import type { DialogueLine, Project } from '../types';
import { fingerprint, type EngineAdapter } from './engines';

/**
 * The recorded takes, handed off with the code: each line's audio in the
 * engine project where its runtime looks for it (Godot: beside the generated
 * folder, res://…/vo; Unity: Resources/VCGS/vo; Unreal: VCGS/SourceAudio/vo,
 * as WAV, for import_vo.py; JSON: beside story.json). The generated files
 * already name each take's path; these are the files themselves.
 */

export interface TakeFile {
  path: string;
  line: DialogueLine;
}

const withExt = (path: string, ext: string) => path.replace(/\.[^./]+$/, `.${ext}`);

/** Where each recorded line's take goes for this engine, project-relative. */
export const takePlan = (project: Project, adapter: EngineAdapter, outputPath: string): TakeFile[] => {
  if (!adapter.takesDir) return [];
  const dir = adapter.takesDir(outputPath).replace(/\/+$/, '');
  return project.lines.flatMap((line) => {
    const file = takeFileOf(project, line);
    if (!file || !project.objects[line.sceneId]) return [];
    const path = `${dir ? `${dir}/` : ''}${adapter.takesAsWav ? withExt(file, 'wav') : file}`;
    return [{ path, line }];
  });
};

/** The handoff screen's row for the takes: what goes where, and a fingerprint that changes when a take does. */
export const takesRow = (plan: TakeFile[]) =>
  plan.length
    ? {
        id: 'takes',
        label: `Recorded takes (${plan.length})`,
        symbol: 'dialogue' as const,
        group: 'People + words' as const,
        generates: `${plan.length} audio file${plan.length === 1 ? '' : 's'} → ${plan[0]!.path.replace(/\/[^/]+$/, '/')}`,
        files: plan.map((t) => t.path),
        fingerprint: fingerprint(plan.map((t) => `${t.path}:${t.line.take!.id}:${t.line.take!.bytes}`).join('|')),
      }
    : null;

// ---------------------------------------------------------------- WAV, for engines that import only that

const isWav = (bytes: Uint8Array) => bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';

/** Decoded audio as a 16-bit PCM WAV file. */
export const encodeWav = (channels: Float32Array[], sampleRate: number): Uint8Array => {
  const frames = channels[0]?.length ?? 0;
  const n = Math.max(1, channels.length);
  const data = frames * n * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, n, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * n * 2, true);
  v.setUint16(32, n * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, data, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(at, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      at += 2;
    }
  return out;
};

/** Audio as WAV: as it is if it already is, else decoded by the browser (null where it can't). */
const toWav = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (isWav(bytes)) return bytes;
  const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx(1, 1, 44100);
    const decoded = await ctx.decodeAudioData(bytes.slice().buffer);
    return encodeWav(Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)), decoded.sampleRate);
  } catch {
    return null;
  }
};

/**
 * The take files to write: their audio from this computer (or the app, for
 * the sample's). Takes whose audio isn't here are left out and listed; for an
 * engine that wants WAV, a take the browser can't convert goes as it is.
 */
export const gatherTakes = async (plan: readonly TakeFile[], asWav = false): Promise<{ files: { path: string; content: Uint8Array }[]; missing: TakeFile[]; unconverted: TakeFile[] }> => {
  const files: { path: string; content: Uint8Array }[] = [];
  const missing: TakeFile[] = [];
  const unconverted: TakeFile[] = [];
  for (const t of plan) {
    const blob = await getAudio(t.line.take!.id);
    if (!blob) {
      missing.push(t);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!asWav) {
      files.push({ path: t.path, content: bytes });
      continue;
    }
    const wav = await toWav(bytes);
    if (wav) files.push({ path: t.path, content: wav });
    else {
      unconverted.push(t);
      const ext = /\.([^./]+)$/.exec(t.line.take!.name)?.[1] ?? 'audio';
      files.push({ path: withExt(t.path, ext), content: bytes });
    }
  }
  return { files, missing, unconverted };
};

/** What the takes part of a send says: how many went, and any left out. */
export const takesNote = (r: { files: unknown[]; missing: TakeFile[]; unconverted: TakeFile[] }): string => {
  const parts: string[] = [];
  if (r.files.length) parts.push(`${r.files.length} take${r.files.length === 1 ? '' : 's'}`);
  if (r.missing.length) parts.push(`${r.missing.length} take${r.missing.length === 1 ? '’s audio isn’t' : 's’ audio isn’t'} on this computer (left out: upload ${r.missing.length === 1 ? 'it' : 'them'} again)`);
  if (r.unconverted.length) parts.push(`${r.unconverted.length} couldn’t be made WAV (sent as ${r.unconverted.length === 1 ? 'it is' : 'they are'}: convert before importing)`);
  return parts.join('; ');
};
