import { sceneTimeline } from '../timeline';
import type { Project, TimelineEvent } from '../types';
import type { LevelItem } from './types';

/**
 * Where a scene's timeline events happen in the level (spec §7.3): an
 * opening cinematic at its trigger, dialogue at the speaker, an interaction
 * at its object, an exit at a door. An event names its place, or it is found
 * through the level's links to what the event stands for.
 */

export interface EventPlace {
  item: LevelItem;
  /** Chosen on the event, or found through a link. */
  how: 'set' | 'link';
}

/**
 * Items that stand for a story element: linked to it, or naming it in a
 * setting (an NPC's character, a trigger's cinematic). Library defaults never
 * name a story element, so the item's own settings are enough; and the
 * timeline, which asks this, needn't load the level library.
 */
const standsFor = (item: LevelItem, objectId: string): boolean =>
  !!item.links?.includes(objectId) || Object.values(item.params ?? {}).includes(objectId);

/** What an event stands for in the story: its element, or a dialogue line's speaker. */
const subjectOf = (project: Project, event: TimelineEvent): string | null => {
  if (event.kind === 'dialogue' && event.refId) return project.lines.find((l) => l.id === event.refId)?.speakerId ?? null;
  return event.refId && project.objects[event.refId] ? event.refId : null;
};

export const placeOf = (project: Project, event: TimelineEvent): EventPlace | null => {
  const items = project.levels?.items ?? [];
  if (event.place) {
    const item = items.find((i) => i.id === event.place);
    return item ? { item, how: 'set' } : null;
  }
  const subject = subjectOf(project, event);
  if (!subject) return null;
  const found = items.filter((i) => standsFor(i, subject));
  if (!found.length) return null;
  // Of several, the one in a level this scene is laid out in.
  const sceneLevels = new Set(items.filter((i) => i.links?.includes(event.sceneId)).map((i) => i.levelId));
  return { item: found.find((i) => sceneLevels.has(i.levelId)) ?? found[0]!, how: 'link' };
};

export const placeToOf = (project: Project, event: TimelineEvent): LevelItem | null =>
  (event.placeTo && project.levels?.items.find((i) => i.id === event.placeTo)) || null;

export interface EventUse {
  sceneId: string;
  event: TimelineEvent;
  role: 'at' | 'to';
  how: 'set' | 'link';
}

/** Every scene timeline event that happens at (or moves to) this item. */
export const eventsAt = (project: Project, itemId: string): EventUse[] => {
  const out: EventUse[] = [];
  for (const scene of Object.values(project.objects)) {
    if (scene.type !== 'scene') continue;
    for (const track of sceneTimeline(project, scene.id)) {
      for (const event of track.events) {
        const at = placeOf(project, event);
        if (at?.item.id === itemId) out.push({ sceneId: scene.id, event, role: 'at', how: at.how });
        if (event.placeTo === itemId) out.push({ sceneId: scene.id, event, role: 'to', how: 'set' });
      }
    }
  }
  return out;
};

/** Events that named removed items lose those places (they may still find one through links). */
export const forgetPlaces = (project: Project, gone: ReadonlySet<string>): Project => {
  if (!project.events.some((e) => (e.place && gone.has(e.place)) || (e.placeTo && gone.has(e.placeTo)))) return project;
  return {
    ...project,
    events: project.events.map((e) => {
      if (!(e.place && gone.has(e.place)) && !(e.placeTo && gone.has(e.placeTo))) return e;
      const next = { ...e };
      if (next.place && gone.has(next.place)) delete next.place;
      if (next.placeTo && gone.has(next.placeTo)) delete next.placeTo;
      return next;
    }),
  };
};
