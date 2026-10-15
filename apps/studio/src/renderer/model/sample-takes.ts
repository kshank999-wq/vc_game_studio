import { attachTake, SAMPLE_TAKE_PREFIX } from './audio-takes';
import { lineKey } from './script-export';
import type { Project } from './types';

/**
 * The sample's recorded takes: a voice for each of its lines, so the
 * play-through and Play Mode can be heard from the first run. They are
 * placeholder performances, synthesized with Piper (LibriTTS voices, CC BY
 * 4.0): replace them with real takes the same way as any other.
 *
 * The audio ships with the app (sample-take-urls.ts, loaded only when a take
 * is played); the lines keep what each take is.
 */

/** Each take's size (bytes) and length (seconds), by the line's file name. */
export const SAMPLE_TAKES: Record<string, { bytes: number; seconds: number }> = {
  sc_01_line_02: { bytes: 9474, seconds: 1.5 },
  sc_01_line_03: { bytes: 8690, seconds: 1.4 },
  sc_01_line_04: { bytes: 8220, seconds: 1.3 },
  sc_03_line_02: { bytes: 14960, seconds: 2.5 },
  sc_03_line_03: { bytes: 11982, seconds: 2 },
  sc_03_line_04: { bytes: 5712, seconds: 0.9 },
};

const PREFIX = SAMPLE_TAKE_PREFIX;

/** The take id a sample line's audio goes by. */
export const sampleTakeId = (key: string): string => `${PREFIX}${key}`;

/** The file name a sample take's audio comes from, or undefined if the id isn't one of them. */
export const sampleTakeKey = (takeId: string): string | undefined => {
  const key = takeId.startsWith(PREFIX) ? takeId.slice(PREFIX.length) : '';
  return SAMPLE_TAKES[key] ? key : undefined;
};

/** The sample with its takes: each line that has one is marked recorded. */
export const withSampleTakes = (project: Project): Project => {
  let p = project;
  for (const line of project.lines) {
    if (line.kind !== 'dialogue') continue;
    const key = lineKey(project, line);
    const t = SAMPLE_TAKES[key];
    if (t) p = attachTake(p, line.id, { id: sampleTakeId(key), name: `${key}.mp3`, type: 'audio/mpeg', bytes: t.bytes, seconds: t.seconds, at: '2026-10-15T00:00:00.000Z' });
  }
  return p;
};
