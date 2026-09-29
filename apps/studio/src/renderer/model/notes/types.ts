import type { ObjectType } from '../types';

/**
 * The Note Sorter (Note Sorter spec, HANDOFF "Data model"): raw notes come in
 * as source documents that never change; passages dragged out of them become
 * note cards that point back to the exact words; a card can become one or
 * more game objects, and those can be placed in the game.
 *
 * The engine is the shared Writer model — sources, source-linked notes,
 * nested categories — and Game Studio only extends a note with where it
 * went in the game (spec §3, §18). Nothing here is a copy of a game object:
 * a note refers to objects by id, and an object deleted downstream simply
 * stops counting, so its note falls back to "converted" or "sorted".
 */

/** Stable offsets into a source's content, which never changes. */
export interface Range {
  start: number;
  end: number;
}

export interface SourceDocument {
  id: string;
  name: string;
  importedAt: string;
  /** Immutable: edits to a note never reach it (spec §3, §6). */
  content: string;
  /** Short name for references, as in "memo ¶3". */
  short: string;
}

export type NoteStatus = 'unsorted' | 'sorted' | 'converted' | 'placed' | 'setAside';

/** Spec §13's relationships between cards and objects. */
export const VERBS = ['requires', 'unlocks', 'blocks', 'causes', 'modifies', 'rewards', 'precedes', 'follows', 'appears in', 'belongs to', 'conflicts with'] as const;
export type Verb = (typeof VERBS)[number];

/** What a card became: a game object, or a dialogue block waiting for its scene (objectId empty until placed). */
export interface Destination {
  objectType: ObjectType;
  objectId: string;
  /** A dialogue block's speaker, as written ("Samira"). */
  speaker?: string;
}

/** The four layers of a scene (spec §10). */
export const LAYERS = ['narrative', 'behavior', 'systemic', 'presentation'] as const;
export type Layer = (typeof LAYERS)[number];

export type FlowTarget = 'spine' | 'playerLane' | 'sceneLayer' | 'level' | 'bible' | 'system';

/** Where a card's object sits in the game. */
export interface FlowPlacement {
  target: FlowTarget;
  /** The scene, level, lane, or Bible/system section key. */
  targetId: string;
  layer?: Layer;
  /** The object placed (one card may have become several). */
  objectId: string;
}

export interface ExtractedNote {
  id: string;
  sourceId: string;
  range: Range;
  /** Passages merged into this card, from any source. */
  merged?: { sourceId: string; range: Range }[];
  /** An editable copy: changing it never touches the source. */
  text: string;
  /** A name for what it may become ("Tether"). */
  name?: string;
  categoryId: string | null;
  order: number;
  setAside?: boolean;
  created: string;
  // The game extension (spec §18).
  destinations: Destination[];
  dependencies: { verb: Verb; targetId: string }[];
  flowPlacements: FlowPlacement[];
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  /** Which template category it came from, which suggests what its cards become. */
  templateKey?: string;
  order: number;
}

export type SuggestionKind = 'duplicate' | 'category' | 'destination' | 'entity';

/** A suggestion as offered; nothing changes until it is accepted (spec §16). */
export interface Suggestion {
  /** Stable, from what it is about: a dismissed suggestion stays dismissed. */
  id: string;
  kind: SuggestionKind;
  text: string;
  payload: Record<string, string | string[]>;
}

export interface NoteSet {
  sources: SourceDocument[];
  notes: ExtractedNote[];
  categories: Category[];
  /** Accepted or dismissed suggestions, by id. Pending ones are worked out afresh. */
  suggestions: Record<string, 'accepted' | 'dismissed'>;
  suggestionsOn: boolean;
  /** The last template loaded, for the picker. */
  template?: string;
}
