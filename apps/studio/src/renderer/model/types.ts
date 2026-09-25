/**
 * The project model (docs/ui/HANDOFF.md, "Data model"). Every view reads
 * these normalized records; none of them keeps its own copy.
 */

export type ObjectType =
  | 'begin'
  | 'end'
  | 'plotPoint'
  | 'scene'
  | 'cinematic'
  | 'choice'
  | 'dialogue'
  | 'character'
  | 'object'
  | 'environment'
  | 'inventory'
  | 'puzzle'
  | 'trigger'
  | 'gate'
  | 'state'
  | 'arcEvent';

export interface StoryObject {
  id: string;
  type: ObjectType;
  name: string;
  notes: string;
  /** ISO timestamps. */
  created: string;
  modified: string;
  /**
   * Type-specific fields. `code` is the short stable label shown on the graph
   * (PP1, SC-01, C1, CIN-01, SP1); it never changes once assigned.
   */
  data: {
    code?: string;
    summary?: string;
    /** A branch node that ends the game: an alternate ending, or game over. */
    outcome?: 'ending' | 'gameOver';
    /** An arc event: growth, setback, or a turning point. */
    polarity?: 'up' | 'down' | 'turn';
    [key: string]: unknown;
  };
}

export type LaneKind = 'spine' | 'subplot' | 'character';

/** Where a subplot runs, as two spine nodes. The spine has no span; it never ends. */
export interface LaneSpan {
  startRef: string;
  endRef: string;
}

export interface Lane {
  id: string;
  kind: LaneKind;
  name: string;
  subtitle: string;
  color: string;
  order: number;
  span?: LaneSpan;
  visible: boolean;
  locked: boolean;
  /** A character lane follows one canonical character object. */
  characterId?: string;
}

export type ConnectionKind = 'spine' | 'branch' | 'contains' | 'references' | 'arcEvent' | 'laneTie' | 'gate';

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ConnectionKind;
  /** The option text shown on the connector's pill (a choice's options). */
  label?: string;
  conditions?: unknown;
  routing?: unknown;
}

/**
 * Where a node sits on the graph. A node on a track has a lane and an x; its
 * order along that track is its narrative order. Off-track nodes (branches,
 * build step 4) have no lane and use y as well.
 */
export interface Placement {
  laneId: string | null;
  x: number;
  y: number;
}

/**
 * One block of a scene's script (HANDOFF: DialogueLine). A dialogue line has
 * a speaker, a canonical character; an action line is stage direction for the
 * scene and has none.
 */
export interface DialogueLine {
  id: string;
  sceneId: string;
  kind: 'dialogue' | 'action';
  speakerId: string | null;
  text: string;
  /** A parenthetical: (listening), (wading forward). */
  direction: string;
  order: number;
  conditions?: unknown;
  choiceId?: string;
  vo: 'none' | 'todo' | 'recorded';
  notes: string;
}

export interface Project {
  format: 'vcgs';
  version: 1;
  id: string;
  name: string;
  objects: Record<string, StoryObject>;
  lanes: Lane[];
  connections: Connection[];
  placements: Record<string, Placement>;
  /** Every scene's script, one record per block. */
  lines: DialogueLine[];
}
