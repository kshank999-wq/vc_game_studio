import type { Effect, Rule } from '../rules';
import type { ObjectType } from '../types';

/**
 * The Level Designer's model (docs/specs/level-designer-spec.md §13). The 2D
 * map, the 3D graybox, the inspector and the outliner all read these records;
 * none of them keeps a copy. Lengths are metres, angles degrees. A plan
 * position (x, y) is the item's centre seen from above: x east, y south. In 3D
 * that is (x, z), with y up.
 */

export type AssetCategory =
  | 'world'
  | 'settlement'
  | 'spaces'
  | 'architecture'
  | 'primitives'
  | 'props'
  | 'lighting'
  | 'gameplay'
  | 'actors'
  | 'logic'
  | 'presentation'
  | 'spawning'
  | 'navigation'
  | 'custom';

/**
 * How an asset behaves on the map. A space has walls, floor and ceiling and
 * hosts doors and windows; a hosted asset sits in a space's wall; a solid is a
 * piece of geometry; a volume is an invisible box that notices things; a
 * marker is a point with a facing.
 */
export type AssetKind = 'space' | 'hosted' | 'solid' | 'light' | 'volume' | 'marker' | 'assembly';

/** The shape the proxy takes in 3D (and its outline in 2D). */
export type ProxyShape = 'room' | 'box' | 'cylinder' | 'sphere' | 'wedge' | 'plane' | 'stairs' | 'marker' | 'model' | 'none';

/** What the item is for, as gameplay and the exporters see it. */
export type AssetRole =
  | 'room' | 'corridor' | 'stairwell' | 'zone' | 'arena' | 'platform'
  | 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'stairs' | 'ramp' | 'ladder' | 'elevator' | 'railing'
  | 'primitive' | 'prop'
  | 'light'
  | 'pickup' | 'inventory' | 'weapon' | 'ammo' | 'health' | 'checkpoint' | 'objective' | 'cover'
  | 'playerStart' | 'npc' | 'companion' | 'enemy' | 'neutral' | 'patrolNode'
  | 'trigger' | 'gate' | 'prerequisite' | 'interaction' | 'puzzle' | 'hazard' | 'damage' | 'darkness'
  | 'camera' | 'cinematic' | 'audio' | 'ambient' | 'dialogue'
  | 'spawn'
  | 'waypoint' | 'patrolPath' | 'traversal' | 'portal' | 'destination'
  | 'assembly'
  /** World and town scale (spec V2 §7): planning shapes, exported as data. */
  | 'region' | 'biome' | 'streaming' | 'landmark' | 'road' | 'block' | 'building' | 'terrain' | 'vegetation';

/** The inspector's sections (spec §6), in the order they appear. */
export type PropertyGroup =
  | 'identity'
  | 'transform'
  | 'dimensions'
  | 'appearance'
  | 'physics'
  | 'interaction'
  | 'gameplay'
  | 'logic'
  | 'narrative'
  | 'spawn'
  | 'presentation'
  | 'engine';

export type ParamValue = number | boolean | string;

/** One editable property an asset defines, with its default. Instances store only what they change. */
export interface ParamDef {
  key: string;
  label: string;
  group: PropertyGroup;
  type: 'number' | 'boolean' | 'text' | 'select' | 'ref';
  default: ParamValue;
  /** A length is shown in the project's units; the value is always metres. */
  unit?: 'length' | 'deg' | 's' | 'count' | 'percent';
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  /** For a 'ref': the story elements it may point at (an NPC's character, a pickup's inventory item). */
  refTypes?: readonly ObjectType[];
  hint?: string;
  /** Kept out of the first view of its section until "More" is opened (spec §15). */
  advanced?: boolean;
}

export interface Size {
  /** Along x (east–west). */
  w: number;
  /** Along y on the plan (north–south): depth. */
  d: number;
  /** Up. */
  h: number;
}

/** Where each engine's exporter puts it (spec §11.2). Hints, not code. */
export interface EngineMapping {
  godot: string;
  unity: string;
  unreal: string;
}

/** One piece of a saved assembly, relative to the assembly's centre. */
export interface AssemblyPart {
  assetId: string;
  name: string;
  dx: number;
  dy: number;
  dz: number;
  rotation: number;
  size?: Partial<Size>;
  params?: Record<string, ParamValue>;
  outline?: OutlinePoint[];
}

/** A library template (spec §4.3): the defaults every placed instance inherits. */
export interface AssetDefinition {
  id: string;
  name: string;
  category: AssetCategory;
  kind: AssetKind;
  role: AssetRole;
  /** The naming class (spec §10.2): which prefix its export names start with. */
  naming: NamingClass;
  size: Size;
  proxy: ProxyShape;
  params: ParamDef[];
  engine: EngineMapping;
  description: string;
  /** Starter assets ship with the studio; project assets live in the project; global ones in this computer's library. */
  source: 'starter' | 'project' | 'global';
  /** Bumped whenever the definition changes, so instances can say which version they came from. */
  version: number;
  parts?: AssemblyPart[];
  /** A space's shape when it isn't a rectangle (an irregular room). */
  outline?: OutlinePoint[];
  /**
   * What earlier versions gave their instances (spec §4.4): so an item placed
   * from one can be shown what changed since and keep what it had.
   */
  history?: AssetSnapshot[];
  /** An imported proxy model (spec V2 §10): its shape, where it came from, and how it was scaled. */
  model?: ModelInfo;
  tags?: string[];
}

/** The units a model file was made in (spec V2 §10): converted to metres on import. */
export type ModelUnits = 'm' | 'cm' | 'mm' | 'in' | 'ft';

/**
 * A personal proxy model (spec V2 §10). The studio keeps a light copy of its
 * shape (up to a few thousand triangles, fitted to the asset's box) to draw in
 * 3D; the engines get the box, and the file name to put the real model in.
 */
export interface ModelInfo {
  file: string;
  format: 'obj' | 'gltf' | 'glb';
  units: ModelUnits;
  /** A further scale on top of the unit conversion. */
  scale: number;
  upAxis: 'y' | 'z';
  /** Where the engine's copy is anchored: its base's centre, its middle, or the file's own origin. */
  pivot: 'base' | 'centre' | 'origin';
  /** The file's origin, from the base's centre, in metres (x east, y up, z south). */
  origin: { x: number; y: number; z: number };
  vertices: number;
  triangles: number;
  /** How many triangles the studio's copy keeps. */
  kept: number;
  /** The kept triangles' corners, fitted to a unit box and packed as base64 16-bit integers. */
  mesh: string;
  /** Pictures made on import: a three-quarter view, and the plan seen from above. */
  thumbnail?: string;
  plan?: string;
}
/** A definition's defaults as they were at one version. */
export interface AssetSnapshot {
  version: number;
  size: Size;
  defaults: Record<string, ParamValue>;
  outline?: OutlinePoint[];
}

/** The classes export names are prefixed by (spec §10.2); the prefixes themselves are project settings. */
export type NamingClass =
  | 'level'
  | 'room'
  | 'architecture'
  | 'prop'
  | 'light'
  | 'interactive'
  | 'inventory'
  | 'spawn'
  | 'trigger'
  | 'npc'
  | 'player'
  | 'camera'
  | 'audio'
  | 'navigation'
  | 'logic';

/** When a level item's rule runs (spec §8.2). */
export type LevelEvent = 'enter' | 'exit' | 'interact' | 'pickup' | 'use' | 'destroy' | 'timer' | 'stateChange' | 'custom';

/** What a rule does to the level itself; story state changes are the shared effects. */
export type LevelAction =
  | { kind: 'open'; target: string }
  | { kind: 'close'; target: string }
  | { kind: 'enable'; target: string }
  | { kind: 'disable'; target: string }
  | { kind: 'spawn'; target: string }
  | { kind: 'despawn'; target: string }
  | { kind: 'startScene'; target: string }
  | { kind: 'playCinematic'; target: string }
  | { kind: 'playAudio'; target: string }
  | { kind: 'objective'; target: string }
  | { kind: 'goToLevel'; target: string }
  /** Refill the light of a player start (target) to full. */
  | { kind: 'refuel'; target: string };

export interface LevelRule {
  id: string;
  on: LevelEvent;
  /** For 'timer': seconds. For 'custom': the event's name. */
  detail?: string;
  when?: Rule;
  effects?: Effect[];
  actions?: LevelAction[];
}

/**
 * A door or window's place in a space's wall, and where along it (0–1). A
 * rectangular space's walls are 0 north, 1 east, 2 south, 3 west; an outlined
 * space's wall n runs from its corner n to the next.
 */
export interface HostRef {
  id: string;
  wall: number;
  along: number;
}

/** A corner of a space's outline, in its own frame as a fraction of its width (x) and depth (y): −0.5 to 0.5. */
export interface OutlinePoint {
  x: number;
  y: number;
}

/** A placed asset (spec §4.3, "Asset Instance"). */
export interface LevelItem {
  /** Immutable. References, the manifest and the engines all use it; names can change freely. */
  id: string;
  levelId: string;
  floorId: string;
  assetId: string;
  /** The definition's version when it was placed or last reset. */
  assetVersion: number;
  name: string;
  /** Fixed at creation and never reused, so export names stay put when other items go. */
  serial: number;
  /** Replaces the generated export name. */
  exportName?: string;
  tags?: string[];
  x: number;
  y: number;
  /** Height above its floor. */
  z: number;
  rotation: number;
  /** What differs from the definition's size. */
  size?: Partial<Size>;
  /** What differs from the definition's parameters. */
  params?: Record<string, ParamValue>;
  host?: HostRef;
  /**
   * A space drawn freeform (spec §3.1): its corners, clockwise seen from
   * above. Without one a space is the rectangle of its size (or its
   * definition's outline).
   */
  outline?: OutlinePoint[];
  /**
   * The point it turns about and grows from (spec §5.1), in its own frame as
   * a fraction of its width and depth; its centre when absent. For editing
   * only: engines still get the item's centre.
   */
  pivot?: OutlinePoint;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Story elements it stands for or belongs to: scenes, locations, characters, items, plot points (spec §7). */
  links?: string[];
  /** Present in the level only while this holds (choices and state gates, spec §7.1). */
  activeWhen?: Rule;
  rules?: LevelRule[];
  /** The parts it plays in puzzles (spec V2 §14): an entry, a required object, a clue, a gate, an output. */
  puzzles?: PuzzleBinding[];
  /** Why a regeneration left it out of place (spec §5.3): flagged, never deleted. */
  invalid?: string;
  notes?: string;
}

/** What an item is to a puzzle (spec V2 §14). */
export type PuzzleRole = 'entry' | 'required' | 'clue' | 'gate' | 'output';

/**
 * An item bound to a puzzle (spec V2 §14). The puzzle's logic stays in the
 * puzzle: binding only points the item at it (and, for a step, at the story
 * element the step is about), so nothing is written twice.
 */
export interface PuzzleBinding {
  puzzle: string;
  role: PuzzleRole;
  /** The step it is: a story element the puzzle's rule needs (an object, an item, a trigger), or for a clue the lore it reveals. */
  node?: string;
}

export interface Floor {
  id: string;
  name: string;
  /** Height of this floor's ground above the level's origin. */
  elevation: number;
  height: number;
}

/**
 * What a map is at its scale (spec V2 §4): World › Region › Level › District ›
 * Building › Interior. The hierarchy is the designer's, not a rule: a city can
 * be a Level, a Level can sit straight in a World, a map can have no parent.
 */
export type MapKind = 'world' | 'region' | 'level' | 'district' | 'building' | 'interior';

/** How the game reaches a map (spec V2 §13). */
export type MapBoundary = 'continuous' | 'streamed' | 'instanced' | 'transition' | 'mapOnly';

/** How far along a map is (spec V2 §6); worked out from what is in it unless set. */
export type MapStatus = 'empty' | 'grayboxed' | 'detailed' | 'gameplay' | 'final';

export interface Level {
  id: string;
  name: string;
  serial: number;
  floors: Floor[];
  /** Plot points and scenes the level as a whole belongs to. */
  links?: string[];
  notes?: string;
  /** What it is at its scale; a level when absent. */
  kind?: MapKind;
  /** The map it is part of (spec V2 §4), if any. */
  parentId?: string;
  /**
   * The item on the parent map it details (spec V2 §16, ChildMapLink): a
   * region's zone on the world, a building's mass in a city. Its size is the
   * map's size unless the map sets its own, so scale stays the same at every depth.
   */
  anchorId?: string;
  /** The map's extent in metres (spec V2 §3), when it has one of its own. */
  width?: number;
  depth?: number;
  /** Where the map's own 0, 0 is, from its centre (spec V2 §12): so detail isn't drawn at huge coordinates. */
  origin?: { x: number; y: number };
  /** Its own snap step, in metres (a world's is kilometres, a room's centimetres). */
  grid?: number;
  boundary?: MapBoundary;
  /** Set by hand; otherwise worked out (statusOf). */
  status?: MapStatus;
  favorite?: boolean;
  /** Kept out of the navigator's view and the parent map. */
  hidden?: boolean;
  /** Its items can't be moved or changed. */
  locked?: boolean;
  /** For the engines (spec V2 §11): an environment profile and navigation settings, as words. */
  environment?: string;
  navigation?: string;
  /** Images traced over (spec V2 §10): an old map, a floor plan, a heightmap, a photo. */
  references?: ReferenceImage[];
}

export type ReferenceKind = 'map' | 'floorPlan' | 'heightmap' | 'photo';

/**
 * A picture laid under a map to trace (spec V2 §10). It is placed and scaled
 * in metres like everything else, so what is drawn over it has the right size.
 * Never exported.
 */
export interface ReferenceImage {
  id: string;
  name: string;
  kind: ReferenceKind;
  /** The picture, as a data URL. */
  image: string;
  /** Its size in pixels, for metres per pixel. */
  pixels: { w: number; h: number };
  /** Only on this floor; on every floor when absent. */
  floorId?: string;
  /** Its centre on the plan, and how wide it is, in metres. */
  x: number;
  y: number;
  width: number;
  rotation: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
}
export interface LevelSettings {
  units: 'm' | 'ft';
  /** Snap step, in metres. */
  grid: number;
  snap: boolean;
  /** {TYPE}, {Context}, {Name} and {###} (the serial, three digits). */
  template: string;
  prefixes: Record<NamingClass, string>;
  /** How Play Mode sees the level (spec §9.2). */
  perspective?: Perspective;
}

export type Perspective = 'first' | 'third' | 'top';

/** A story state to start testing from (spec §9.3): what is held, set, solved and seen. */
export interface PlayPreset {
  id: string;
  name: string;
  flags: Record<string, string>;
  items: Record<string, number>;
  objects: Record<string, string>;
  solved: Record<string, boolean>;
  visited: Record<string, boolean>;
  chosen: Record<string, string>;
  arcs: Record<string, number>;
}

/** Something noticed while playing, tied to the item responsible (spec §9.3). */
export interface PlayNote {
  id: string;
  levelId: string;
  itemId?: string;
  text: string;
  at: string;
  /** Where the player stood. */
  x: number;
  y: number;
  resolved?: boolean;
}

/** What the last export sent for one item (spec §11.3). */
export interface ManifestEntry {
  guid: string;
  exportName: string;
  source: string;
  engine: string;
  engineRef: string;
  revision: string;
  /** An artist's final art is in place: re-export keeps the mesh and materials. */
  replacementLocked?: boolean;
}

/** What a travel link is (spec V2 §5, §13): a way between places, drawn on the map. */
export type TravelKind = 'road' | 'trail' | 'river' | 'route' | 'progression' | 'fastTravel' | 'door' | 'elevator' | 'portal' | 'cinematic' | 'loading';

/** How the game takes the player along it. */
export type TravelTransition = 'walk' | 'ride' | 'sail' | 'fade' | 'cinematic' | 'loading' | 'instant';

/**
 * A travel link (spec V2 §16, TravelLink): a line on a map from one place to
 * another, through the points it passes. Its ends can be tied to items (a
 * destination, a town, a door), and then follow them; it can lead off this
 * map to another one (fast travel, a loading transition). Locked, it opens
 * when its rule holds.
 */
export interface TravelLink {
  id: string;
  levelId: string;
  floorId?: string;
  kind: TravelKind;
  name?: string;
  /** The items its ends are tied to. */
  from?: string;
  to?: string;
  /** A map elsewhere it takes the player to. */
  toMap?: string;
  /** Plan points from start to end; the ends are where the tied items are, when they are. */
  points: { x: number; y: number }[];
  oneWay?: boolean;
  /** Closed until its rule holds (or for good, without one). */
  locked?: boolean;
  unlockWhen?: Rule;
  transition?: TravelTransition;
  notes?: string;
}

export interface LevelSet {
  settings: LevelSettings;
  levels: Level[];
  items: LevelItem[];
  /** Project assets (spec §4.4). */
  assets: AssetDefinition[];
  /** The next serial for each naming class. */
  counters: Partial<Record<NamingClass, number>>;
  manifest?: ManifestEntry[];
  presets?: PlayPreset[];
  notes?: PlayNote[];
  /** Travel links (spec V2 §13): roads, rivers, routes and transitions between places. */
  travel?: TravelLink[];
}
