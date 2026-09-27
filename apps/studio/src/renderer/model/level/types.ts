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
export type ProxyShape = 'room' | 'box' | 'cylinder' | 'sphere' | 'wedge' | 'plane' | 'stairs' | 'marker' | 'none';

/** What the item is for, as gameplay and the exporters see it. */
export type AssetRole =
  | 'room' | 'corridor' | 'stairwell' | 'zone' | 'arena' | 'platform'
  | 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'stairs' | 'ramp' | 'ladder' | 'elevator' | 'railing'
  | 'primitive' | 'prop'
  | 'light'
  | 'pickup' | 'inventory' | 'weapon' | 'ammo' | 'health' | 'checkpoint' | 'objective' | 'cover'
  | 'playerStart' | 'npc' | 'companion' | 'enemy' | 'neutral' | 'patrolNode'
  | 'trigger' | 'gate' | 'prerequisite' | 'interaction' | 'puzzle' | 'hazard' | 'damage'
  | 'camera' | 'cinematic' | 'audio' | 'ambient' | 'dialogue'
  | 'spawn'
  | 'waypoint' | 'patrolPath' | 'traversal' | 'portal' | 'destination'
  | 'assembly';

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
  | { kind: 'goToLevel'; target: string };

export interface LevelRule {
  id: string;
  on: LevelEvent;
  /** For 'timer': seconds. For 'custom': the event's name. */
  detail?: string;
  when?: Rule;
  effects?: Effect[];
  actions?: LevelAction[];
}

/** A door or window's place in a space's wall: which wall (0 north, 1 east, 2 south, 3 west) and where along it (0–1). */
export interface HostRef {
  id: string;
  wall: 0 | 1 | 2 | 3;
  along: number;
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
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Story elements it stands for or belongs to: scenes, locations, characters, items, plot points (spec §7). */
  links?: string[];
  /** Present in the level only while this holds (choices and state gates, spec §7.1). */
  activeWhen?: Rule;
  rules?: LevelRule[];
  /** Why a regeneration left it out of place (spec §5.3): flagged, never deleted. */
  invalid?: string;
  notes?: string;
}

export interface Floor {
  id: string;
  name: string;
  /** Height of this floor's ground above the level's origin. */
  elevation: number;
  height: number;
}

export interface Level {
  id: string;
  name: string;
  serial: number;
  floors: Floor[];
  /** Plot points and scenes the level as a whole belongs to. */
  links?: string[];
  notes?: string;
}

export interface LevelSettings {
  units: 'm' | 'ft';
  /** Snap step, in metres. */
  grid: number;
  snap: boolean;
  /** {TYPE}, {Context}, {Name} and {###} (the serial, three digits). */
  template: string;
  prefixes: Record<NamingClass, string>;
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

export interface LevelSet {
  settings: LevelSettings;
  levels: Level[];
  items: LevelItem[];
  /** Project assets (spec §4.4). */
  assets: AssetDefinition[];
  /** The next serial for each naming class. */
  counters: Partial<Record<NamingClass, number>>;
  manifest?: ManifestEntry[];
}
