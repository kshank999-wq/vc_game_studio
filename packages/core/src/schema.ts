/**
 * Canonical VC Writer project model.
 *
 * This is the single source of truth shared by VC Writer and VC Game Studio.
 * It is deliberately engine-neutral: nothing here names a Godot, Unity or
 * Unreal construct. Engine-specific data lives in `ImplementationBinding`s
 * (see handoff.ts), stored beside the project rather than inside it.
 *
 * Rules that every part of the model follows:
 * - Every entity has a stable, opaque `id`. References always use ids, never
 *   display names, so renaming never breaks anything.
 * - Conditions are expression strings (see expr.ts) such as
 *   `has(itm_lantern) and rel(rel_mara) >= 2`.
 * - State changes are `Mutation`s, applied atomically and logged with the id
 *   of the node that caused them.
 */

export type Id = string;

/** Expression source text, evaluated against runtime state. */
export type ExprSource = string;

export type Value = boolean | number | string | null;

/** Designer-defined extra properties, available on every entity. */
export type CustomProps = Record<string, unknown>;

export interface Entity {
  id: Id;
  name: string;
  description?: string;
  tags?: string[];
  custom?: CustomProps;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type GameType =
  | "linear"
  | "branching"
  | "rpg"
  | "action-adventure"
  | "fps"
  | "puzzle"
  | "survival"
  | "hybrid"
  | "custom";

export type ProgressionModel =
  | "levels"
  | "chapters"
  | "missions"
  | "quests"
  | "regions"
  | "acts"
  | "custom";

/** Answers captured by the Game Setup Wizard. */
export interface Premise {
  premise: string;
  playerFantasy?: string;
  playerRole?: string;
  world?: string;
  tone?: string;
  themes?: string[];
  endingStructure?: string;
  coreLoop?: string;
}

export interface GameProject extends Entity {
  gameType: GameType;
  progression: ProgressionModel;
  premise: Premise;
  bible: Bible;
  variables: VariableDef[];
  spine: Milestone[];
  levels: Level[];
  scenes: Scene[];
  cinematics: Cinematic[];
  endings: Ending[];
  start: { scene: Id };
}

// ---------------------------------------------------------------------------
// Variables and state
// ---------------------------------------------------------------------------

export type VariableType = "bool" | "int" | "float" | "string" | "enum";

export type VariableScope =
  | "global"
  | "level"
  | "scene"
  | "quest"
  | "character"
  | "object"
  | "temp";

export interface VariableDef extends Entity {
  type: VariableType;
  scope: VariableScope;
  initial: Value;
  /** Allowed values for `enum` variables. */
  values?: string[];
  min?: number;
  max?: number;
}

export type ObjectiveStatus = "inactive" | "active" | "done" | "failed";
export type PuzzleStatus = "unsolved" | "solved" | "failed";

export type Mutation =
  | { op: "set"; var: Id; value: ExprSource }
  | { op: "add"; var: Id; amount: number }
  | { op: "give"; item: Id; qty?: number }
  | { op: "take"; item: Id; qty?: number }
  | { op: "relationship"; relationship: Id; delta: number }
  | { op: "objective"; objective: Id; status: ObjectiveStatus }
  | { op: "puzzle"; puzzle: Id; status: PuzzleStatus }
  | { op: "object"; object: Id; state: string }
  /** A named hook for Game Studio to implement (sound, VFX, spawn, ...). */
  | { op: "event"; name: string; params?: CustomProps };

// ---------------------------------------------------------------------------
// Game Bible
// ---------------------------------------------------------------------------

export interface Bible {
  characters: Character[];
  factions: Faction[];
  relationships: Relationship[];
  locations: Location[];
  items: Item[];
  abilities: Ability[];
  objects: SmartObject[];
  puzzles: Puzzle[];
  quests: Quest[];
  lore: LoreEntry[];
}

export type CharacterRole = "player" | "npc" | "companion" | "antagonist";

export interface Character extends Entity {
  role: CharacterRole;
  faction?: Id;
  traits?: string[];
  goals?: string[];
  secrets?: string[];
  voice?: string;
  arc?: string;
}

export interface Faction extends Entity {}

/** A tracked numeric relationship between two characters. */
export interface Relationship extends Entity {
  from: Id;
  to: Id;
  initial: number;
  min?: number;
  max?: number;
}

export type LocationKind =
  | "world"
  | "region"
  | "level"
  | "zone"
  | "room"
  | "custom";

export interface Location extends Entity {
  kind: LocationKind;
  parent?: Id;
  /**
   * Environmental mechanics as authored intent, e.g.
   * `{ kind: "darkness", params: { visibility: 2 } }`. VC Writer stores the
   * intent and parameters; Game Studio implements the physical mechanics.
   */
  mechanics?: EnvironmentMechanic[];
}

export type MechanicKind =
  | "darkness"
  | "traversal"
  | "hazard"
  | "visibility"
  | "water"
  | "audio-cue"
  | "resource-drain"
  | "custom";

export interface EnvironmentMechanic {
  kind: MechanicKind;
  /** Free-form subtype, e.g. "crawl", "collapse", "rising-water". */
  variant?: string;
  params?: CustomProps;
  notes?: string;
}

export type ItemCategory =
  | "weapon"
  | "ammo"
  | "resource"
  | "key"
  | "quest"
  | "consumable"
  | "crafting"
  | "collectible"
  | "custom";

export interface Item extends Entity {
  category: ItemCategory;
  stackable?: boolean;
  maxStack?: number;
  persistent?: boolean;
  equippable?: boolean;
  consumable?: boolean;
  /** Weapon/resource stats, upgrade paths, etc. */
  stats?: CustomProps;
}

export interface Ability extends Entity {
  permanent?: boolean;
  durationSeconds?: number;
  cooldownSeconds?: number;
  prerequisite?: ExprSource;
}

/** An interactive environmental point ("smart object"). */
export interface SmartObject extends Entity {
  states: string[];
  initial: string;
  verbs: Verb[];
}

export interface Verb {
  id: Id;
  name: string;
  availableWhen?: ExprSource;
  effects?: Mutation[];
  /** Presentation notes: animation, audio, VFX. */
  feedback?: string;
}

export interface Puzzle extends Entity {
  objective?: string;
  components?: { id: Id; name: string; notes?: string }[];
  /** Condition that marks the puzzle solved when checked. */
  solution?: ExprSource;
  hints?: string[];
  resetOnFail?: boolean;
  onSolve?: Mutation[];
  onFail?: Mutation[];
}

export interface Quest extends Entity {}

export interface LoreEntry extends Entity {
  body?: string;
}

// ---------------------------------------------------------------------------
// Structure: spine, levels, scenes, beats
// ---------------------------------------------------------------------------

/** A milestone on the mandatory narrative spine. */
export interface Milestone extends Entity {
  /** Scene or beat whose entry marks this milestone reached. */
  anchor: Id;
  /** Required milestones must lie on every path from start to an ending. */
  required: boolean;
}

export interface Level extends Entity {
  kind: ProgressionModel | "level" | "chapter";
  scenes: Id[];
}

export interface Ending extends Entity {
  kind?: "good" | "bad" | "neutral" | "custom";
  /** Game-over endings may bypass required spine milestones. */
  failure?: boolean;
}

export type Target = { beat: Id } | { scene: Id } | { end: Id };

export interface Transition {
  to: Target;
  /** First transition whose condition holds is taken. */
  when?: ExprSource;
}

export interface Scene extends Entity {
  level?: Id;
  location?: Id;
  entry: Id;
  narrative: NarrativeLayer;
  behavioral: BehavioralLayer;
  systemic: SystemicLayer;
  presentation: PresentationLayer;
  /** Nodes in the scene element graph. */
  elements: SceneElement[];
  beats: Beat[];
}

/** Layer 1 — narrative / context. */
export interface NarrativeLayer {
  purpose: string;
  time?: string;
  participants?: Id[];
  prerequisites?: ExprSource;
  expectedOutcome?: string;
}

/** Layer 2 — behavioral. */
export interface BehavioralLayer {
  notes: BehaviorNote[];
}

export interface BehaviorNote {
  id: Id;
  actor: Id;
  kind:
    | "idle"
    | "patrol"
    | "follow"
    | "combat"
    | "flee"
    | "assist"
    | "react"
    | "scripted"
    | "custom";
  description: string;
  when?: ExprSource;
}

/** Layer 3 — systemic. */
export interface SystemicLayer {
  onEnter?: Mutation[];
  objectives: Objective[];
  triggers: Trigger[];
  /** Condition for the scene to count as complete. */
  completion?: ExprSource;
}

export interface Objective {
  id: Id;
  name: string;
  mandatory: boolean;
}

export type TriggerKind =
  | "proximity"
  | "overlap"
  | "line-of-sight"
  | "interact"
  | "timer"
  | "state-change"
  | "dialogue-result"
  | "inventory"
  | "combat"
  | "custom";

export interface Trigger {
  id: Id;
  name: string;
  kind: TriggerKind;
  when?: ExprSource;
  effects?: Mutation[];
  once?: boolean;
}

/** Layer 4 — presentation. */
export interface PresentationLayer {
  music?: string;
  ambience?: string;
  camera?: string;
  atmosphere?: string;
  notes?: string;
}

export type SceneElementKind =
  | "player"
  | "npc"
  | "companion"
  | "item"
  | "object"
  | "puzzle"
  | "trigger"
  | "cinematic"
  | "exit"
  | "objective"
  | "environment"
  | "custom";

export interface SceneElement {
  id: Id;
  kind: SceneElementKind;
  /** The Bible entity (or scene trigger/objective) this element stands for. */
  ref?: Id;
  notes?: string;
}

export type BeatKind =
  | "dialogue"
  | "objective"
  | "discovery"
  | "interaction"
  | "puzzle"
  | "combat"
  | "acquisition"
  | "cinematic"
  | "choice"
  | "custom";

export interface Beat {
  id: Id;
  name: string;
  kind: BeatKind;
  /** "spine" beats are story progression; "player" beats are the Player Lane. */
  lane: "spine" | "player";
  lines?: DialogueLine[];
  onEnter?: Mutation[];
  choices?: Choice[];
  next?: Transition[];
  cinematic?: Id;
  puzzle?: Id;
  notes?: string;
}

export interface DialogueLine {
  speaker: Id;
  text: string;
  direction?: string;
}

export interface Choice {
  id: Id;
  text: string;
  availableWhen?: ExprSource;
  /** What to show when unavailable: hide it, or show it disabled. */
  whenUnavailable?: "hide" | "disable";
  frequency?: "once" | "repeatable";
  /** Choices sharing a group are mutually exclusive across the project. */
  exclusiveGroup?: string;
  timed?: { seconds: number };
  effects?: Mutation[];
  to: Target;
}

// ---------------------------------------------------------------------------
// Cinematics
// ---------------------------------------------------------------------------

export interface Cinematic extends Entity {
  participants?: Id[];
  skippable: boolean;
  interactive?: boolean;
  staging?: string;
  shots: Shot[];
  onComplete?: Mutation[];
}

export interface Shot {
  id: Id;
  camera?: string;
  action?: string;
  lines?: DialogueLine[];
  audio?: string;
  durationSeconds?: number;
}
