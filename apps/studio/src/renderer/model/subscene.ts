import { codeFormatFor, makeObject, nextCode } from './project';
import type { Project, StoryObject } from './types';

/**
 * Sub-scenes (macro to micro): a scene's rooms and smaller moments, each a
 * scene of its own (with its own elements, puzzles, dialogue and map: a room
 * inside the scene's area) that belongs to the scene rather than standing on
 * the story graph.
 */

/** The scene a sub-scene belongs to, if it still exists. */
export const parentSceneOf = (project: Project, id: string): StoryObject | undefined => {
  const parent = project.objects[id]?.data.parentSceneId;
  return typeof parent === 'string' && project.objects[parent]?.type === 'scene' ? project.objects[parent] : undefined;
};

/** A scene's sub-scenes, in the order they were made. */
export const subScenesOf = (project: Project, sceneId: string): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'scene' && o.data.parentSceneId === sceneId)
    .sort((a, b) => a.created.localeCompare(b.created) || String(a.data.code ?? '').localeCompare(String(b.data.code ?? '')));

/** The scenes it is inside, outermost first. */
export const sceneTrail = (project: Project, id: string): StoryObject[] => {
  const out: StoryObject[] = [];
  let at = parentSceneOf(project, id);
  for (let guard = 0; at && guard < 16; guard++) {
    out.unshift(at);
    at = parentSceneOf(project, at.id);
  }
  return out;
};

/** A new sub-scene of a scene: a room to go into, named “Room n” unless named. */
export const addSubScene = (project: Project, parentId: string, name?: string, now = new Date().toISOString()): { project: Project; id: string } | null => {
  const parent = project.objects[parentId];
  if (parent?.type !== 'scene') return null;
  const format = codeFormatFor('scene');
  const code = format ? nextCode(project, format) : undefined;
  const object = makeObject('scene', name?.trim() || `Room ${subScenesOf(project, parentId).length + 1}`, now, { ...(code ? { code } : {}), parentSceneId: parentId, intExt: parent.data.intExt ?? 'INT.', time: parent.data.time ?? 'DAY' });
  return { project: { ...project, objects: { ...project.objects, [object.id]: object } }, id: object.id };
};
