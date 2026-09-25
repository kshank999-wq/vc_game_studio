import { newId, makeObject, nextCode, removeObject } from './project';
import type { Connection, DialogueLine, ObjectType, Project, StoryObject } from './types';

/**
 * A scene's contents (spec §10–12). Every element is a normalized object the
 * scene contains through a 'contains' connection, so a character used in five
 * scenes is still one character. The script is a list of DialogueLines.
 */

export type CategoryKey =
  | 'characters'
  | 'dialogue'
  | 'environment'
  | 'objects'
  | 'choices'
  | 'puzzles'
  | 'cinematics'
  | 'inventory'
  | 'logic';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Category {
  key: CategoryKey;
  label: string;
  /** Short label for a port on the exploded scene's edge. */
  port: string;
  /** Element types filed under this category; dialogue is the script's lines instead. */
  types: readonly ObjectType[];
  /** The symbol that stands for the category. */
  symbol: ObjectType;
  /** Where its port sits on the scene's edge (HANDOFF iteration 2). */
  side: Side;
  /** 0–1 along that edge. */
  at: number;
  color: string;
}

export const CATEGORIES: readonly Category[] = [
  { key: 'characters', label: 'Characters', port: 'Characters', types: ['character'], symbol: 'character', side: 'left', at: 0.15, color: 'var(--c-character)' },
  { key: 'dialogue', label: 'Dialogue', port: 'Dialogue', types: [], symbol: 'dialogue', side: 'left', at: 0.5, color: 'var(--c-dialogue)' },
  { key: 'environment', label: 'Environment', port: 'Environ.', types: ['environment'], symbol: 'environment', side: 'left', at: 0.85, color: 'var(--c-environment)' },
  { key: 'objects', label: 'Objects', port: 'Objects', types: ['object'], symbol: 'object', side: 'right', at: 0.15, color: 'var(--c-object)' },
  { key: 'choices', label: 'Choices', port: 'Choices', types: ['choice'], symbol: 'choice', side: 'right', at: 0.5, color: 'var(--c-choice)' },
  { key: 'puzzles', label: 'Puzzles', port: 'Puzzles', types: ['puzzle'], symbol: 'puzzle', side: 'right', at: 0.85, color: 'var(--c-puzzle)' },
  { key: 'cinematics', label: 'Cinematics', port: 'Cinematics', types: ['cinematic'], symbol: 'cinematic', side: 'top', at: 0.3, color: 'var(--c-cinematic)' },
  { key: 'inventory', label: 'Inventory', port: 'Inventory', types: ['inventory'], symbol: 'inventory', side: 'top', at: 0.7, color: 'var(--c-inventory)' },
  { key: 'logic', label: 'Logic', port: 'Logic', types: ['trigger', 'gate', 'state'], symbol: 'trigger', side: 'bottom', at: 0.5, color: 'var(--c-logic)' },
];

/** The category an element type belongs to inside a scene, if any. */
export const categoryFor = (type: ObjectType): Category | undefined =>
  type === 'dialogue' ? CATEGORIES.find((c) => c.key === 'dialogue') : CATEGORIES.find((c) => c.types.includes(type));

/** Only scenes open into a workspace. */
export const isScene = (project: Project, id: string): boolean => project.objects[id]?.type === 'scene';

// ---------------------------------------------------------------- contents

const contains = (project: Project, sceneId: string): Connection[] =>
  project.connections.filter((c) => c.kind === 'contains' && c.sourceId === sceneId && project.objects[c.targetId]);

export const sceneElements = (project: Project, sceneId: string): StoryObject[] =>
  contains(project, sceneId).map((c) => project.objects[c.targetId]!);

export const inScene = (project: Project, sceneId: string, objectId: string): boolean =>
  contains(project, sceneId).some((c) => c.targetId === objectId);

/** How many of each category a scene holds, for the perimeter nodes and ports. */
export const categoryCounts = (project: Project, sceneId: string): Record<CategoryKey, number> => {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])) as Record<CategoryKey, number>;
  for (const element of sceneElements(project, sceneId)) {
    const category = categoryFor(element.type);
    if (category) counts[category.key]++;
  }
  counts.dialogue = sceneLines(project, sceneId).filter((l) => l.kind === 'dialogue').length;
  return counts;
};

export const elementsIn = (project: Project, sceneId: string, key: CategoryKey): StoryObject[] => {
  const category = CATEGORIES.find((c) => c.key === key);
  return category ? sceneElements(project, sceneId).filter((e) => category.types.includes(e.type)) : [];
};

const ELEMENT_CODE: Partial<Record<ObjectType, { prefix: string; pad: number }>> = {
  object: { prefix: 'OBJ-', pad: 2 },
  environment: { prefix: 'ENV-', pad: 2 },
  inventory: { prefix: 'ITM-', pad: 2 },
  puzzle: { prefix: 'PZ-', pad: 2 },
  trigger: { prefix: 'TRG-', pad: 2 },
  gate: { prefix: 'GATE-', pad: 2 },
  state: { prefix: 'ST-', pad: 2 },
  choice: { prefix: 'C', pad: 0 },
  cinematic: { prefix: 'CIN-', pad: 2 },
  character: { prefix: 'CH-', pad: 2 },
};

const ELEMENT_NAME: Partial<Record<ObjectType, string>> = {
  character: 'New character',
  object: 'New object',
  environment: 'New location',
  inventory: 'New item',
  puzzle: 'New puzzle',
  trigger: 'New trigger',
  gate: 'New gate',
  state: 'new_state',
  choice: 'New choice',
  cinematic: 'New cinematic',
};

/** Put an existing object in a scene (a character from the Bible, say). */
export const useInScene = (project: Project, sceneId: string, objectId: string): Project => {
  if (!isScene(project, sceneId) || !project.objects[objectId] || inScene(project, sceneId, objectId)) return project;
  if (!categoryFor(project.objects[objectId]!.type) || project.objects[objectId]!.type === 'dialogue') return project;
  return {
    ...project,
    connections: [...project.connections, { id: newId('conn'), sourceId: sceneId, targetId: objectId, kind: 'contains' }],
  };
};

/**
 * Add a new element to a scene. Dialogue adds a line to the script; everything
 * else creates the object and files it under its category's port.
 */
export const addElement = (
  project: Project,
  sceneId: string,
  type: ObjectType,
  name?: string,
  now = new Date().toISOString(),
): { project: Project; id: string } | null => {
  if (!isScene(project, sceneId) || !categoryFor(type)) return null;
  if (type === 'dialogue') {
    const speaker = elementsIn(project, sceneId, 'characters')[0]?.id ?? null;
    return addLine(project, sceneId, 'dialogue', undefined, speaker);
  }
  const format = ELEMENT_CODE[type];
  const data: StoryObject['data'] = format ? { code: nextCode(project, format) } : {};
  const object = makeObject(type, name?.trim() || ELEMENT_NAME[type] || 'New element', now, data);
  const added = { ...project, objects: { ...project.objects, [object.id]: object } };
  return { project: useInScene(added, sceneId, object.id), id: object.id };
};

/**
 * Take an element out of a scene. A character, and anything another scene
 * also uses, stays in the project; an element only this scene used is deleted.
 */
export const removeFromScene = (project: Project, sceneId: string, objectId: string): Project => {
  if (!inScene(project, sceneId, objectId)) return project;
  const object = project.objects[objectId]!;
  let next: Project = {
    ...project,
    connections: project.connections.filter((c) => !(c.kind === 'contains' && c.sourceId === sceneId && c.targetId === objectId)),
  };
  if (project.objects[sceneId]?.data.locationId === objectId) next = setSceneData(next, sceneId, { locationId: undefined });
  const usedElsewhere = next.connections.some((c) => c.kind === 'contains' && c.targetId === objectId);
  const canonical = object.type === 'character' || project.lanes.some((l) => l.characterId === objectId);
  if (!usedElsewhere && !canonical) next = removeObject(next, objectId);
  // Lines spoken by a character who has left the scene keep their text and lose their speaker.
  if (object.type === 'character') {
    next = { ...next, lines: next.lines.map((l) => (l.sceneId === sceneId && l.speakerId === objectId ? { ...l, speakerId: null } : l)) };
  }
  return next;
};

/** Characters that can speak: every character in the project, those in the scene first. */
export const speakers = (project: Project, sceneId: string): { character: StoryObject; present: boolean }[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'character')
    .map((character) => ({ character, present: inScene(project, sceneId, character.id) }))
    .sort((a, b) => Number(b.present) - Number(a.present) || a.character.name.localeCompare(b.character.name));

// ---------------------------------------------------------------- scene fields

export interface SceneData {
  intExt?: 'INT.' | 'EXT.' | 'INT./EXT.';
  time?: string;
  locationId?: string;
  summary?: string;
  purpose?: string;
  status?: 'outline' | 'inProgress' | 'complete';
}

export const setSceneData = (project: Project, sceneId: string, patch: Partial<Record<keyof SceneData, unknown>>): Project => {
  const scene = project.objects[sceneId];
  if (!scene) return project;
  const data = { ...scene.data };
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    const clean = typeof value === 'string' ? value : value;
    if (clean === undefined || clean === '') {
      if (key in data) {
        delete data[key];
        changed = true;
      }
    } else if (data[key] !== clean) {
      data[key] = clean;
      changed = true;
    }
  }
  if (!changed) return project;
  let next: Project = { ...project, objects: { ...project.objects, [sceneId]: { ...scene, data, modified: new Date().toISOString() } } };
  // The location a scene is set in is one of its environment elements.
  if (typeof patch.locationId === 'string') next = useInScene(next, sceneId, patch.locationId);
  return next;
};

export const setSceneNotes = (project: Project, sceneId: string, notes: string): Project => {
  const scene = project.objects[sceneId];
  if (!scene || scene.notes === notes) return project;
  return { ...project, objects: { ...project.objects, [sceneId]: { ...scene, notes } } };
};

// ---------------------------------------------------------------- script

export const sceneLines = (project: Project, sceneId: string): DialogueLine[] =>
  project.lines.filter((l) => l.sceneId === sceneId).sort((a, b) => a.order - b.order);

/** Renumber a scene's lines 1…n in their current order. */
const renumber = (lines: DialogueLine[], sceneId: string): DialogueLine[] => {
  const ordered = lines.filter((l) => l.sceneId === sceneId).sort((a, b) => a.order - b.order);
  const order = new Map(ordered.map((l, i) => [l.id, i + 1]));
  return lines.map((l) => (order.has(l.id) && order.get(l.id) !== l.order ? { ...l, order: order.get(l.id)! } : l));
};

/** Add a block to the script, after `afterId` or at the end. A speaker not yet in the scene joins it. */
export const addLine = (
  project: Project,
  sceneId: string,
  kind: DialogueLine['kind'],
  afterId?: string,
  speakerId: string | null = null,
): { project: Project; id: string } => {
  const existing = sceneLines(project, sceneId);
  const after = afterId ? existing.find((l) => l.id === afterId) : existing[existing.length - 1];
  const line: DialogueLine = {
    id: newId('line'),
    sceneId,
    kind,
    speakerId: kind === 'dialogue' ? speakerId : null,
    text: '',
    direction: '',
    order: (after?.order ?? 0) + 0.5,
    vo: kind === 'dialogue' ? 'todo' : 'none',
    notes: '',
  };
  let next: Project = { ...project, lines: renumber([...project.lines, line], sceneId) };
  if (line.speakerId) next = useInScene(next, sceneId, line.speakerId);
  return { project: next, id: line.id };
};

export type LinePatch = Partial<Pick<DialogueLine, 'text' | 'direction' | 'speakerId' | 'kind' | 'vo' | 'notes'>>;

export const updateLine = (project: Project, id: string, patch: LinePatch): Project => {
  const line = project.lines.find((l) => l.id === id);
  if (!line) return project;
  const next: DialogueLine = { ...line, ...patch };
  if (next.kind === 'action') {
    next.speakerId = null;
    next.vo = 'none';
  } else if (line.kind === 'action') {
    next.vo = 'todo';
  }
  if (JSON.stringify(next) === JSON.stringify(line)) return project;
  let result: Project = { ...project, lines: project.lines.map((l) => (l.id === id ? next : l)) };
  if (next.speakerId && next.speakerId !== line.speakerId) result = useInScene(result, line.sceneId, next.speakerId);
  return result;
};

export const removeLine = (project: Project, id: string): Project => {
  const line = project.lines.find((l) => l.id === id);
  if (!line) return project;
  return { ...project, lines: renumber(project.lines.filter((l) => l.id !== id), line.sceneId) };
};

/**
 * Who speaks next when Enter ends a line: the other side of the exchange,
 * which is whoever spoke before this speaker.
 */
export const nextSpeaker = (project: Project, sceneId: string, afterId: string): string | null => {
  const lines = sceneLines(project, sceneId);
  const at = lines.findIndex((l) => l.id === afterId);
  const current = lines[at]?.speakerId ?? null;
  for (let i = at - 1; i >= 0; i--) {
    const speaker = lines[i]!.speakerId;
    if (lines[i]!.kind === 'dialogue' && speaker && speaker !== current) return speaker;
  }
  const other = elementsIn(project, sceneId, 'characters').find((c) => c.id !== current);
  return other?.id ?? current;
};

/** A new character straight from the speaker menu: created, and put in the scene. */
export const newCharacter = (project: Project, sceneId: string, name: string): { project: Project; id: string } | null =>
  addElement(project, sceneId, 'character', name);
