import { startWorld, type Cursor, type Play } from './play';
import type { Project } from './types';

/**
 * Saving a play-through in the studio: the whole of it, the world as it is,
 * where the player is and the transcript so far, so loading carries on from
 * the very line it was saved at. A save belongs to its project; one from
 * another project, or pointing at something since deleted, will not load.
 */

export const SAVE_FORMAT = 'vcgs-play-save';

export interface PlaySave {
  format: typeof SAVE_FORMAT;
  version: 1;
  project: string;
  story: string;
  /** Where the player was, in words ("SC-03 The Vault Door"). */
  at: string;
  /** When it was saved (milliseconds since 1970). */
  savedAt: number;
  play: Play;
}

/** Where a play-through is, in words: the scene (or graph node) it is in. */
export const whereOf = (project: Project, play: Play): string => {
  const here = play.where.sceneId ?? play.where.nodeId;
  const o = here ? project.objects[here] : undefined;
  if (play.cursor.at === 'end') return 'The end';
  return o ? `${o.data.code ?? ''} ${o.name}`.trim() : 'The beginning';
};

/** The play-through as a save file's text. */
export const saveText = (project: Project, play: Play, savedAt = Date.now()): string =>
  JSON.stringify({ format: SAVE_FORMAT, version: 1, project: project.id, story: project.name, at: whereOf(project, play), savedAt, play } satisfies PlaySave);

/** The objects a cursor stands on, to check they are still in the story. */
const cursorIds = (c: Cursor): string[] => {
  switch (c.at) {
    case 'node':
    case 'after':
    case 'graphChoice':
      return [c.id];
    case 'event':
    case 'sceneChoice':
    case 'freePlay':
    case 'encounter':
      return [c.sceneId];
    case 'wait':
      return cursorIds(c.next);
    case 'end':
      return [];
  }
};

/** Read a save: the play-through to carry on, or why it will not load. */
export const playFromSave = (project: Project, text: string): { play: Play; save: PlaySave } | { error: string } => {
  let save: Partial<PlaySave>;
  try {
    save = JSON.parse(text) as Partial<PlaySave>;
  } catch {
    return { error: 'That is not a saved game.' };
  }
  const play = save?.play;
  if (save?.format !== SAVE_FORMAT || !play || typeof play !== 'object' || !play.cursor || !play.world || !Array.isArray(play.log)) return { error: 'That is not a saved game.' };
  if (save.project !== project.id) return { error: `That game was saved from another project${save.story ? ` (${save.story})` : ''}.` };
  const gone = cursorIds(play.cursor).filter((id) => !project.objects[id]);
  if (gone.length) return { error: 'That game was saved at a part of the story that is no longer there.' };
  // Anything the world gained since (a new kind of state) starts empty.
  const world = { ...startWorld(project), ...play.world };
  return { play: { ...play, world, where: play.where ?? { nodeId: null, sceneId: null, eventId: null } }, save: save as PlaySave };
};

/** The save slots in the browser, by project. */
export const savesStorageKey = (projectId: string) => `vcgs.saves.${projectId}`;
export const SLOTS = 3;
