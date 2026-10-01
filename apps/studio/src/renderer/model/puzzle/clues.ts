import { interactionsOf, setData } from '../details';
import { newId } from '../project';
import type { Project, StoryObject } from '../types';
import type { PuzzleIssue } from './design';
import { elementKindOf, elementsOf, revealedBy, stepsUsing } from './elements';
import { screenIssues, screenOf } from './screens';
import { nodesOf } from './tree';
import { cuesOf, CUE_KINDS, hintsOf, type CueKind, type HintStage, type SolveCue } from './staged';

export { cuesOf, CUE_KINDS, describeCue, dueHints, hintsOf, type CueKind, type HintStage, type SolveCue } from './staged';

/**
 * The clue system (puzzle spec §10). A clue is a lore entry (known once
 * something reveals it) with what it is, where and how it is found, what it
 * tells the player, which steps it helps with, whether it is needed, and how
 * plainly it says it. Every clue can be traced to a purpose: one that helps
 * no step is flagged. Staged hints (§10) give more help as the player
 * struggles; they and the cues a puzzle plays when solved (§11) are kept on
 * the puzzle.
 */

export const CLUE_FORMS = ['Text', 'Visual', 'Audio', 'Environmental'] as const;
export const DISCOVERY = ['Inspect', 'Read', 'Hear', 'Find', 'Overhear', 'Combine', 'Be told'] as const;
export const HINT_STRENGTHS = ['Subtle', 'Moderate', 'Explicit'] as const;

export interface ClueInfo {
  form: string;
  /** What it is: the words, the picture, the sound. */
  content: string;
  location: string;
  discovery: string;
  /** What it tells the player. */
  knowledge: string;
  strength: string;
  mandatory: boolean;
  /** The steps it helps with. */
  supports: string[];
}

/** Clue fields are plain strings, so the engines get them as the lore's fields. */
export const clueOf = (o: StoryObject | undefined): ClueInfo => {
  const d = o?.data ?? {};
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  return {
    form: s('clueForm') || 'Text',
    content: s('clueContent'),
    location: s('clueLocation'),
    discovery: s('clueDiscovery') || 'Inspect',
    knowledge: s('clueKnowledge'),
    strength: s('clueStrength') || 'Moderate',
    mandatory: s('clueMandatory') !== 'no',
    supports: Array.isArray(d.supports) ? (d.supports as string[]) : [],
  };
};

export const updateClue = (project: Project, id: string, patch: Partial<ClueInfo>): Project => {
  const out: Record<string, unknown> = {};
  const str = (k: string, v: string | undefined) => (out[k] = v?.trim() ? v.trim() : undefined);
  if ('form' in patch) str('clueForm', patch.form);
  if ('content' in patch) str('clueContent', patch.content);
  if ('location' in patch) str('clueLocation', patch.location);
  if ('discovery' in patch) str('clueDiscovery', patch.discovery);
  if ('knowledge' in patch) str('clueKnowledge', patch.knowledge);
  if ('strength' in patch) str('clueStrength', patch.strength);
  if ('mandatory' in patch) out.clueMandatory = patch.mandatory ? undefined : 'no';
  if ('supports' in patch) out.supports = patch.supports?.length ? [...new Set(patch.supports)] : undefined;
  return setData(project, id, out);
};

export const isClue = (o: StoryObject) => o.type === 'lore' && elementKindOf(o) === 'clue';

export const cluesOf = (project: Project, puzzleId: string): StoryObject[] => elementsOf(project, puzzleId).filter(isClue);

export interface ClueTrace {
  clue: StoryObject;
  info: ClueInfo;
  /** Steps that need it known, and steps it says it helps with. */
  usedBy: string[];
  used: boolean;
  reached: ReturnType<typeof revealedBy>;
}

/** Each clue and what it is for (§10): the steps it helps with, and whether anything reveals it. */
export const traceClues = (project: Project, puzzleId: string): ClueTrace[] => {
  const nodes = nodesOf(project.objects[puzzleId]);
  return cluesOf(project, puzzleId).map((clue) => {
    const info = clueOf(clue);
    const ids = [...new Set([...stepsUsing(project, puzzleId, clue.id).map((n) => n.id), ...info.supports.filter((s) => nodes.some((n) => n.id === s))])];
    return { clue, info, usedBy: ids, used: ids.length > 0, reached: revealedBy(project, clue.id) };
  });
};

// ---------------------------------------------------------------- staged hints

const setHints = (project: Project, id: string, hints: HintStage[]) => setData(project, id, { hints: hints.length ? hints : undefined });

export const addHint = (project: Project, id: string, text = 'A nudge in the right direction'): Project => {
  const hints = hintsOf(project.objects[id]);
  return setHints(project, id, [...hints, { id: newId('hint'), text, afterFails: hints.length + 1 }]);
};

export const updateHint = (project: Project, id: string, hintId: string, patch: Partial<Omit<HintStage, 'id'>>): Project =>
  setHints(
    project,
    id,
    hintsOf(project.objects[id]).map((h) => {
      if (h.id !== hintId) return h;
      const next = { ...h, ...patch };
      if (!next.afterFails) delete next.afterFails;
      if (!next.when) delete next.when;
      return next;
    }),
  );

export const removeHint = (project: Project, id: string, hintId: string): Project => setHints(project, id, hintsOf(project.objects[id]).filter((h) => h.id !== hintId));

// ---------------------------------------------------------------- what solving it plays

const setCues = (project: Project, id: string, cues: SolveCue[]) => setData(project, id, { cues: cues.length ? cues : undefined });

export const addCue = (project: Project, id: string, kind: CueKind = 'animation'): Project => setCues(project, id, [...cuesOf(project.objects[id]), { id: newId('cue'), kind, text: '' }]);

export const updateCue = (project: Project, id: string, cueId: string, patch: Partial<Omit<SolveCue, 'id'>>): Project =>
  setCues(
    project,
    id,
    cuesOf(project.objects[id]).map((c) => {
      if (c.id !== cueId) return c;
      const next = { ...c, ...patch };
      if (!CUE_KINDS.find((k) => k.id === next.kind)?.ref || !next.ref) delete next.ref;
      return next;
    }),
  );

export const removeCue = (project: Project, id: string, cueId: string): Project => setCues(project, id, cuesOf(project.objects[id]).filter((c) => c.id !== cueId));


/** What looks wrong with a puzzle's elements, clues, hints and cues. */
export const elementIssues = (project: Project, puzzleId: string): PuzzleIssue[] => {
  const puzzle = project.objects[puzzleId];
  if (!puzzle) return [];
  const out: PuzzleIssue[] = [];
  for (const t of traceClues(project, puzzleId)) {
    if (!t.used) out.push({ severity: 'warning', elementId: t.clue.id, message: `The clue “${t.clue.name}” helps no step: say which it helps, or have a step need it known.` });
    if (t.reached === 'nothing' && t.info.mandatory) out.push({ severity: 'warning', elementId: t.clue.id, message: `Nothing reveals the clue “${t.clue.name}”: bind it to a clue in a level, or reveal it from an interaction.` });
  }
  // Unconnected (§13): no step uses it, nothing in the puzzle names it, and what it does changes nothing else.
  const els = elementsOf(project, puzzleId);
  const named = new Set<string>();
  const collect = (x: unknown) => {
    if (typeof x === 'string') named.add(x);
    else if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === 'object') Object.values(x).forEach(collect);
  };
  collect([puzzle.data.tree, puzzle.data.hints, puzzle.data.cues, puzzle.data.effects]);
  for (const e of els) {
    const others = els.filter((x) => x.id !== e.id);
    const reachesOut = interactionsOf(e).some((i) => i.setsFlag || i.fires || i.effects?.length || i.screen);
    const namedByOthers = others.some((x) => JSON.stringify(x.data).includes(`"${e.id}"`));
    if (!isClue(e) && !named.has(e.id) && !namedByOthers && !reachesOut && !stepsUsing(project, puzzleId, e.id).length)
      out.push({ severity: 'warning', elementId: e.id, message: `“${e.name}” is part of it, but nothing connects it: no step needs it, and it changes nothing a step does.` });
  }
  for (const e of elementsOf(project, puzzleId)) {
    if (elementKindOf(e) === 'code' && !String(e.data.answer ?? '').trim()) out.push({ severity: 'warning', elementId: e.id, message: `The code “${e.name}” has no true code yet.` });
  }
  for (const e of elementsOf(project, puzzleId)) for (const m of screenIssues(project, e)) out.push({ severity: 'error', elementId: e.id, message: m });
  if (elementsOf(project, puzzleId).some((e) => screenOf(e))) out.push({ severity: 'warning', message: 'Its screen puzzles play in the studio; puzzle export brings them to the engines (there, the interaction they open on is used as it is).' });
  for (const h of hintsOf(puzzle)) if (!h.afterFails && !h.when) out.push({ severity: 'warning', message: `The hint “${h.text}” is never given: give it wrong moves to wait for, or a condition.` });
  for (const c of cuesOf(puzzle)) if (CUE_KINDS.find((k) => k.id === c.kind)?.ref && !c.ref) out.push({ severity: 'warning', message: `A ${c.kind} played when it is solved names no ${c.kind}.` });
  if (hintsOf(puzzle).length || cuesOf(puzzle).length) out.push({ severity: 'warning', message: 'Its hints and what solving it plays are in the studio; puzzle export brings them to the engines.' });
  return out;
};
