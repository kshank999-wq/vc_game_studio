import { zip } from './zip';
import type { EngineId } from '../types';

/**
 * One file to bring into an engine through its own import (the handoff's
 * "save as a file"): Godot installs a .zip from its AssetLib tab (Import…),
 * Unity imports a .unitypackage (Assets › Import Package › Custom Package…),
 * and Unreal, which has no package import for code, takes a .zip unzipped
 * into the project folder. The JSON export is a .zip too.
 */
export interface EnginePackage {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** What to do with it, in the engine's words. */
  steps: string[];
}

type File = { path: string; content: string };

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';

// ---------------------------------------------------------------- tar + gzip, for the .unitypackage

const encoder = new TextEncoder();

/** One ustar entry: a 512-byte header, then the content padded to 512. */
const tarEntry = (name: string, data: Uint8Array, mtime: number): Uint8Array[] => {
  const header = new Uint8Array(512);
  const put = (text: string, at: number, length: number) => header.set(encoder.encode(text).slice(0, length), at);
  const octal = (n: number, length: number) => n.toString(8).padStart(length - 1, '0') + '\0';
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(data.length, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  put('        ', 148, 8); // the checksum is summed with spaces here
  put('0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  const padding = new Uint8Array((512 - (data.length % 512)) % 512);
  return [header, data, padding];
};

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};

export const tar = (entries: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array<ArrayBuffer> => {
  const mtime = Math.floor(date.getTime() / 1000);
  return concat([...entries.flatMap((e) => tarEntry(e.name, e.data, mtime)), new Uint8Array(1024)]);
};

export const gzip = async (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** A GUID for a file that came without a .meta: the same path always gets the same one. */
const guidFor = (path: string): string => {
  // FNV-1a, four ways, to 32 hex digits.
  let out = '';
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

const guidIn = (meta: string): string | null => /^guid:\s*([0-9a-f]{32})\s*$/m.exec(meta)?.[1] ?? null;

/**
 * A .unitypackage: a gzipped tar with a folder per asset, named by its GUID,
 * holding the asset, its .meta and its path. Folders come from their .meta
 * files; a file without one gets a GUID of its own.
 */
export const unityPackage = async (files: readonly File[], date = new Date()): Promise<Uint8Array<ArrayBuffer>> => {
  const metas = new Map(files.filter((f) => f.path.endsWith('.meta')).map((f) => [f.path.slice(0, -5), f.content]));
  const assets = new Map(files.filter((f) => !f.path.endsWith('.meta')).map((f) => [f.path, f.content]));
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const path of [...new Set([...metas.keys(), ...assets.keys()])].sort()) {
    const meta = metas.get(path) ?? `fileFormatVersion: 2\nguid: ${guidFor(path)}\n`;
    const guid = guidIn(meta) ?? guidFor(path);
    if (assets.has(path)) entries.push({ name: `${guid}/asset`, data: encoder.encode(assets.get(path)!) });
    entries.push({ name: `${guid}/asset.meta`, data: encoder.encode(meta) });
    entries.push({ name: `${guid}/pathname`, data: encoder.encode(path) });
  }
  return gzip(tar(entries, date));
};

/** The file to import for each engine, and what to do with it there. */
export const packageFor = async (engine: EngineId, projectName: string, files: readonly File[]): Promise<EnginePackage> => {
  const name = slug(projectName);
  if (engine === 'unity') {
    return {
      fileName: `${name}-unity.unitypackage`,
      bytes: await unityPackage(files),
      steps: ['In Unity, open your project.', 'Assets › Import Package › Custom Package…, and choose this file.', 'Import everything it lists.'],
    };
  }
  if (engine === 'godot') {
    // One root folder: Godot's installer leaves it out and puts the rest in res://.
    return {
      fileName: `${name}-godot.zip`,
      bytes: zip(files.map((f) => ({ path: `${name}/${f.path}`, content: f.content }))),
      steps: [
        'In Godot 4, open your project.',
        'Open the AssetLib tab at the top, choose Import…, and pick this file.',
        'Leave "Ignore asset root" ticked and choose Install.',
        'Project › Project Settings › Plugins: turn on VCGS Runtime (it adds the GameState autoload).',
        'Open vcgs/generated/play_story.tscn and press F6 to play the story.',
      ],
    };
  }
  if (engine === 'unreal') {
    return {
      fileName: `${name}-unreal.zip`,
      bytes: zip([...files]),
      steps: ['Close the Unreal editor.', 'Unzip this file into your project folder (beside its .uproject), so Plugins and Content go where they are.', 'Open the project and let it build the VCGS plugin when it asks.'],
    };
  }
  return { fileName: `${name}-json.zip`, bytes: zip([...files]), steps: ['Unzip it where your engine reads its data; vcgs/README.md says what is in it.'] };
};
