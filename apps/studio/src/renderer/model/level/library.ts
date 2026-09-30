import type { AssetCategory, AssetDefinition, AssetKind, AssetRole, EngineMapping, NamingClass, OutlinePoint, ParamDef, ProxyShape, Size } from './types';

/**
 * The starter library (spec §4.2): templates for every category, each with a
 * 2D outline, a 3D proxy, its parameters and where the engines put it. Placed
 * items inherit all of it and store only what they change.
 */

export const CATEGORIES: readonly { id: AssetCategory; label: string }[] = [
  { id: 'spaces', label: 'Spaces' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'primitives', label: 'Primitives' },
  { id: 'props', label: 'Furniture + props' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'actors', label: 'Actors' },
  { id: 'logic', label: 'Logic' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'spawning', label: 'Spawning' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'custom', label: 'Project assets' },
];

// ---------------------------------------------------------------- shared parameter sets

const appearance: ParamDef[] = [
  { key: 'visible', label: 'Visible in game', group: 'appearance', type: 'boolean', default: true },
  { key: 'material', label: 'Proxy material', group: 'appearance', type: 'select', default: 'neutral', options: ['neutral', 'stone', 'wood', 'metal', 'glass', 'water', 'emissive'] },
  { key: 'finalAsset', label: 'Final asset', group: 'appearance', type: 'text', default: '', hint: 'The mesh or prefab that replaces this proxy in the engine.', advanced: true },
];

const physics = (collision: 'static' | 'dynamic' | 'none' = 'static'): ParamDef[] => [
  { key: 'collision', label: 'Collision', group: 'physics', type: 'select', default: collision, options: ['static', 'dynamic', 'trigger', 'none'] },
  { key: 'mass', label: 'Mass (kg)', group: 'physics', type: 'number', default: 20, min: 0, step: 1, advanced: true },
  { key: 'gravity', label: 'Gravity', group: 'physics', type: 'boolean', default: collision === 'dynamic', advanced: true },
];

const interaction = (on = false, prompt = 'Use'): ParamDef[] => [
  { key: 'interactive', label: 'Interactive', group: 'interaction', type: 'boolean', default: on },
  { key: 'prompt', label: 'Prompt', group: 'interaction', type: 'text', default: prompt },
  { key: 'range', label: 'Interaction range', group: 'interaction', type: 'number', unit: 'length', default: 1.5, min: 0, step: 0.25 },
  { key: 'movable', label: 'Movable', group: 'interaction', type: 'boolean', default: false, advanced: true },
  { key: 'collectible', label: 'Collectible', group: 'interaction', type: 'boolean', default: false, advanced: true },
  { key: 'destructible', label: 'Destructible', group: 'interaction', type: 'boolean', default: false, advanced: true },
  { key: 'locked', label: 'Locked', group: 'interaction', type: 'boolean', default: false, advanced: true },
];

const engine: ParamDef[] = [
  { key: 'export', label: 'Include in export', group: 'engine', type: 'boolean', default: true },
  { key: 'replacementLocked', label: 'Final art locked', group: 'engine', type: 'boolean', default: false, hint: 'Re-export updates logic and layout but keeps the mesh and materials an artist put in.' },
  { key: 'template', label: 'Class / prefab / Blueprint', group: 'engine', type: 'text', default: '', hint: 'Leave empty to use the adapter’s mapping.', advanced: true },
];

const presentation = (audio = false): ParamDef[] =>
  audio
    ? [
        { key: 'sound', label: 'Sound', group: 'presentation', type: 'text', default: '' },
        { key: 'volume', label: 'Volume', group: 'presentation', type: 'number', unit: 'percent', default: 80, min: 0, max: 100, step: 5 },
        { key: 'radius', label: 'Radius', group: 'presentation', type: 'number', unit: 'length', default: 8, min: 0, step: 0.5 },
        { key: 'loop', label: 'Loops', group: 'presentation', type: 'boolean', default: true },
      ]
    : [];

const room = (walls = true, ceiling = true): ParamDef[] => [
  { key: 'walls', label: 'Walls', group: 'dimensions', type: 'boolean', default: walls },
  { key: 'wallThickness', label: 'Wall thickness', group: 'dimensions', type: 'number', unit: 'length', default: 0.2, min: 0.05, max: 2, step: 0.05 },
  { key: 'floorSlab', label: 'Floor', group: 'dimensions', type: 'boolean', default: true },
  { key: 'ceiling', label: 'Ceiling', group: 'dimensions', type: 'boolean', default: ceiling },
];

const light: ParamDef[] = [
  { key: 'color', label: 'Colour', group: 'presentation', type: 'text', default: '#ffd9a0' },
  { key: 'intensity', label: 'Intensity', group: 'presentation', type: 'number', default: 1, min: 0, max: 20, step: 0.1 },
  { key: 'range', label: 'Range', group: 'presentation', type: 'number', unit: 'length', default: 8, min: 0, step: 0.5 },
  { key: 'flicker', label: 'Flickers', group: 'presentation', type: 'boolean', default: false },
  { key: 'shadows', label: 'Casts shadows', group: 'presentation', type: 'boolean', default: true, advanced: true },
];

/** Walking a patrol (spec §11): the patrol nodes with this name, in their order, round and round. */
const patrol = (): ParamDef[] => [
  { key: 'patrol', label: 'Patrol', group: 'gameplay', type: 'text', default: '' },
  { key: 'speed', label: 'Speed (m/s)', group: 'gameplay', type: 'number', default: 1.4, min: 0.1, max: 12, step: 0.1 },
];
/** A companion keeping up with the player (spec §11). */
const follow = (): ParamDef[] => [
  { key: 'follow', label: 'Follows the player', group: 'gameplay', type: 'boolean', default: true },
  { key: 'distance', label: 'Follow distance', group: 'gameplay', type: 'number', unit: 'length', default: 2, min: 0.5, max: 20, step: 0.25 },
  { key: 'speed', label: 'Speed (m/s)', group: 'gameplay', type: 'number', default: 3.5, min: 0.1, max: 12, step: 0.1 },
];
const spawn = (actor: 'character' | 'inventory' = 'character'): ParamDef[] => [
  { key: 'actor', label: actor === 'character' ? 'Who' : 'What', group: 'spawn', type: 'ref', default: '', refTypes: actor === 'character' ? ['character'] : ['inventory', 'object'] },
  { key: 'count', label: 'Count', group: 'spawn', type: 'number', unit: 'count', default: 1, min: 1, max: 99, step: 1 },
  { key: 'wave', label: 'Wave', group: 'spawn', type: 'number', unit: 'count', default: 1, min: 1, step: 1 },
  { key: 'delay', label: 'Delay', group: 'spawn', type: 'number', unit: 's', default: 0, min: 0, step: 0.5 },
  { key: 'radius', label: 'Radius', group: 'spawn', type: 'number', unit: 'length', default: 1, min: 0, step: 0.25 },
  { key: 'respawn', label: 'Respawns', group: 'spawn', type: 'boolean', default: false },
];

// ---------------------------------------------------------------- the catalog

const E = (godot: string, unity: string, unreal: string): EngineMapping => ({ godot, unity, unreal });

interface Spec {
  id: string;
  name: string;
  kind: AssetKind;
  role: AssetRole;
  naming: NamingClass;
  size: [number, number, number];
  proxy: ProxyShape;
  params?: ParamDef[];
  engine: EngineMapping;
  description: string;
  outline?: OutlinePoint[];
}

const group = (category: AssetCategory, specs: Spec[]): AssetDefinition[] =>
  specs.map((s) => {
    const base: ParamDef[] =
      s.kind === 'space'
        ? [...appearance.filter((p) => p.key !== 'visible')]
        : s.kind === 'volume' || s.kind === 'marker'
          ? []
          : [...appearance, ...physics(s.kind === 'light' ? 'none' : 'static')];
    return {
      id: s.id,
      name: s.name,
      category,
      kind: s.kind,
      role: s.role,
      naming: s.naming,
      size: { w: s.size[0], d: s.size[1], h: s.size[2] } satisfies Size,
      proxy: s.proxy,
      params: dedupe([...(s.params ?? []), ...base, ...engine]),
      engine: s.engine,
      description: s.description,
      source: 'starter',
      version: 1,
      ...(s.outline ? { outline: s.outline } : {}),
    };
  });

/** The first parameter with a key wins: an asset's own come before the shared sets. */
const dedupe = (params: ParamDef[]): ParamDef[] => {
  const seen = new Set<string>();
  return params.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
};

const ROOM = E('Node3D with CSG walls', 'GameObject with wall meshes + colliders', 'Actor with wall StaticMeshComponents');
const HOSTED = E('CSGBox3D opening + StaticBody3D', 'Prefab in the wall + collider', 'Actor attached to the wall');
const SOLID = E('MeshInstance3D + StaticBody3D', 'GameObject + MeshRenderer + Collider', 'StaticMeshActor');
const PICKUP = E('Area3D + VCGSPlaceholder', 'GameObject + VcgsInteractable', 'Actor + UVcgsInteractableComponent');
const VOLUME = E('Area3D + CollisionShape3D', 'BoxCollider (trigger) + VcgsTrigger', 'ATriggerBox + VCGS component');
const MARKER = E('Marker3D', 'Empty GameObject', 'ATargetPoint');

export const STARTER: readonly AssetDefinition[] = [
  ...group('spaces', [
    { id: 'space.room', name: 'Room', kind: 'space', role: 'room', naming: 'room', size: [8, 6, 3], proxy: 'room', params: room(), engine: ROOM, description: 'Four walls, a floor and a ceiling. Doors and windows snap into its walls.' },
    {
      id: 'space.irregular', name: 'Irregular room', kind: 'space', role: 'room', naming: 'room', size: [10, 8, 3], proxy: 'room', params: room(), engine: ROOM,
      description: 'A room of any shape. Drag its corners; click a wall’s middle to add a corner.',
      outline: [{ x: -0.5, y: -0.5 }, { x: 0.1, y: -0.5 }, { x: 0.1, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }],
    },
    { id: 'space.hall', name: 'Hallway', kind: 'space', role: 'corridor', naming: 'room', size: [12, 2.5, 3], proxy: 'room', params: room(), engine: ROOM, description: 'A long, narrow room.' },
    { id: 'space.stairwell', name: 'Stairwell', kind: 'space', role: 'stairwell', naming: 'room', size: [4, 6, 6], proxy: 'room', params: room(true, false), engine: ROOM, description: 'A tall room between floors. Put stairs in it.' },
    { id: 'space.exterior', name: 'Exterior zone', kind: 'space', role: 'zone', naming: 'room', size: [20, 20, 6], proxy: 'room', params: room(false, false), engine: ROOM, description: 'Open ground: a floor, no walls or ceiling.' },
    { id: 'space.arena', name: 'Arena', kind: 'space', role: 'arena', naming: 'room', size: [16, 16, 5], proxy: 'room', params: room(true, false), engine: ROOM, description: 'An open-roofed space for encounters.' },
    { id: 'space.platform', name: 'Platform', kind: 'solid', role: 'platform', naming: 'architecture', size: [4, 4, 0.5], proxy: 'box', engine: SOLID, description: 'A raised slab to stand on.' },
  ]),
  ...group('architecture', [
    { id: 'arch.wall', name: 'Wall', kind: 'solid', role: 'wall', naming: 'architecture', size: [4, 0.2, 3], proxy: 'box', engine: SOLID, description: 'A free-standing wall.' },
    { id: 'arch.floor', name: 'Floor slab', kind: 'solid', role: 'floor', naming: 'architecture', size: [4, 4, 0.2], proxy: 'box', engine: SOLID, description: 'A piece of floor.' },
    { id: 'arch.ceiling', name: 'Ceiling slab', kind: 'solid', role: 'ceiling', naming: 'architecture', size: [4, 4, 0.2], proxy: 'box', engine: SOLID, description: 'A piece of ceiling. Raise it with its height above the floor.' },
    {
      id: 'arch.door', name: 'Door', kind: 'hosted', role: 'door', naming: 'interactive', size: [1, 0.2, 2.1], proxy: 'box', engine: HOSTED, description: 'An opening in a wall, with a door that can be locked.',
      params: [
        { key: 'swing', label: 'Opens', group: 'dimensions', type: 'select', default: 'in', options: ['in', 'out', 'sliding', 'open archway'] },
        { key: 'startsOpen', label: 'Starts open', group: 'interaction', type: 'boolean', default: false },
        { key: 'keyItem', label: 'Needs', group: 'gameplay', type: 'ref', default: '', refTypes: ['inventory'], hint: 'An inventory item that unlocks it.' },
        ...interaction(true, 'Open'),
      ],
    },
    { id: 'arch.window', name: 'Window', kind: 'hosted', role: 'window', naming: 'architecture', size: [1.2, 0.2, 1.2], proxy: 'box', engine: HOSTED, description: 'An opening in a wall above a sill.', params: [{ key: 'sill', label: 'Sill height', group: 'dimensions', type: 'number', unit: 'length', default: 0.9, min: 0, step: 0.05 }] },
    { id: 'arch.stairs', name: 'Stairs', kind: 'solid', role: 'stairs', naming: 'architecture', size: [1.2, 4, 3], proxy: 'stairs', engine: SOLID, description: 'A flight of steps rising to the north.', params: [{ key: 'steps', label: 'Steps', group: 'dimensions', type: 'number', unit: 'count', default: 16, min: 2, max: 60, step: 1 }] },
    { id: 'arch.ramp', name: 'Ramp', kind: 'solid', role: 'ramp', naming: 'architecture', size: [2, 4, 1], proxy: 'wedge', engine: SOLID, description: 'A slope rising to the north.' },
    { id: 'arch.ladder', name: 'Ladder', kind: 'solid', role: 'ladder', naming: 'architecture', size: [0.6, 0.1, 3], proxy: 'box', engine: SOLID, description: 'Climbable, straight up.', params: interaction(true, 'Climb') },
    { id: 'arch.elevator', name: 'Elevator', kind: 'solid', role: 'elevator', naming: 'interactive', size: [2, 2, 0.2], proxy: 'box', engine: PICKUP, description: 'A platform that moves between floors.', params: [{ key: 'travel', label: 'Travel', group: 'dimensions', type: 'number', unit: 'length', default: 3, step: 0.5 }, ...interaction(true, 'Call')] },
    { id: 'arch.railing', name: 'Railing', kind: 'solid', role: 'railing', naming: 'architecture', size: [3, 0.08, 1], proxy: 'box', engine: SOLID, description: 'A waist-high rail.' },
  ]),
  ...group('primitives', [
    { id: 'prim.box', name: 'Box', kind: 'solid', role: 'primitive', naming: 'architecture', size: [1, 1, 1], proxy: 'box', engine: SOLID, description: 'A box.' },
    { id: 'prim.plane', name: 'Plane', kind: 'solid', role: 'primitive', naming: 'architecture', size: [4, 4, 0.01], proxy: 'plane', engine: SOLID, description: 'A flat surface.' },
    { id: 'prim.cylinder', name: 'Cylinder', kind: 'solid', role: 'primitive', naming: 'architecture', size: [1, 1, 2], proxy: 'cylinder', engine: SOLID, description: 'A column or drum.' },
    { id: 'prim.sphere', name: 'Sphere', kind: 'solid', role: 'primitive', naming: 'architecture', size: [1, 1, 1], proxy: 'sphere', engine: SOLID, description: 'A ball.' },
    { id: 'prim.wedge', name: 'Wedge', kind: 'solid', role: 'primitive', naming: 'architecture', size: [1, 2, 1], proxy: 'wedge', engine: SOLID, description: 'A ramp-shaped block.' },
  ]),
  ...group('props', [
    { id: 'prop.table', name: 'Table', kind: 'solid', role: 'prop', naming: 'prop', size: [1.6, 0.9, 0.75], proxy: 'box', engine: SOLID, description: 'A table.' },
    { id: 'prop.chair', name: 'Chair', kind: 'solid', role: 'prop', naming: 'prop', size: [0.5, 0.5, 0.9], proxy: 'box', engine: SOLID, description: 'A chair.' },
    { id: 'prop.desk', name: 'Desk', kind: 'solid', role: 'prop', naming: 'prop', size: [1.4, 0.7, 0.75], proxy: 'box', engine: SOLID, description: 'A desk.' },
    { id: 'prop.shelf', name: 'Shelf', kind: 'solid', role: 'prop', naming: 'prop', size: [1.2, 0.4, 2], proxy: 'box', engine: SOLID, description: 'A bookshelf or rack.' },
    { id: 'prop.cabinet', name: 'Cabinet', kind: 'solid', role: 'prop', naming: 'prop', size: [0.8, 0.5, 1.2], proxy: 'box', params: interaction(true, 'Open'), engine: PICKUP, description: 'A cabinet that can be opened.' },
    { id: 'prop.bed', name: 'Bed', kind: 'solid', role: 'prop', naming: 'prop', size: [1.4, 2, 0.6], proxy: 'box', engine: SOLID, description: 'A bed.' },
    { id: 'prop.crate', name: 'Crate', kind: 'solid', role: 'prop', naming: 'prop', size: [1, 1, 1], proxy: 'box', params: physics('dynamic'), engine: SOLID, description: 'A crate that can be pushed.' },
    { id: 'prop.barrel', name: 'Barrel', kind: 'solid', role: 'prop', naming: 'prop', size: [0.6, 0.6, 0.9], proxy: 'cylinder', params: physics('dynamic'), engine: SOLID, description: 'A barrel.' },
    { id: 'prop.generic', name: 'Prop', kind: 'solid', role: 'prop', naming: 'prop', size: [0.5, 0.5, 0.5], proxy: 'box', engine: SOLID, description: 'Anything else: a placeholder for set dressing.' },
  ]),
  ...group('lighting', [
    { id: 'light.point', name: 'Point light', kind: 'light', role: 'light', naming: 'light', size: [0.3, 0.3, 0.3], proxy: 'sphere', params: light, engine: E('OmniLight3D', 'Light (Point)', 'PointLight'), description: 'Light in every direction.' },
    { id: 'light.spot', name: 'Spot light', kind: 'light', role: 'light', naming: 'light', size: [0.3, 0.3, 0.3], proxy: 'marker', params: [...light, { key: 'angle', label: 'Cone angle', group: 'presentation', type: 'number', unit: 'deg', default: 40, min: 1, max: 170, step: 1 }], engine: E('SpotLight3D', 'Light (Spot)', 'SpotLight'), description: 'A cone of light in the direction it faces.' },
    { id: 'light.area', name: 'Area / sun', kind: 'light', role: 'light', naming: 'light', size: [2, 2, 0.1], proxy: 'plane', params: light, engine: E('DirectionalLight3D', 'Light (Directional/Area)', 'DirectionalLight / RectLight'), description: 'Broad light: a window, a skylight, the sun.' },
    { id: 'light.practical', name: 'Practical light', kind: 'light', role: 'light', naming: 'light', size: [0.3, 0.3, 0.5], proxy: 'cylinder', params: [...light, ...interaction(true, 'Switch')], engine: E('OmniLight3D + mesh', 'Light + MeshRenderer', 'PointLight + mesh'), description: 'A lamp, torch or lantern the player can see (and switch).' },
    { id: 'light.emissive', name: 'Flicker / emissive', kind: 'light', role: 'light', naming: 'light', size: [0.4, 0.4, 0.4], proxy: 'sphere', params: light.map((p) => (p.key === 'flicker' ? { ...p, default: true } : p)), engine: E('OmniLight3D (animated)', 'Light + flicker script', 'PointLight + timeline'), description: 'A glowing or flickering marker.' },
  ]),
  ...group('gameplay', [
    { id: 'play.pickup', name: 'Pickup', kind: 'solid', role: 'pickup', naming: 'inventory', size: [0.4, 0.4, 0.4], proxy: 'box', engine: PICKUP, description: 'Something the player takes: it goes into their inventory.', params: [{ key: 'item', label: 'Gives', group: 'gameplay', type: 'ref', default: '', refTypes: ['inventory'] }, { key: 'quantity', label: 'Quantity', group: 'gameplay', type: 'number', unit: 'count', default: 1, min: 1, step: 1 }, ...interaction(true, 'Take').map((p) => (p.key === 'collectible' ? { ...p, default: true } : p)), ...physics('none')] },
    { id: 'play.item', name: 'Inventory item', kind: 'solid', role: 'inventory', naming: 'inventory', size: [0.3, 0.3, 0.3], proxy: 'sphere', engine: PICKUP, description: 'A story item in the world: the same item the Bible and scenes use.', params: [{ key: 'item', label: 'Item', group: 'gameplay', type: 'ref', default: '', refTypes: ['inventory'] }, ...interaction(true, 'Take').map((p) => (p.key === 'collectible' ? { ...p, default: true } : p)), ...physics('none')] },
    { id: 'play.weapon', name: 'Weapon', kind: 'solid', role: 'weapon', naming: 'inventory', size: [1, 0.2, 0.2], proxy: 'box', engine: PICKUP, description: 'A weapon proxy.', params: [{ key: 'damage', label: 'Damage', group: 'gameplay', type: 'number', default: 10, min: 0, step: 1 }, ...interaction(true, 'Take')] },
    { id: 'play.ammo', name: 'Ammo', kind: 'solid', role: 'ammo', naming: 'inventory', size: [0.3, 0.2, 0.2], proxy: 'box', engine: PICKUP, description: 'Ammunition.', params: [{ key: 'quantity', label: 'Rounds', group: 'gameplay', type: 'number', unit: 'count', default: 12, min: 1, step: 1 }, ...interaction(true, 'Take')] },
    { id: 'play.health', name: 'Health / power-up', kind: 'solid', role: 'health', naming: 'inventory', size: [0.4, 0.4, 0.4], proxy: 'sphere', engine: PICKUP, description: 'Restores health or grants a boost.', params: [{ key: 'value', label: 'Amount', group: 'gameplay', type: 'number', default: 25, min: 0, step: 5 }, ...interaction(true, 'Take')] },
    { id: 'play.checkpoint', name: 'Checkpoint', kind: 'volume', role: 'checkpoint', naming: 'logic', size: [2, 2, 2], proxy: 'box', engine: VOLUME, description: 'Saves progress when the player passes.', params: [{ key: 'order', label: 'Order', group: 'gameplay', type: 'number', unit: 'count', default: 1, min: 1, step: 1 }] },
    { id: 'play.objective', name: 'Objective', kind: 'marker', role: 'objective', naming: 'logic', size: [0.5, 0.5, 1], proxy: 'marker', engine: MARKER, description: 'Where the player is meant to go or what to do there.', params: [{ key: 'objective', label: 'Objective', group: 'gameplay', type: 'text', default: '' }] },
    { id: 'play.cover', name: 'Cover point', kind: 'marker', role: 'cover', naming: 'navigation', size: [1, 0.5, 1], proxy: 'marker', engine: MARKER, description: 'A spot actors take cover behind.' },
  ]),
  ...group('actors', [
    { id: 'actor.player', name: 'Player start', kind: 'marker', role: 'playerStart', naming: 'player', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: E('Marker3D (player start)', 'Player spawn point', 'APlayerStart'), description: 'Where the player begins. Every level needs one.' },
    { id: 'actor.npc', name: 'NPC', kind: 'marker', role: 'npc', naming: 'npc', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: E('CharacterBody3D placeholder', 'NPC prefab placeholder', 'ACharacter placeholder'), description: 'A character standing here.', params: [{ key: 'character', label: 'Character', group: 'narrative', type: 'ref', default: '', refTypes: ['character'] }, ...interaction(true, 'Talk'), ...patrol()] },
    { id: 'actor.companion', name: 'Companion', kind: 'marker', role: 'companion', naming: 'npc', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: E('CharacterBody3D placeholder', 'Companion prefab placeholder', 'ACharacter placeholder'), description: 'A character who travels with the player.', params: [{ key: 'character', label: 'Character', group: 'narrative', type: 'ref', default: '', refTypes: ['character'] }, ...follow()] },
    { id: 'actor.enemy', name: 'Enemy', kind: 'marker', role: 'enemy', naming: 'npc', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: E('CharacterBody3D placeholder', 'Enemy prefab placeholder', 'ACharacter placeholder'), description: 'A hostile actor placed by hand.', params: [{ key: 'character', label: 'Character', group: 'narrative', type: 'ref', default: '', refTypes: ['character'] }, { key: 'health', label: 'Health', group: 'gameplay', type: 'number', default: 100, min: 1, step: 5 }, ...patrol()] },
    { id: 'actor.neutral', name: 'Neutral actor', kind: 'marker', role: 'neutral', naming: 'npc', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: E('CharacterBody3D placeholder', 'Actor prefab placeholder', 'ACharacter placeholder'), description: 'Someone going about their business.', params: [{ key: 'character', label: 'Character', group: 'narrative', type: 'ref', default: '', refTypes: ['character'] }, ...patrol()] },
    { id: 'actor.patrol', name: 'Patrol node', kind: 'marker', role: 'patrolNode', naming: 'navigation', size: [0.4, 0.4, 0.4], proxy: 'marker', engine: MARKER, description: 'A stop on a patrol: actors whose Patrol is this one’s name walk its stops in order, waiting at each, round and round.', params: [{ key: 'path', label: 'Patrol', group: 'gameplay', type: 'text', default: 'Patrol A' }, { key: 'order', label: 'Order', group: 'gameplay', type: 'number', unit: 'count', default: 1, min: 1, step: 1 }, { key: 'wait', label: 'Wait', group: 'gameplay', type: 'number', unit: 's', default: 2, min: 0, step: 0.5 }] },
  ]),
  ...group('logic', [
    { id: 'logic.trigger', name: 'Trigger volume', kind: 'volume', role: 'trigger', naming: 'trigger', size: [3, 3, 2.5], proxy: 'box', engine: VOLUME, description: 'Notices the player entering and leaving. Give it rules.', params: [{ key: 'once', label: 'Only once', group: 'logic', type: 'boolean', default: true }, { key: 'who', label: 'Noticed', group: 'logic', type: 'select', default: 'player', options: ['player', 'any actor', 'npcs'] }] },
    { id: 'logic.gate', name: 'State gate', kind: 'volume', role: 'gate', naming: 'logic', size: [2, 0.5, 2.5], proxy: 'box', engine: VOLUME, description: 'Blocks the way until its condition holds.', params: [{ key: 'blocks', label: 'Blocks the way', group: 'logic', type: 'boolean', default: true }] },
    { id: 'logic.prereq', name: 'Prerequisite', kind: 'marker', role: 'prerequisite', naming: 'logic', size: [0.5, 0.5, 0.5], proxy: 'marker', engine: MARKER, description: 'A condition other items can require.' },
    { id: 'logic.interaction', name: 'Interaction point', kind: 'volume', role: 'interaction', naming: 'interactive', size: [1, 1, 1.5], proxy: 'box', engine: PICKUP, description: 'A place the player can act: examine, pull, read.', params: interaction(true, 'Examine') },
    { id: 'logic.puzzle', name: 'Puzzle node', kind: 'marker', role: 'puzzle', naming: 'interactive', size: [0.6, 0.6, 0.6], proxy: 'marker', engine: PICKUP, description: 'Where a puzzle is solved.', params: [{ key: 'puzzle', label: 'Puzzle', group: 'narrative', type: 'ref', default: '', refTypes: ['puzzle'] }] },
    { id: 'logic.hazard', name: 'Hazard', kind: 'volume', role: 'hazard', naming: 'trigger', size: [2, 2, 1], proxy: 'box', engine: VOLUME, description: 'Dangerous ground: water, fire, a pit.', params: [{ key: 'damage', label: 'Damage / s', group: 'gameplay', type: 'number', default: 10, min: 0, step: 1 }] },
    { id: 'logic.damage', name: 'Damage volume', kind: 'volume', role: 'damage', naming: 'trigger', size: [2, 2, 2], proxy: 'box', engine: VOLUME, description: 'Hurts whoever is inside.', params: [{ key: 'damage', label: 'Damage / s', group: 'gameplay', type: 'number', default: 25, min: 0, step: 1 }, { key: 'kills', label: 'Kills outright', group: 'gameplay', type: 'boolean', default: false }] },
  ]),
  ...group('presentation', [
    { id: 'pres.camera', name: 'Camera marker', kind: 'marker', role: 'camera', naming: 'camera', size: [0.5, 0.8, 0.5], proxy: 'marker', engine: E('Camera3D', 'Camera (Cinemachine-ready)', 'CineCameraActor'), description: 'A camera position and facing.', params: [{ key: 'fov', label: 'Field of view', group: 'presentation', type: 'number', unit: 'deg', default: 60, min: 5, max: 150, step: 1 }] },
    { id: 'pres.cinematic', name: 'Cinematic trigger', kind: 'volume', role: 'cinematic', naming: 'trigger', size: [3, 3, 2.5], proxy: 'box', engine: VOLUME, description: 'Plays a cinematic when the player arrives.', params: [{ key: 'cinematic', label: 'Cinematic', group: 'narrative', type: 'ref', default: '', refTypes: ['cinematic'] }, { key: 'once', label: 'Only once', group: 'logic', type: 'boolean', default: true }] },
    { id: 'pres.audio', name: 'Audio emitter', kind: 'marker', role: 'audio', naming: 'audio', size: [0.4, 0.4, 0.4], proxy: 'marker', params: presentation(true), engine: E('AudioStreamPlayer3D', 'AudioSource', 'AmbientSound'), description: 'A sound coming from here.' },
    { id: 'pres.ambient', name: 'Ambient zone', kind: 'volume', role: 'ambient', naming: 'audio', size: [8, 8, 4], proxy: 'box', params: [...presentation(true), { key: 'fog', label: 'Fog', group: 'presentation', type: 'number', unit: 'percent', default: 0, min: 0, max: 100, step: 5 }], engine: E('Area3D + reverb bus', 'Audio reverb zone', 'AudioVolume'), description: 'Atmosphere for a whole area: sound, reverb, fog.' },
    { id: 'pres.dialogue', name: 'Dialogue position', kind: 'marker', role: 'dialogue', naming: 'npc', size: [0.6, 0.6, 1.8], proxy: 'marker', engine: MARKER, description: 'Where a speaker stands for a scene’s dialogue.', params: [{ key: 'speaker', label: 'Speaker', group: 'narrative', type: 'ref', default: '', refTypes: ['character'] }] },
  ]),
  ...group('spawning', [
    { id: 'spawn.enemy', name: 'Enemy spawn', kind: 'marker', role: 'spawn', naming: 'spawn', size: [0.8, 0.8, 1.8], proxy: 'marker', params: spawn(), engine: E('Marker3D + VCGSSpawner', 'Spawner component', 'Spawner Actor'), description: 'Enemies appear here.' },
    { id: 'spawn.npc', name: 'NPC spawn', kind: 'marker', role: 'spawn', naming: 'spawn', size: [0.8, 0.8, 1.8], proxy: 'marker', params: spawn(), engine: E('Marker3D + VCGSSpawner', 'Spawner component', 'Spawner Actor'), description: 'Characters appear here.' },
    { id: 'spawn.item', name: 'Item spawn', kind: 'marker', role: 'spawn', naming: 'spawn', size: [0.5, 0.5, 0.5], proxy: 'marker', params: spawn('inventory'), engine: E('Marker3D + VCGSSpawner', 'Spawner component', 'Spawner Actor'), description: 'Items appear here.' },
    { id: 'spawn.wave', name: 'Wave / encounter', kind: 'volume', role: 'spawn', naming: 'spawn', size: [8, 8, 3], proxy: 'box', params: [...spawn(), { key: 'waves', label: 'Waves', group: 'spawn', type: 'number', unit: 'count', default: 3, min: 1, step: 1 }], engine: E('Area3D + VCGSEncounter', 'Encounter component', 'Encounter Actor'), description: 'An encounter: waves start when the player enters.' },
    { id: 'spawn.respawn', name: 'Respawn point', kind: 'marker', role: 'checkpoint', naming: 'spawn', size: [0.8, 0.8, 1.8], proxy: 'marker', engine: MARKER, description: 'Where the player comes back after dying.' },
  ]),
  ...group('navigation', [
    { id: 'nav.waypoint', name: 'Waypoint', kind: 'marker', role: 'waypoint', naming: 'navigation', size: [0.4, 0.4, 0.4], proxy: 'marker', engine: MARKER, description: 'A point on a route.', params: [{ key: 'path', label: 'Route', group: 'gameplay', type: 'text', default: 'Route A' }, { key: 'order', label: 'Order', group: 'gameplay', type: 'number', unit: 'count', default: 1, min: 1, step: 1 }] },
    { id: 'nav.traversal', name: 'Traversal link', kind: 'marker', role: 'traversal', naming: 'navigation', size: [0.5, 2, 0.5], proxy: 'marker', engine: E('NavigationLink3D', 'OffMeshLink / NavMeshLink', 'NavLinkProxy'), description: 'A jump, climb or drop the AI can use.' },
    { id: 'nav.portal', name: 'Entry / exit portal', kind: 'volume', role: 'portal', naming: 'navigation', size: [2, 1, 2.5], proxy: 'box', engine: VOLUME, description: 'Leads to another level or floor.', params: [{ key: 'to', label: 'Leads to', group: 'gameplay', type: 'text', default: '' }, { key: 'required', label: 'Required exit', group: 'gameplay', type: 'boolean', default: false }] },
    { id: 'nav.destination', name: 'Destination', kind: 'marker', role: 'destination', naming: 'navigation', size: [0.6, 0.6, 1], proxy: 'marker', engine: MARKER, description: 'Where a route or an objective ends.' },
  ]),
];

const STARTER_BY_ID = new Map(STARTER.map((a) => [a.id, a]));

/** The definition an instance comes from: the project's, this computer's, or the starter library's. */
export const findAsset = (id: string, project: readonly AssetDefinition[] = [], global: readonly AssetDefinition[] = []): AssetDefinition | undefined =>
  project.find((a) => a.id === id) ?? global.find((a) => a.id === id) ?? STARTER_BY_ID.get(id);

/** Placeholder for an item whose definition is missing (a project asset deleted, a global one not on this computer). */
export const MISSING_ASSET: AssetDefinition = {
  id: 'missing',
  name: 'Missing asset',
  category: 'custom',
  kind: 'solid',
  role: 'prop',
  naming: 'prop',
  size: { w: 1, d: 1, h: 1 },
  proxy: 'box',
  params: [...appearance, ...engine],
  engine: SOLID,
  description: 'This item’s library asset is not in this project or on this computer.',
  source: 'project',
  version: 0,
};

/** Every parameter group in the inspector's order, with its heading. */
export const GROUPS: readonly { id: import('./types').PropertyGroup; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'transform', label: 'Transform' },
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'physics', label: 'Physics' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'logic', label: 'Logic' },
  { id: 'narrative', label: 'Narrative' },
  { id: 'spawn', label: 'Spawn / encounter' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'engine', label: 'Engine export' },
];
