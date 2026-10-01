import type { Condition } from '../rules';
import type { Project, StoryObject } from '../types';

/**
 * A puzzle's staged hints (puzzle spec §10) and what solving it plays (§11),
 * read for the play-through and Play Mode. Light: no editing here.
 */

export interface HintStage {
  id: string;
  text: string;
  /** Given after this many wrong moves. */
  afterFails?: number;
  /** Given once this holds (a clue still unknown with the door reached, say). */
  when?: Condition;
}

export const hintsOf = (puzzle: StoryObject | undefined): HintStage[] => (Array.isArray(puzzle?.data.hints) ? (puzzle!.data.hints as HintStage[]) : []);

/** Hints due now that haven't been given: each needs its wrong moves made and its condition holding (and at least one of them). */
export const dueHints = (puzzle: StoryObject, fails: number, given: Record<string, boolean>, holds: (c: Condition) => boolean): HintStage[] =>
  hintsOf(puzzle).filter((h) => !given[h.id] && (h.afterFails || h.when) && (!h.afterFails || fails >= h.afterFails) && (!h.when || holds(h.when)));

export type CueKind = 'animation' | 'audio' | 'vfx' | 'dialogue' | 'cinematic' | 'message';

export const CUE_KINDS: readonly { id: CueKind; label: string; ref?: 'cinematic' | 'dialogue' }[] = [
  { id: 'animation', label: 'Animation' },
  { id: 'audio', label: 'Audio' },
  { id: 'vfx', label: 'VFX' },
  { id: 'message', label: 'A message on screen' },
  { id: 'dialogue', label: 'Dialogue', ref: 'dialogue' },
  { id: 'cinematic', label: 'Cinematic', ref: 'cinematic' },
];

/** Something solving the puzzle plays (§11): an animation, a sound, an effect, a line, a cinematic. */
export interface SolveCue {
  id: string;
  kind: CueKind;
  /** What it is: the asset or what happens ("the vault door grinds open"). */
  text: string;
  /** The cinematic or dialogue it plays. */
  ref?: string;
}

export const cuesOf = (puzzle: StoryObject | undefined): SolveCue[] => (Array.isArray(puzzle?.data.cues) ? (puzzle!.data.cues as SolveCue[]) : []);

export const describeCue = (project: Project, c: SolveCue): string => {
  const kind = CUE_KINDS.find((k) => k.id === c.kind)?.label ?? c.kind;
  const ref = c.ref ? project.objects[c.ref]?.name : undefined;
  return [kind, ref, c.text].filter(Boolean).join(': ');
};
