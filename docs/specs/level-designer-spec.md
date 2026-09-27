<!-- Converted from level-designer-spec.docx (VC Level Designer v3). The .docx is the source. -->

# VC Game Studio

Level Designer • Development Specification • Version 2.0

2D Planning → Parametric Assets → 3D Grayboxing → Gameplay Logic → Playable Prototype → Engine Handoff

Prepared for UI/UX and Coding Agents • September 2026

| Document Purpose | Authoritative Scope |
| --- | --- |
| Primary deliverable | Complete replacement specification for the VC Game Studio Level Designer. |
| Integrates with | VC Writer / Game Design Spine, Scenes, Player Lane, Obstacles, Choices, Inventory, Puzzles, Cinematics and Game Bible. |
| Target engines | Unity, Unreal Engine and Godot. |
| Design principle | Everything defined during writing and level design should survive the handoff as structured, engine-readable data whenever practical. |

## 1. Product Vision

The VC Game Studio Level Designer is a unified spatial, narrative and gameplay prototyping environment. Designers begin with a top-down 2D map, place or draw level areas, open any area as an editable 3D graybox, attach narrative scenes and gameplay systems, test the resulting game in an integrated Play Mode, and export a structured project to Unity, Unreal Engine or Godot for final production.

The Level Designer must not operate as an isolated map editor. A room, corridor, spawn point, interactive prop, puzzle object, cinematic trigger or inventory item can be connected directly to the same story and game-state data authored in the VC Writer/Game Design portion of VC Game Studio.

### 1.1 Core outcome

- A designer can move from story architecture to a spatially playable prototype without rebuilding the design in a separate application.
- Graybox objects are functional proxies, not anonymous geometry.
- Final art can replace proxies in the destination engine without destroying gameplay identity, logic, links or authored metadata.
- 2D, 3D, narrative and properties views are representations of one underlying project model, not separate copies.

## 2. Primary Workspace Architecture

| Region | Purpose |
| --- | --- |
| Left Library / Legend | Searchable drag-and-drop catalog for rooms, geometry, architecture, furniture, lights, gameplay objects, characters/NPCs, spawn points, triggers, puzzles, cinematics and saved custom assets. |
| Center Canvas | Switchable 2D Map, 3D Graybox and Play Mode viewport. |
| Right Properties Inspector | Context-sensitive parameters for the selected map area, asset, scene link, gameplay object or trigger. |
| Top Toolbar | Selection, drawing, geometry, snapping, view mode, test/play, validation, export and project controls. |
| Bottom/Overlay Navigation | Breadcrumbs, scene/spine links, warnings, coordinates, selected-object identity and optional timeline access. |

The layout should feel familiar to users of DCC/CAD/game tools while remaining accessible to writers and designers who do not consider themselves 3D artists.

## 3. 2D Level Map

### 3.1 Map authoring

- Create levels, floors, zones, rooms, corridors, exterior regions, pathways and encounter areas from a top-down view.
- Draw freeform boundaries or drag predefined parametric assets from the Library.
- Support grid, snap, align, distribute, rotate, duplicate, mirror, grouping, layers, visibility and locking.
- Display doors, windows, stairs, elevators, vertical transitions, spawn points, triggers, objectives and scene links with readable symbols.
- Allow multiple floors/elevations with floor selector and optional ghosted adjacent-floor reference.
- Support measurement overlays and configurable project units.

### 3.2 Area behavior

A map area is an object with a stable identity. Double-clicking a room or area opens its corresponding 3D graybox context. The transition must preserve selection and camera context where practical.

## 4. Parametric Asset Library

### 4.1 Library concept

VC Game Studio ships with a starter library of reusable, pre-authored assets. Each asset can have a 2D representation, 3D proxy geometry, editable parameters, connection points, gameplay metadata and engine-export mapping. Assets are templates; placed objects are instances.

### 4.2 Initial asset categories

| Category | Examples |
| --- | --- |
| Spaces | Rectangular room, irregular room, hallway, stairwell, exterior zone, arena, platform. |
| Architecture | Wall, floor, ceiling, door, window, stair, ramp, ladder, elevator, railing. |
| Furniture / Props | Table, chair, desk, shelf, cabinet, bed, crate, barrel and generic prop. |
| Lighting | Point, spot, area/directional proxy, practical light, flicker/emissive marker. |
| Gameplay | Pickup, inventory item, weapon proxy, ammo, health/power-up, checkpoint, objective, cover point. |
| Actors | Player start, NPC, companion, enemy, neutral actor, patrol node. |
| Logic | Trigger volume, state gate, prerequisite, interaction point, puzzle node, hazard, damage volume. |
| Presentation | Camera marker, cinematic trigger, audio emitter, ambient zone, dialogue position. |
| Spawning | Enemy spawn, NPC spawn, item spawn, wave/encounter spawn, respawn/checkpoint. |
| Navigation | Waypoint, patrol path, traversal link, entry/exit portal, destination marker. |

### 4.3 Library asset vs. instance

A Library Asset stores reusable defaults. An Asset Instance stores placement-specific values and overrides. Updating a library definition must not silently overwrite intentional instance overrides. The UI should identify inherited values versus overridden values and provide Reset to Default.

### 4.4 Save to Library

- Any eligible user-created object or grouped assembly can be saved as a Project Asset.
- Optionally promote a Project Asset to the user’s Global Library.
- Saved assemblies may include geometry, child objects, attachment points, logic, metadata and default properties.
- Provide versioning/migration metadata so library updates can be applied safely.

## 5. 3D Graybox Editor

### 5.1 Geometry workflow

- Double-click a 2D area to enter its 3D representation.
- Create primitives: box, plane, cylinder, sphere, ramp/wedge and configurable architectural primitives.
- Provide move, rotate, scale, duplicate, extrude/extend where supported, snapping, pivot editing and local/world transforms.
- Rooms generated from parametric assets automatically create floor, walls and ceiling representation as configured.
- Doors/windows and other hosted assets remain associated with their parent surface and update when dimensions change.
- Support simple collision visualization and navigation/traversal preview.

### 5.2 Two-way synchronization

The 2D map and 3D graybox must edit the same object model. Changing a room from 20 × 30 to 30 × 40 in the Properties Inspector updates its 2D footprint and regenerated 3D geometry. Graphical resizing in 2D or 3D updates the same dimensions and Inspector values. Synchronization should be transactional and undoable.

### 5.3 Parametric regeneration rules

- Preserve stable object GUIDs during geometry regeneration.
- Preserve hosted child assets when possible; if a child becomes invalid, flag it rather than silently deleting it.
- Preserve narrative/gameplay links through resizing.
- Provide warnings when a parameter change causes overlap, inaccessible openings or invalid placements.

## 6. Right-Side Properties Inspector

The Properties Inspector is context-sensitive and is the authoritative editable property surface for selected objects. Sections should be collapsible and searchable for complex assets.

| Property Group | Representative Fields |
| --- | --- |
| Identity | Display name, export name, type, subtype, GUID, tags, library source/version. |
| Transform | Position X/Y/Z, rotation, scale, parent, pivot, floor/elevation. |
| Dimensions | Width, length/depth, height, wall thickness, ceiling height, radius or type-specific dimensions. |
| Appearance | Proxy mesh, proxy material/category, visibility, final-asset placeholder/reference. |
| Physics | Collision type, static/dynamic, gravity, mass and engine-neutral physics flags. |
| Interaction | Interactive, usable, movable, collectible, destructible, locked, prompt/action, interaction range. |
| Gameplay | Health/damage/value, inventory class, quantity, ammo, quest/lore status, variables, state mutations. |
| Logic | Prerequisites, state gates, triggers, conditions, actions, success/failure paths. |
| Narrative | Linked Spine bone, Scene, Player beat, obstacle, choice, objective, character/NPC, setup/payoff. |
| Spawn / Encounter | Spawn type, actor set, count, timing, respawn, wave, conditions, orientation, radius. |
| Presentation | Camera/cinematic association, audio/SFX, atmospheric zone, dialogue staging. |
| Engine Export | Target mappings, class/component/script template, prefab/Blueprint/scene mapping, export inclusion and replacement state. |

## 7. Narrative and Game-Design Integration

### 7.1 Spine and scene links

- A Spine bone can link to one or more level areas and scenes.
- A Scene can link to a room, zone, location marker or sequence of spaces.
- Selecting a Scene from the narrative graph can locate/highlight its map and 3D objects; selecting a linked map object can open the Scene.
- Choices and state gates can control which doors, paths, encounters, NPCs, pickups or exits are active.
- Player-lane progression beats and obstacles can be visualized as optional overlays on the level map.

### 7.2 Scene-layer integration

Level objects should expose links to the existing scene layers: Narrative Metadata, Behavioral, Systemic and Presentation. The map becomes the spatial manifestation of those definitions rather than a second authoring silo.

### 7.3 Local scene timeline

Spatial objects may be placed on or referenced by the Scene timeline: opening cinematic, actor movement, dialogue, interaction, trigger, gameplay transition, environmental event and exit. Selecting a timeline event should locate its associated level object when one exists.

## 8. Gameplay Objects and Logic

### 8.1 Functional proxies

A proxy can carry gameplay meaning before final artwork exists. For example, a magical inventory object can already support pickup, inventory addition, state mutation, prerequisite checks and later use while displaying only a simple graybox mesh.

### 8.2 Logic model

- Conditions: flags, variables, inventory, quest state, relationship state, prior choices, actor state and location.
- Actions: set/change state, add/remove inventory, open/close, enable/disable, spawn/despawn, start dialogue/cinematic, play audio, activate objective, transition scene/level.
- Events: on enter, on exit, on interact, on pickup, on use, on destroy, on timer, on state change and custom game event.
- Reusable logic components should be attachable without requiring the designer to write engine-specific code.

### 8.3 Spawns and encounters

- Place spawn points in 2D or 3D and orient them spatially.
- Associate actor/enemy/NPC definitions, counts, waves, timing and conditions.
- Preview spawn radius/volume and basic encounter sequencing.
- Support conditional spawns tied to narrative choices and game state.
- Export spawn configuration as engine-native or generated runtime components.

## 9. Integrated Play Mode

### 9.1 Purpose

Play Mode provides rough playability inside VC Game Studio so the designer can validate scale, flow, navigation, triggers, scene transitions, choices, pickups, doors, spawn locations and basic game-state logic before engine handoff.

### 9.2 Controls

- Standard configurable keyboard/mouse controls, including conventional WASD movement where appropriate.
- Game controller/joystick support through a configurable input abstraction.
- First-person, third-person and top-down prototype controllers based on the project setup.
- Basic camera, collision, gravity/jump and interaction behavior appropriate to the selected prototype mode.
- Pause/inspect mode for current variables, inventory, active objectives, triggers and scene state.

### 9.3 Test tools

- Play from level start, selected scene, selected checkpoint or current camera position.
- Reset/reload state and define test-state presets.
- Debug overlay for object names, triggers, collision, spawn points, navigation and narrative links.
- Event log showing conditions evaluated and actions fired.
- Record validation issues discovered during play as tasks/notes linked to the responsible object.

## 10. Object Identity and Naming Convention

### 10.1 Stable identity

Every exportable object receives an immutable internal GUID. Human-readable names may change; GUID-based references must remain intact. Engine adapters maintain a manifest mapping VC GUIDs to destination-engine objects.

### 10.2 Human-readable export names

Use configurable type prefixes plus descriptive names and instance numbers. Example pattern: TYPE_Context_Name_###. Exact engine sanitation rules are applied by each exporter.

| Prefix Example | Meaning | Example |
| --- | --- | --- |
| LVL | Level/Map | LVL_Castle_01 |
| RM | Room/Space | RM_Castle_Throne_001 |
| INT | Interactive | INT_Lab_MagicOrb_003 |
| INV | Inventory Item | INV_MagicWand_001 |
| SPN | Spawn | SPN_Enemy_Guard_004 |
| TRG | Trigger | TRG_Throne_Enter_002 |
| NPC | NPC Actor | NPC_Merchant_001 |
| CAM | Camera/Cinematic Marker | CAM_Intro_Dolly_001 |
| AUD | Audio Emitter | AUD_River_Ambience_001 |

Naming templates must be project-configurable; do not make the example prefixes hard-coded business logic.

## 11. Engine Handoff Architecture

### 11.1 Engine-neutral project model

Authoring data should be stored in an engine-neutral intermediate representation. Unity, Unreal and Godot exporters translate this model into each engine’s scene hierarchy, components/classes/scripts, collision, metadata and generated gameplay scaffolding.

### 11.2 Export intent

| Target | Expected handoff concept |
| --- | --- |
| Unity | Scenes/prefabs or generated equivalents, GameObjects, components/scripts, colliders, transforms, tags/layers where mapped, metadata and generated VC behavior components. |
| Unreal Engine | Levels/maps, Actors, components, Blueprint/C++-compatible generated scaffolding or data assets, collision, transforms, tags and VC metadata. |
| Godot | Scenes/nodes, scripts/resources, collision/physics nodes, transforms, groups/metadata and generated VC behavior components. |

### 11.3 Replacement-ready proxies

- Proxy visual geometry must be separable from gameplay identity/logic wherever practical.
- Final art replacement should preserve GUID mapping, transform, gameplay components, links and metadata.
- Export manifest records asset identity, VC source path, target-engine object identity and last exported revision.
- Allow “visual replacement locked” or equivalent state so a re-export does not overwrite an artist’s final mesh/material assignment.

### 11.4 Incremental re-export

The exporter must compare the VC project state against the prior export manifest. Designers can push changed layout, logic or metadata without rebuilding the entire destination project. Conflicts between VC-authored values and engine-side edits must be reported and resolved according to explicit ownership rules rather than silently overwritten.

## 12. Validation and Preflight

Before Play Mode and export, the system should run configurable validation checks.

- Duplicate or invalid export names.
- Broken GUID references or missing linked scenes/assets.
- Invalid hosted geometry after resizing.
- Missing player start or required entry/exit.
- Unreachable or unlinked required objective/scene when detectable.
- Spawn references with missing actor definitions.
- Inventory/logic references to undefined items or variables.
- Unsupported properties for the selected target engine.
- Engine-name sanitation collisions.
- Potential re-export conflicts with destination assets marked as externally modified.

## 13. Data Model – Minimum Entities

| Entity | Minimum Responsibility |
| --- | --- |
| LevelProject | Project units, engine targets, global settings and level collection. |
| Level | Floors/zones, map settings, scenes and level-wide metadata. |
| SpatialArea | Room/zone/corridor identity, geometry parameters and narrative links. |
| AssetDefinition | Reusable library template, schema, default properties, proxy and engine mappings. |
| AssetInstance | GUID, transform, overrides, parent/host, links and export state. |
| GameplayComponent | Engine-neutral behavior definition and parameters. |
| LogicGraph/Rule | Events, conditions and actions. |
| NarrativeLink | References to Spine, Scene, beat, choice, obstacle, objective or character. |
| SpawnDefinition | Actor reference, timing, conditions, waves and spawn properties. |
| ExportManifest | GUID-to-engine mapping, revision, ownership/lock state and export diagnostics. |

## 14. Undo, Versioning and Collaboration Readiness

- All property and geometry edits must support undo/redo.
- Parametric regeneration should be a single reversible transaction.
- Persist stable GUIDs across save/load, duplicate-with-new-ID, rename and re-export.
- Design data should be structured to support future multi-user locking/merge rather than serialized only as opaque binary scene data.
- Autosave/recovery and project snapshots should protect large level-design sessions.

## 15. UX Requirements

- Writers can link a Scene to a map location without learning 3D terminology.
- Level designers can work spatially without opening the narrative graph for every edit.
- Properties reveal complexity progressively; common fields appear first and advanced engine mappings remain collapsible.
- Selection is synchronized across Outliner/Library instance list, 2D, 3D, Inspector and narrative references.
- Color/symbol language from the broader VC Game Studio UI should remain consistent.
- Tooltips and validation messages should explain what will happen on engine export.

## 16. Recommended Implementation Phases

1. Foundation: engine-neutral data model, GUID system, project persistence, undo/redo and 2D canvas.
2. Parametric spaces: rooms/areas, dimensions, 2D↔3D synchronization and Properties Inspector.
3. 3D graybox: primitives, transforms, snapping, hosted architecture and basic collision.
4. Asset Library: definitions/instances, starter catalog, custom Save to Library and override inheritance.
5. Narrative integration: Spine/Scene/player/choice/objective links and scene timeline references.
6. Gameplay logic: interactions, inventory, triggers, conditions/actions, spawning and encounters.
7. Play Mode: prototype controllers, keyboard/controller input, collision, state inspection and event debugging.
8. Export adapters: Unity, Unreal and Godot mappings plus manifest and naming validation.
9. Incremental re-export: destination ownership, final-art replacement protection and conflict resolution.
10. Production hardening: validation, performance, autosave/recovery, migration and collaboration readiness.

## 17. Acceptance Criteria

1. A user can drag a prebuilt Room from the Library into the 2D map and immediately see its 2D footprint.
2. Double-clicking the room opens a corresponding 3D graybox room.
3. Changing room dimensions in the right Properties Inspector updates both 2D and 3D representations without breaking the room GUID.
4. A user can place a door, light, furniture object, pickup, trigger and spawn point and edit their type-specific properties.
5. A placed object can link to a VC Scene/Spine element and be navigated from either direction.
6. An inventory proxy can be collected in Play Mode and change test-state inventory/variables.
7. A conditional trigger or spawn can react to game-state conditions during Play Mode.
8. Play Mode supports the selected prototype perspective using keyboard/mouse and configurable controller input.
9. Export validation identifies naming/reference errors before handoff.
10. Unity, Unreal and Godot exporters preserve object identity through a GUID mapping manifest and produce destination structures with generated gameplay scaffolding.
11. A final-art replacement can be protected from later VC re-export while receiving permitted logic/layout updates.
12. A user-created graybox assembly can be saved to the Project Library and reused as a parametric asset.

## 18. Definition of Done for Level Designer v1

Level Designer v1 is complete when a designer can author a small multi-room level from the 2D map, use parametric library assets, edit the result in 3D, attach narrative and gameplay logic, run a rough playable test, validate the project, and hand the structured prototype to at least one supported game engine without manually reconstructing object identity and core gameplay intent. Unity, Unreal and Godot adapters may mature in stages, but the engine-neutral model and export contract must be designed for all three from the beginning.

## 19. Future Extensions (Not Required for Initial Build)

- Terrain/sculpting and foliage systems.
- Procedural room/level generation from rules.
- Navmesh authoring and AI behavior visualization.
- Multiplayer/network spawn and replication metadata.
- Streaming/world-partition planning for large worlds.
- Performance budgets and platform-specific profiling.
- Direct round-trip import of selected engine-side changes where safely representable.
- Marketplace/team-shared asset libraries and organization-level templates.
