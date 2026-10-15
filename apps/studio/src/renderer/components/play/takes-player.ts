import { useEffect, useRef, useState } from 'react';
import { takeSource } from '../../model/audio-takes';
import type { Entry, Voice } from '../../model/play';
import type { Project } from '../../model/types';

/**
 * The play-through's voices: as lines come up, their recorded takes play —
 * one after another when a step brings several, both at once for dual
 * dialogue. A new step cuts off what was still playing, as a game does when
 * the player skips on. Lines without a take (or whose audio isn't on this
 * computer) are read, not heard.
 */

/** The lines an entry speaks: one, or two at once. */
export const voicesOf = (entry: Entry): Voice[] => (entry.kind === 'line' ? [entry, ...(entry.with ? [entry.with] : [])] : []);

/** The groups to play for these entries, in order, keeping only lines with a take. */
export const takeGroups = (project: Project, entries: readonly Entry[]): string[][] =>
  entries
    .map((e) => voicesOf(e).map((v) => v.lineId).filter((id) => project.lines.some((l) => l.id === id && l.take)))
    .filter((g) => g.length > 0);

const VOICES_KEY = 'vcgs.play.voices';

const readOn = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(VOICES_KEY) !== 'off';
  } catch {
    return true;
  }
};

interface Playing {
  audios: HTMLAudioElement[];
  release: () => void;
}

/**
 * Takes played aloud: groups of lines one after another, each group's lines
 * at once; a new start cuts off what was playing. On or off is the
 * player's choice, remembered, and the same in every play mode.
 */
export const useVoicePlayer = (project: Project) => {
  const [on, setOnState] = useState(readOn);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef(project);
  latest.current = project;
  const queue = useRef<string[][]>([]);
  const current = useRef<Playing | null>(null);
  // Each start bumps this, so a take still loading from an earlier step doesn't start late.
  const run = useRef(0);

  const stop = () => {
    run.current++;
    queue.current = [];
    const c = current.current;
    current.current = null;
    if (c) {
      for (const a of c.audios) a.pause();
      c.release();
    }
    setSpeaking(new Set());
  };

  const next = async (ticket: number): Promise<void> => {
    const group = queue.current.shift();
    if (!group) {
      setSpeaking(new Set());
      return;
    }
    const lines = group.map((id) => latest.current.lines.find((l) => l.id === id)).filter((l) => l?.take);
    const sources = (await Promise.all(lines.map((l) => takeSource(l!.take!.id)))).map((src, i) => ({ src, id: lines[i]!.id }));
    const here = sources.filter((x): x is { src: NonNullable<typeof x.src>; id: string } => !!x.src);
    const release = () => here.forEach((x) => x.src.release());
    if (ticket !== run.current) return release();
    if (!here.length) return next(ticket);
    const audios = here.map((x) => new Audio(x.src.url));
    current.current = { audios, release };
    setSpeaking(new Set(here.map((x) => x.id)));
    let left = audios.length;
    const ended = () => {
      if (--left > 0 || ticket !== run.current) return;
      release();
      current.current = null;
      void next(ticket);
    };
    for (const a of audios) {
      a.onended = ended;
      a.onerror = ended;
      try {
        // Some browsers give no promise back; one that refuses (no sound allowed yet) ends it.
        void a.play()?.catch(ended);
      } catch {
        ended();
      }
    }
  };

  /** Play these groups now, cutting off anything playing. */
  const playGroups = (groups: string[][]) => {
    stop();
    if (!groups.length) return;
    queue.current = groups;
    void next(run.current);
  };

  useEffect(() => stop, []);

  const setOn = (value: boolean) => {
    setOnState(value);
    if (!value) stop();
    try {
      globalThis.localStorage?.setItem(VOICES_KEY, value ? 'on' : 'off');
    } catch {
      // Remembered for this window only.
    }
  };

  /** Lines with a take, of these: the ones that can be heard. */
  const heard = (lineIds: readonly string[]) => lineIds.filter((id) => latest.current.lines.some((l) => l.id === id && l.take));

  return { on, setOn, speaking, playGroups, stop, heard };
};

/** The play-through's voices: the lines that come up in its log. */
export const useTakesPlayer = (project: Project, log: readonly Entry[]) => {
  const voices = useVoicePlayer(project);
  const latest = useRef(project);
  latest.current = project;
  // Nothing heard yet: the opening lines play too.
  const seen = useRef<readonly Entry[]>([]);

  // New lines in the log: theirs play. A step back, a fresh start or a loaded save only stops the voices.
  useEffect(() => {
    const before = seen.current;
    seen.current = log;
    if (log === before) return;
    const carriedOn = log.length > before.length && (before.length === 0 || log[before.length - 1] === before[before.length - 1]);
    if (!carriedOn) return voices.stop();
    if (!voices.on) return;
    const groups = takeGroups(latest.current, log.slice(before.length));
    if (groups.length) voices.playGroups(groups);
    else voices.stop();
  }, [log]);

  /** Hear one entry again (its line, or both voices of a dual line). */
  const replay = (entry: Entry) => voices.playGroups(takeGroups(latest.current, [entry]));

  return { on: voices.on, setOn: voices.setOn, speaking: voices.speaking, replay, stop: voices.stop };
};
