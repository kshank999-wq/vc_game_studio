import { newId } from './project';
import type { Project, StoryObject } from './types';

/**
 * A cinematic's shot list (spec §17, Game Studio §12): the shots in order,
 * each with its framing, camera move, lens, who is in it, what happens, the
 * line spoken over it, sound, effects, how long it holds and how it cuts to
 * the next. The running time and shot count the timeline shows come from
 * here once there is a list.
 */

export const FRAMINGS = ['Extreme wide', 'Wide', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Over the shoulder', 'Two-shot', 'POV', 'Insert', 'Aerial'] as const;
export const MOVES = ['Static', 'Pan', 'Tilt', 'Push in', 'Pull out', 'Track', 'Crane', 'Handheld', 'Orbit', 'Zoom'] as const;
export const TRANSITIONS = ['Cut', 'Match cut', 'Smash cut', 'Dissolve', 'Fade to black', 'Wipe'] as const;

export type Framing = (typeof FRAMINGS)[number];
export type Move = (typeof MOVES)[number];
export type Transition = (typeof TRANSITIONS)[number];

export interface Shot {
  id: string;
  framing: Framing;
  move: Move;
  /** Lens or field of view, as the camera team writes it: "35mm", "wide angle". */
  lens: string;
  /** Characters in frame. */
  characters: string[];
  /** What we see. */
  action: string;
  /** A script line spoken over it, if any. */
  lineId?: string;
  audio: string;
  vfx: string;
  seconds: number;
  /** Into the next shot (the last one's is how the cinematic ends). */
  transition: Transition;
  notes: string;
}

export const shotsOf = (object: StoryObject | undefined): Shot[] => (object?.data.shots as Shot[] | undefined) ?? [];

export const runningTime = (shots: Shot[]): number => Math.round(shots.reduce((t, s) => t + (s.seconds || 0), 0) * 10) / 10;

export const newShot = (patch: Partial<Shot> = {}): Shot => ({
  id: newId('shot'),
  framing: 'Wide',
  move: 'Static',
  lens: '',
  characters: [],
  action: '',
  audio: '',
  vfx: '',
  seconds: 3,
  transition: 'Cut',
  notes: '',
  ...patch,
});

const setShots = (project: Project, id: string, shots: Shot[]): Project => {
  const object = project.objects[id];
  if (!object || object.type !== 'cinematic') return project;
  return { ...project, objects: { ...project.objects, [id]: { ...object, data: { ...object.data, shots }, modified: new Date().toISOString() } } };
};

/** Add a shot after `afterId` (or at the end); the new shot follows on from the one before it. */
export const addShot = (project: Project, id: string, afterId?: string): { project: Project; shotId: string } => {
  const shots = shotsOf(project.objects[id]);
  const at = afterId ? shots.findIndex((s) => s.id === afterId) + 1 : shots.length;
  const before = shots[at - 1];
  const shot = newShot(before ? { framing: before.framing, lens: before.lens, characters: before.characters } : {});
  return { project: setShots(project, id, [...shots.slice(0, at), shot, ...shots.slice(at)]), shotId: shot.id };
};

export const updateShot = (project: Project, id: string, shotId: string, patch: Partial<Omit<Shot, 'id'>>): Project => {
  const shots = shotsOf(project.objects[id]);
  const shot = shots.find((s) => s.id === shotId);
  if (!shot || Object.entries(patch).every(([k, v]) => JSON.stringify(shot[k as keyof Shot]) === JSON.stringify(v))) return project;
  return setShots(
    project,
    id,
    shots.map((s) => {
      if (s.id !== shotId) return s;
      const next = { ...s, ...patch };
      if (!next.lineId) delete next.lineId;
      return next;
    }),
  );
};

export const removeShot = (project: Project, id: string, shotId: string): Project => setShots(project, id, shotsOf(project.objects[id]).filter((s) => s.id !== shotId));

export const duplicateShot = (project: Project, id: string, shotId: string): { project: Project; shotId: string } => {
  const shots = shotsOf(project.objects[id]);
  const at = shots.findIndex((s) => s.id === shotId);
  if (at < 0) return { project, shotId };
  const copy = { ...shots[at]!, id: newId('shot') };
  return { project: setShots(project, id, [...shots.slice(0, at + 1), copy, ...shots.slice(at + 1)]), shotId: copy.id };
};

/** Move a shot to a new place in the list. */
export const moveShot = (project: Project, id: string, shotId: string, to: number): Project => {
  const shots = shotsOf(project.objects[id]);
  const from = shots.findIndex((s) => s.id === shotId);
  if (from < 0) return project;
  const target = Math.max(0, Math.min(shots.length - 1, to));
  if (target === from) return project;
  const next = [...shots];
  const [shot] = next.splice(from, 1);
  next.splice(target, 0, shot!);
  return setShots(project, id, next);
};

/** "3 shots · 14s": from the shot list when there is one, else what the timeline says. */
export const cinematicTiming = (project: Project, id: string, fallback?: { seconds?: number; shots?: number }): { seconds: number; shots: number; fromList: boolean } => {
  const shots = shotsOf(project.objects[id]);
  if (shots.length) return { seconds: runningTime(shots), shots: shots.length, fromList: true };
  return { seconds: fallback?.seconds ?? 0, shots: fallback?.shots ?? 1, fromList: false };
};

/** One shot in words, for reports and the play-through: "Close-up · push in · Mara — She sees the seam". */
export const describeShot = (project: Project, shot: Shot): string => {
  const who = shot.characters.map((c) => project.objects[c]?.name).filter(Boolean).join(', ');
  const line = shot.lineId ? project.lines.find((l) => l.id === shot.lineId) : undefined;
  return [
    [shot.framing, shot.move !== 'Static' ? shot.move.toLowerCase() : '', shot.lens].filter(Boolean).join(' · '),
    who,
    shot.action,
    line?.text ? `“${line.text}”` : '',
  ]
    .filter(Boolean)
    .join(' — ');
};

/** The script lines a shot can play over: those of the scenes the cinematic is in. */
export const linesFor = (project: Project, id: string) => {
  const scenes = project.connections.filter((c) => c.kind === 'contains' && c.targetId === id).map((c) => c.sourceId);
  return project.lines
    .filter((l) => scenes.includes(l.sceneId) && l.kind === 'dialogue' && l.text)
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.order - b.order);
};
