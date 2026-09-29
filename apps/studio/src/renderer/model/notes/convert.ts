import { laneSequence, nodeSize, SPAN_PAD, spanRange, spineLane, spineSequence } from '../layout';
import { addLevel } from '../level/level';
import { canPlace, codeFormatFor, makeObject, newId, nextCode, packLane, settle } from '../project';
import { addLine, categoryFor, elementCodeFor, isScene, sceneLines, setSpeakerByName, useInScene } from '../scene';
import type { Lane, ObjectType, Project } from '../types';
import { liveDestinations, livePlacements, noteById, notesOf, statusOf } from './sorter';
import { CATEGORY_TYPES } from './templates';
import type { Destination, ExtractedNote, FlowPlacement, Layer } from './types';

/**
 * Turning cards into the game (Note Sorter spec §7–§12): what a card can
 * become, making the object, and placing it — on the Spine or the Player
 * Lane, in a layer of a scene, in a level, in the Game Bible or a gameplay
 * system. Every object keeps a link back to the card, and the card to the
 * source words (`data.fromNote`), so lineage runs both ways.
 */

const stamp = () => new Date().toISOString();

export type KindGroup = 'Story' | 'World' | 'Systems';

export interface Kind {
  key: string;
  label: string;
  group: KindGroup;
  type: ObjectType;
  /** A Player Lane beat is a plot point for the Player Lane. */
  player?: boolean;
}

/** The "What is it?" picker (HANDOFF §2), grouped as it is drawn. */
export const KINDS: readonly Kind[] = [
  { key: 'spineBeat', label: 'Spine beat', group: 'Story', type: 'plotPoint' },
  { key: 'playerBeat', label: 'Player Lane beat', group: 'Story', type: 'plotPoint', player: true },
  { key: 'scene', label: 'Scene', group: 'Story', type: 'scene' },
  { key: 'cinematic', label: 'Cinematic', group: 'Story', type: 'cinematic' },
  { key: 'dialogue', label: 'Dialogue block', group: 'Story', type: 'dialogue' },
  { key: 'choice', label: 'Choice', group: 'Story', type: 'choice' },
  { key: 'lore', label: 'Lore entry', group: 'Story', type: 'lore' },
  { key: 'quest', label: 'Quest · Objective', group: 'Story', type: 'quest' },
  { key: 'character', label: 'Character / NPC', group: 'World', type: 'character' },
  { key: 'environment', label: 'Location · Level', group: 'World', type: 'environment' },
  { key: 'inventory', label: 'Item · Weapon', group: 'World', type: 'inventory' },
  { key: 'object', label: 'Smart object', group: 'World', type: 'object' },
  { key: 'puzzle', label: 'Puzzle', group: 'World', type: 'puzzle' },
  { key: 'encounter', label: 'Encounter · Enemy', group: 'World', type: 'encounter' },
  { key: 'mechanic', label: 'Mechanic', group: 'Systems', type: 'mechanic' },
  { key: 'gate', label: 'State gate', group: 'Systems', type: 'gate' },
  { key: 'trigger', label: 'Trigger', group: 'Systems', type: 'trigger' },
  { key: 'state', label: 'State change', group: 'Systems', type: 'state' },
];

export const kindFor = (type: ObjectType, player = false): Kind | undefined => KINDS.find((k) => k.type === type && !!k.player === player);

/** Words that give a card's type away when its category doesn't. */
const HINTS: [RegExp, string][] = [
  [/\b(cinematic|cutscene|camera|shot)\b/i, 'cinematic'],
  [/^\s*[A-Z][\w' -]{1,30}(\s*\(.*?\))?\s*:\s*["“]/, 'dialogue'],
  [/["“].+["”]/, 'dialogue'],
  [/\b(choice|choose|decide|or forgives?|either)\b/i, 'choice'],
  [/\b(level|map|stage|area|district|tower|bazaar|dungeon)\b/i, 'environment'],
  [/\b(mechanic|meter|ability|power|phase|combo|stamina)\b/i, 'mechanic'],
  [/\b(enemy|enemies|guards?|boss|demons?|monsters?|encounter)\b/i, 'encounter'],
  [/\b(item|weapon|talisman|pickup|key|currency|coins?)\b/i, 'inventory'],
  [/\b(puzzle|riddle|lock|lever)\b/i, 'puzzle'],
  [/\b(quest|objective|mission|collect all)\b/i, 'quest'],
  [/\b(you play|thief|hero|villain|sister|brother|king|queen|sultan)\b/i, 'character'],
  [/\b(years (ago|before)|age of|era|legend|history|sealed|long ago)\b/i, 'lore'],
];

/** What a card probably becomes: its category's usual type, else what its words say. Only ever offered. */
export const suggestedKind = (project: Project, note: ExtractedNote): Kind | undefined => {
  const categories = notesOf(project).categories;
  let category = categories.find((c) => c.id === note.categoryId);
  // A subcategory without a type of its own takes its parent's.
  while (category) {
    const type = category.templateKey ? CATEGORY_TYPES[category.templateKey] : undefined;
    if (type) return kindFor(type);
    category = categories.find((c) => c.id === category!.parentId);
  }
  const hint = HINTS.find(([pattern]) => pattern.test(note.text));
  return hint ? KINDS.find((k) => k.key === hint[1]) : undefined;
};

/**
 * A name from a card's words. A short label before a colon names it ("The
 * flooded chapel level: …" is the flooded chapel; "Lantern mechanic: …" the
 * lantern), less a word that only says what kind of note it is; otherwise
 * its first few words, without the punctuation.
 */
export const nameFrom = (text: string, words = 5): string => {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const label = /^\s*([^:"“]{2,40}):\s*\S/.exec(text)?.[1]?.trim();
  if (label && label.split(/\s+/).length <= 5 && !/^[A-Z][\w'-]*(,|\s+first line)/.test(label)) {
    const bare = label.replace(/\s+(mechanic|level|idea|note|notes)$/i, '').replace(/^the\s+/i, (m) => (/(mechanic|level)$/i.test(label) ? '' : m));
    if (bare) return cap(bare);
  }
  const clean = text.replace(/["“”]/g, '').trim();
  const cut = clean.split(/\s+/).slice(0, words).join(' ').replace(/[.,;:!?—-]+$/, '');
  return cap(cut) || 'Untitled';
};

/** A dialogue excerpt's speaker and words ("Samira: 'You opened the lamp.'"). */
export const dialogueOf = (text: string): { speaker: string; words: string } => {
  const m = /^\s*(?:[\w-]+\s*[,:]\s*)?([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)?)(?:,?\s*first line)?\s*(?:\(.*?\))?\s*:\s*(.+)$/s.exec(text);
  const words = (m ? m[2]! : text).trim().replace(/^["“]|["”]$/g, '').trim();
  return { speaker: m ? m[1]!.trim() : '', words };
};

const codeFor = (project: Project, type: ObjectType): string | undefined => {
  const format = codeFormatFor(type) ?? elementCodeFor(type);
  return format ? nextCode(project, format) : undefined;
};

const withNote = (project: Project, id: string, update: (n: ExtractedNote) => ExtractedNote): Project => {
  const set = notesOf(project);
  return { ...project, notes: { ...set, notes: set.notes.map((n) => (n.id === id ? update(n) : n)) } };
};

/**
 * Convert a card into a game object (spec §7). The object carries the card's
 * words as its notes and a link back to the card; a card can be converted
 * again, and every object it becomes points back to the same source words.
 * A dialogue block waits for its scene: it becomes a script line when placed.
 */
export const convertNote = (project: Project, noteId: string, kindKey: string, name?: string, now = stamp()): { project: Project; objectId: string } | null => {
  const note = noteById(project, noteId);
  const kind = KINDS.find((k) => k.key === kindKey);
  if (!note || !kind) return null;
  if (kind.type === 'dialogue') {
    const { speaker } = dialogueOf(note.text);
    const destination: Destination = { objectType: 'dialogue', objectId: '', ...(speaker ? { speaker } : {}) };
    const named = name?.trim() || note.name;
    return { project: withNote(project, noteId, (n) => ({ ...n, ...(named ? { name: named } : {}), destinations: [...n.destinations, destination] })), objectId: '' };
  }
  const code = codeFor(project, kind.type);
  const object = makeObject(kind.type, name?.trim() || note.name || nameFrom(note.text), now, {
    ...(code ? { code } : {}),
    fromNote: noteId,
    ...(kind.player ? { playerBeat: true } : {}),
    ...(kind.type === 'scene' || kind.type === 'plotPoint' ? { summary: note.text } : {}),
  });
  object.notes = note.text;
  const next: Project = { ...project, objects: { ...project.objects, [object.id]: object } };
  return {
    project: withNote(next, noteId, (n) => ({ ...n, ...(name?.trim() ? { name: name.trim() } : {}), destinations: [...n.destinations, { objectType: kind.type, objectId: object.id }] })),
    objectId: object.id,
  };
};

// ---------------------------------------------------------------- the Player Lane

export const PLAYER_LANE_COLOR = '#E8E0C8';

export const playerLaneOf = (project: Project): Lane | undefined => project.lanes.find((l) => l.role === 'player');

/** The Player Lane: a track from Beginning to Ending for the player's progression beats. Made the first time it's needed. */
export const ensurePlayerLane = (project: Project): { project: Project; laneId: string } => {
  const existing = playerLaneOf(project);
  if (existing) return { project, laneId: existing.id };
  const sequence = spineSequence(project);
  const lane: Lane = {
    id: newId('lane'),
    kind: 'subplot',
    role: 'player',
    name: 'Player Lane',
    subtitle: 'Player progression',
    color: PLAYER_LANE_COLOR,
    order: Math.max(0, ...project.lanes.map((l) => l.order)) + 1,
    visible: true,
    locked: false,
    ...(sequence.length >= 2 ? { span: { startRef: sequence[0]!, endRef: sequence[sequence.length - 1]! } } : {}),
  };
  return { project: settle({ ...project, lanes: [...project.lanes, lane] }), laneId: lane.id };
};

// ---------------------------------------------------------------- placing

/** Build flow's drop targets on the right (HANDOFF §3): Bible sections and gameplay systems. */
export const BIBLE_SECTIONS = [
  { key: 'lore', label: 'Lore', symbol: 'lore', types: ['lore'] },
  { key: 'characters', label: 'Characters & NPCs', symbol: 'character', types: ['character'] },
  { key: 'inventory', label: 'Inventory & economy', symbol: 'inventory', types: ['inventory'] },
] as const;

export const SYSTEMS = [
  { key: 'mechanics', label: 'Mechanics', symbol: 'mechanic', types: ['mechanic'] },
  { key: 'encounters', label: 'Encounters & enemies', symbol: 'encounter', types: ['encounter'] },
  { key: 'puzzles', label: 'Puzzles & smart objects', symbol: 'puzzle', types: ['puzzle', 'object'] },
  { key: 'logic', label: 'Gates, triggers, state', symbol: 'gate', types: ['gate', 'trigger', 'state'] },
] as const;

/** What a scene layer takes (spec §10), in words for its drop target. */
export const LAYER_HINT: Record<Layer, string> = {
  narrative: 'story, stakes',
  behavior: 'NPC blocking',
  systemic: 'gates, triggers',
  presentation: 'dialogue, cinematics',
};

export type Place =
  | { target: 'spine'; after?: string }
  | { target: 'playerLane'; after?: string }
  | { target: 'sceneLayer'; sceneId: string; layer: Layer }
  | { target: 'level'; levelId: string }
  | { target: 'bible' | 'system'; section: string };

/** Put an existing object on a track, just after a node there (or at the end), and let the track settle. */
const onLane = (project: Project, objectId: string, laneId: string, after?: string): Project => {
  const lane = project.lanes.find((l) => l.id === laneId)!;
  const ids = laneSequence(project, laneId).filter((id) => id !== objectId);
  const anchor = after && ids.includes(after) ? after : lane.kind === 'spine' ? ids[ids.length - 2] : ids[ids.length - 1];
  const at = anchor ? project.placements[anchor]! : undefined;
  const range = lane.kind === 'subplot' ? spanRange(project, lane) : null;
  const x = at ? at.x + 1 : (range?.from ?? 0) + SPAN_PAD;
  const placed = { ...project, placements: { ...project.placements, [objectId]: { laneId, x, y: 0 } } };
  return settle(packLane(placed, laneId));
};

/** Why an object can't go there, or null when it can. */
export const placeRefusal = (project: Project, objectType: ObjectType, place: Place): string | null => {
  switch (place.target) {
    case 'spine':
      return canPlace(project, objectType, spineLane(project).id) ? null : 'The Spine takes plot points, scenes, cinematics and choices.';
    case 'playerLane':
      return ['plotPoint', 'scene', 'choice'].includes(objectType) ? null : 'The Player Lane takes beats, scenes and choices.';
    case 'sceneLayer':
      return isScene(project, place.sceneId) ? null : 'That isn’t a scene.';
    default:
      return null;
  }
};

/**
 * Place a card's object in the game (spec §8–§12). The card stays in the
 * staging library, marked placed, and keeps its source link. A scene layer
 * puts the element in the scene (a dialogue block becomes a line of its
 * script, spoken by the character named); a level keeps the card's words
 * in its notes; the Bible and the gameplay systems file it.
 */
export const placeNote = (project: Project, noteId: string, objectId: string, place: Place): { project: Project; objectId: string } | null => {
  const note = noteById(project, noteId);
  const destination = note?.destinations.find((d) => d.objectId === objectId);
  if (!note || !destination) return null;
  if (placeRefusal(project, destination.objectType, place)) return null;
  let next = project;
  let placedId = objectId;
  let record: FlowPlacement;
  switch (place.target) {
    case 'spine': {
      const laneId = spineLane(next).id;
      next = onLane(next, objectId, laneId, place.after);
      record = { target: 'spine', targetId: laneId, objectId };
      break;
    }
    case 'playerLane': {
      const made = ensurePlayerLane(next);
      next = onLane(made.project, objectId, made.laneId, place.after);
      record = { target: 'playerLane', targetId: made.laneId, objectId };
      break;
    }
    case 'sceneLayer': {
      if (destination.objectType === 'dialogue') {
        const { words } = dialogueOf(note.text);
        const lines = sceneLines(next, place.sceneId);
        const added = addLine(next, place.sceneId, 'dialogue', lines[lines.length - 1]?.id);
        next = added.project;
        next = { ...next, lines: next.lines.map((l) => (l.id === added.id ? { ...l, text: words } : l)) };
        if (destination.speaker) next = setSpeakerByName(next, added.id, destination.speaker).project;
        placedId = added.id;
        // The block now is that line.
        next = withNote(next, noteId, (n) => ({ ...n, destinations: n.destinations.map((d) => (d === destination || (d.objectType === 'dialogue' && d.objectId === objectId) ? { ...d, objectId: added.id } : d)) }));
      } else if (categoryFor(destination.objectType)) {
        next = useInScene(next, place.sceneId, objectId);
      }
      record = { target: 'sceneLayer', targetId: place.sceneId, layer: place.layer, objectId: placedId };
      break;
    }
    case 'level': {
      const levels = next.levels;
      if (!levels?.levels.some((l) => l.id === place.levelId)) return null;
      const line = `• ${note.text}`;
      next = {
        ...next,
        levels: {
          ...levels,
          levels: levels.levels.map((l) =>
            l.id === place.levelId
              ? {
                  ...l,
                  notes: l.notes?.includes(line) ? l.notes : [l.notes, line].filter(Boolean).join('\n'),
                  ...(['scene', 'plotPoint'].includes(destination.objectType) && !(l.links ?? []).includes(objectId) ? { links: [...(l.links ?? []), objectId] } : {}),
                }
              : l,
          ),
        },
      };
      record = { target: 'level', targetId: place.levelId, objectId };
      break;
    }
    default:
      record = { target: place.target, targetId: place.section, objectId };
  }
  // One place per kind of target: placing again moves it.
  next = withNote(next, noteId, (n) => ({ ...n, flowPlacements: [...n.flowPlacements.filter((p) => !(p.objectId === record.objectId && p.target === record.target)), record] }));
  return { project: next, objectId: placedId };
};

/** A new level for the Build flow's "+ New level". */
export const newLevel = (project: Project, name?: string) => addLevel(project, name);

// ---------------------------------------------------------------- reading it back

export interface Staged {
  note: ExtractedNote;
  destination: Destination;
  placed: boolean;
}

/** The Build flow's staging library: every object a card became, placed or not. */
export const staged = (project: Project): Staged[] =>
  notesOf(project).notes.flatMap((note) => {
    const placements = livePlacements(project, note);
    return liveDestinations(project, note).map((destination) => ({
      note,
      destination,
      placed: placements.some((p) => p.objectId === destination.objectId && !!destination.objectId),
    }));
  });

/** Cards sorted but still just notes: listed under the staging library, each with a Convert link. */
export const stillNotes = (project: Project): ExtractedNote[] => notesOf(project).notes.filter((n) => statusOf(project, n) === 'sorted');

/** The cards that built a node on the graph, and the layer each went to ("built from 3 notes"). */
export const builtFrom = (project: Project, targetId: string): { note: ExtractedNote; layer?: Layer }[] =>
  notesOf(project).notes.flatMap((note) =>
    livePlacements(project, note)
      .filter((p) => p.targetId === targetId || (p.objectId === targetId && (p.target === 'spine' || p.target === 'playerLane')))
      .map((p) => ({ note, ...(p.layer ? { layer: p.layer } : {}) })),
  );

/** The cards an object came from (its lineage, for the Bible). */
export const notesBehind = (project: Project, objectId: string): ExtractedNote[] =>
  notesOf(project).notes.filter((n) => n.destinations.some((d) => d.objectId === objectId));

/** Nodes a note's object can go after on a track, for the drop menus. */
export const trackNodes = (project: Project, laneId: string) =>
  laneSequence(project, laneId).map((id) => ({ id, object: project.objects[id]!, w: nodeSize(project.objects[id]!.type).w }));
