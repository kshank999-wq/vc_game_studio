import { interactionsOf } from './details';
import { advance, choose, endFreePlay, interact, decisionAt, playToDecision, promptOf, startPlay, type Decision, type Outcome, type Play } from './play';
import type { Project } from './types';

/**
 * Expected paths (spec §15): a play-through recorded as the path the story
 * should take (its decisions, the scenes it goes through, how it ends), kept
 * in the project. Checking one plays the story again from where it started,
 * making the same decisions, and says whether it still goes that way: where
 * it first differs, and why (an option no longer on offer, and what it needs;
 * a choice the story no longer reaches; a scene missed or new; another end).
 * Like tests for the story: check them all after changing it.
 */

export interface ExpectedPath {
  id: string;
  name: string;
  /** Where it starts: a node on the graph, or the Beginning when absent. */
  from?: string;
  decisions: Decision[];
  /** The scenes and plot points it goes through, in order, by id. */
  through: string[];
  /** How it ends, or null when it was recorded before the end. */
  ending: { outcome: Outcome; text: string } | null;
  recordedAt: number;
}

/** The scenes and plot points a play-through has gone through, in order (the transcript's headings). */
export const throughOf = (play: Play): string[] => play.log.flatMap((e) => (e.kind === 'heading' ? [e.id] : []));

/** A play-through as an expected path. */
export const pathOf = (play: Play, name: string, from?: string, at = Date.now()): ExpectedPath => ({
  id: `path_${at.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  name,
  ...(from ? { from } : {}),
  decisions: [...(play.decisions ?? [])],
  through: throughOf(play),
  ending: play.cursor.at === 'end' ? { outcome: play.cursor.outcome, text: play.cursor.text } : null,
  recordedAt: at,
});

const nameOf = (project: Project, id: string) => {
  const o = project.objects[id];
  return o ? `${o.data.code ? `${o.data.code} ` : ''}${o.name}`.trim() : 'something no longer in the story';
};

/** A decision in words ("C2 Pocket the ring: Carry on"). */
export const describeDecision = (project: Project, d: Decision): string => {
  switch (d.kind) {
    case 'choice':
      return `${nameOf(project, d.at)}: ${d.option}`;
    case 'encounter':
      return `${nameOf(project, d.at)}: ${d.won ? 'won' : 'lost'}`;
    case 'use': {
      const object = project.objects[d.object];
      const verb = object ? interactionsOf(object).find((i) => i.id === d.interaction)?.verb : undefined;
      return `${object?.name ?? 'an object'}: ${verb ?? 'used'}`;
    }
    case 'skip':
      return 'free play left';
  }
};

/** What the story offers now, in words, for saying where a replay went instead. */
const offeredNow = (project: Project, play: Play): string => {
  const p = promptOf(project, play);
  if (p.kind === 'end') return `the end (${p.text})`;
  const at = decisionAt(project, play);
  if (p.kind === 'freePlay') return `free play in ${p.title}`;
  if (p.kind === 'choice') return at && project.objects[at] ? nameOf(project, at) : p.title;
  return 'more to play';
};

/** Make one decision again on the story as it is now; the play after it, or why it can't be made. */
const redo = (project: Project, play: Play, d: Decision): { play: Play } | { why: string } => {
  const at = decisionAt(project, play);
  const prompt = promptOf(project, play);
  const reached = offeredNow(project, play);
  if (at !== d.at) return { why: `Expected ${d.kind === 'use' || d.kind === 'skip' ? 'a free play' : nameOf(project, d.at)}, but the story reached ${reached} instead.` };
  if (d.kind === 'choice' || d.kind === 'encounter') {
    if (prompt.kind !== 'choice') return { why: `Expected ${nameOf(project, d.at)}, but the story reached ${reached} instead.` };
    const index = d.kind === 'encounter' ? (d.won ? 0 : 1) : prompt.options.findIndex((o) => o.label === d.option);
    const option = prompt.options[index];
    if (!option) return { why: `${nameOf(project, d.at)} no longer offers “${d.kind === 'choice' ? d.option : d.won ? 'Win' : 'Lose'}”.` };
    if (!option.available) return { why: `At ${nameOf(project, d.at)}, “${option.label}” isn’t on offer: it needs ${option.needs ?? 'something the path no longer has'}.` };
    return { play: choose(project, play, index) };
  }
  if (prompt.kind !== 'freePlay') return { why: `Expected a free play, but the story reached ${reached} instead.` };
  if (d.kind === 'skip') return { play: endFreePlay(project, play) };
  const object = prompt.objects.find((o) => o.id === d.object);
  const verb = object?.verbs.find((v) => v.id === d.interaction);
  if (!object || !verb) return { why: `In ${prompt.title}, ${project.objects[d.object]?.name ?? 'the object'} can no longer be used that way.` };
  if (!verb.available) return { why: `In ${prompt.title}, “${verb.verb} ${object.name}” needs ${verb.needs ?? 'something the path no longer has'}.` };
  return { play: interact(project, play, d.object, d.interaction) };
};

/** Play on past lines and actions, as the player would, to the next decision or the end. */
const onward = (project: Project, play: Play): Play => {
  let p = play;
  for (let n = 0; n < 50 && promptOf(project, p).kind === 'continue'; n++) {
    const next = playToDecision(project, advance(project, p));
    if (next === p) break;
    p = next;
  }
  return p;
};

export interface PathCheck {
  ok: boolean;
  /** How many of its decisions the story still let it make. */
  followed: number;
  /** The first difference, in words (none when it still goes the same way). */
  problem?: string;
  /** The scenes it went through that the path doesn't, and those it missed. */
  extra: string[];
  missed: string[];
  /** The play-through as the check left it (to look at, or carry on from). */
  play: Play;
}

/** Play an expected path again on the story as it is now, and say whether it still goes that way. */
export const checkPath = (project: Project, path: ExpectedPath): PathCheck => {
  let play = onward(project, startPlay(project, path.from));
  let followed = 0;
  let problem: string | undefined;
  for (const d of path.decisions) {
    const r = redo(project, play, d);
    if ('why' in r) {
      problem = `After ${followed} of ${path.decisions.length} decisions: ${r.why}`;
      break;
    }
    play = onward(project, r.play);
    followed++;
  }
  // A path saved before the end is checked as far as it went: the replay may play on past it.
  const through = path.ending ? throughOf(play) : throughOf(play).slice(0, path.through.length);
  const extra = through.filter((id) => !path.through.includes(id));
  const missed = problem ? [] : path.through.filter((id) => !through.includes(id));
  if (!problem) {
    const firstDiff = path.through.findIndex((id, i) => through[i] !== id);
    if (firstDiff >= 0 || through.length !== path.through.length) {
      const at = firstDiff >= 0 ? firstDiff : Math.min(through.length, path.through.length);
      const expected = path.through[at];
      const got = through[at];
      problem = expected && got ? `It went through ${nameOf(project, got)} where the path went through ${nameOf(project, expected)}.` : expected ? `It stopped before ${nameOf(project, expected)}.` : `It went on through ${nameOf(project, got!)}, past where the path ended.`;
    } else if (path.ending && (play.cursor.at !== 'end' || play.cursor.outcome !== path.ending.outcome || play.cursor.text !== path.ending.text)) {
      problem = play.cursor.at === 'end' ? `It ended “${play.cursor.text}”, not “${path.ending.text}”.` : `It didn’t reach the end (“${path.ending.text}”): it waits at ${offeredNow(project, play)}.`;
    }
  }
  return { ok: !problem, followed, ...(problem ? { problem } : {}), extra, missed, play };
};

/** Every expected path checked against the story as it is now. */
export const checkAllPaths = (project: Project): { path: ExpectedPath; check: PathCheck }[] => (project.paths ?? []).map((path) => ({ path, check: checkPath(project, path) }));

/**
 * Play the story to its end by rule, for a quick path: the first (or last)
 * option on offer at every choice, every encounter won, and in free play the
 * first thing that can be used, until nothing can.
 */
export const playBy = (project: Project, pick: 'first' | 'last', from?: string): Play => {
  let play = onward(project, startPlay(project, from));
  for (let n = 0; n < 200; n++) {
    const prompt = promptOf(project, play);
    let next = play;
    if (prompt.kind === 'choice') {
      const on = prompt.options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
      if (!on.length) break;
      next = choose(project, play, prompt.symbol === 'encounter' ? 0 : pick === 'last' ? on.at(-1)! : on[0]!);
    } else if (prompt.kind === 'freePlay') {
      const use = prompt.objects.flatMap((o) => o.verbs.filter((v) => v.available).map((v) => [o.id, v.id] as const))[0];
      next = use ? interact(project, play, use[0], use[1]) : endFreePlay(project, play);
    } else break;
    if (next === play) break;
    play = onward(project, next);
  }
  return play;
};

export const addPath = (project: Project, path: ExpectedPath): Project => ({ ...project, paths: [...(project.paths ?? []), path] });
export const removePath = (project: Project, id: string): Project => ({ ...project, paths: (project.paths ?? []).filter((p) => p.id !== id) });
/** Take the story's way now as the path's new expected way (after a change made on purpose). */
export const updatePath = (project: Project, id: string, play: Play): Project => ({
  ...project,
  paths: (project.paths ?? []).map((p) => (p.id === id ? { ...pathOf(play, p.name, p.from, Date.now()), id: p.id } : p)),
});
