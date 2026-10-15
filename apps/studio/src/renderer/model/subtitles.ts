import { plainInline } from './inline';
import type { DialogueLine, Project } from './types';

/**
 * Subtitles for spoken lines: who says it (and from where, for a voiceover),
 * then what they say, and how long to show it. The play-through and Play Mode
 * show them, the engine handoff gives them to every engine, and the engines'
 * debug players show them the same way.
 */

/** Who a line is, as a subtitle names them: "Mara", "Radio (V.O.)", "Mara (V.O., Radio)"; "" for nobody. */
export const subtitleWho = (speaker: string | null | undefined, from?: string): string => {
  if (!from) return speaker ?? '';
  if (!speaker || from === speaker) return `${from} (V.O.)`;
  return `${speaker} (V.O., ${from})`;
};

/** A line as a subtitle: "Mara: Lit. You go first.", or just the words when nobody says it. */
export const subtitleText = (who: string, text: string): string => (who ? `${who}: ${text}` : text);

/** Time enough to read a subtitle: a second, and a twentieth of one a letter; two at the least. */
export const readingSeconds = (subtitle: string): number => Math.max(2, 1 + 0.05 * [...subtitle].length);

/** How long a line's subtitle shows: its take's length when known, else the time to read it (to the hundredth). */
export const subtitleSeconds = (subtitle: string, takeSeconds?: number): number => Math.round((takeSeconds && takeSeconds > 0 ? takeSeconds : readingSeconds(subtitle)) * 100) / 100;

const srtTime = (seconds: number): string => {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** A take's subtitle as an .srt file: one cue, from the start for as long as it shows. */
export const srtFile = (subtitle: string, seconds: number): string => `1\n${srtTime(0)} --> ${srtTime(seconds)}\n${subtitle}\n`;

/** A line's subtitle and how long it shows, as the handoff, the recording script and the players give it. */
export const lineSubtitle = (project: Project, line: DialogueLine): { subtitle: string; seconds: number } => {
  const subtitle = subtitleText(subtitleWho(project.objects[line.speakerId ?? '']?.name ?? null, line.voiceFrom ? project.objects[line.voiceFrom]?.name : undefined), plainInline(line.text));
  return { subtitle, seconds: subtitleSeconds(subtitle, line.take?.seconds) };
};

/** Seconds as the scripts show them: "2.5s". */
export const secondsLabel = (seconds: number): string => `${Math.round(seconds * 100) / 100}s`;
