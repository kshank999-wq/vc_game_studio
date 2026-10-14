VC GAME STUDIO

Structure Creator & Building Generator

Development Specification  |  Version 1.0  |  13 October 2026

Implementation-ready functional specification for the VC Game Studio coding agent. Covers structure generation, nested playable spaces, editing, gameplay authoring, integrations, and engine handoff.

## 1. Executive Overview

Structure Creator is the building-scale design module within VC Game Studio. A designer selects an area of a World, Region, Level, or Scene; places or draws a structure (pyramid, temple, office, apartment block, castle, ruin, bunker, etc.); generates or hand-builds floor plans; and converts its rooms, floors, and connections into an explorable “mini-level within the level.” The structure remains linked to the parent game world and scene logic, with drag-and-drop gameplay elements drawn from shared asset libraries.

## 2. Primary User Journey

- In the World/Level Designer, select a level area, choose Add Structure, then choose a template or draw an outer footprint.

- Set structure type, purpose, scale, floor count (including basement/roof), entrances, traversal style, and optional generation seed.

- Generate a complete floor-plan proposal, including circulation and vertical connections, or place stairs, rooms, doors and corridors manually.

- Draw the intended route/path through a pyramid, temple or building; mark required, optional and hidden paths.

- Open any room or floor in 2D or 3D graybox editing; drag in doors, ladders, holes, obstacles, interactive objects, pickups, NPCs and triggers.

- Attach locked-door conditions, puzzles, state changes, inventory requirements, encounters, cinematics and scene beats.

- Preview the playable structure in rough-play mode, validate reachability, then export placeholders and structured logic to the chosen engine.

## 3. Scope & Design Principles

- Nested hierarchy: World → Region/Area → Level → Scene → Structure → Floor → Room/Space → Object/Interaction. A structure can itself act as a self-contained sub-scene with separate entry/exit criteria.

- Every generated layout remains editable; the generator must never silently overwrite manually authored work.

- Support both procedural generation and direct modeling/drag-and-drop authoring, with the same underlying data model.

- Use real-scale units, configurable scale presets and clear origin/coordinate relationships to the parent Level Designer.

- Bidirectional links between structures, story scenes, puzzles, NPC definitions, inventory, and master world graph.

- Prototype first: graybox geometry and placeholder assets, with safe replacement by final art without losing IDs, logic, or references.

## 4. Entry Points & Module UI

| UI Zone | Functions |
|---|---|
| Project/World tree | Locate and nest structure under scene/level; duplicate; rename; toggle visibility. |
| Top toolbar | New Structure, Generate, Regenerate Selection, Validate, 2D / 3D / Play, Export. |
| Left asset/library panel | Searchable structural parts, template blueprints, personal imports and gameplay objects. |
| Center canvas | 2D floor-plan editing; switch to 3D graybox; switch floors or show stacked floors. |
| Right Properties panel | Exact dimensions, floor elevation, material proxy, geometry, connection and gameplay settings. |
| Bottom graph/timeline | Room dependency graph, route graph, scene timeline and validation issues. |

## 5. Structure Setup & Template Parameters

- Structure metadata: unique ID, name, type, associated level/scene, tags, author, size/footprint, orientation, world position and origin.

- Footprint editing: rectangle, polygon, freeform perimeter, imported drawing/map, or template footprint; support voids/courtyards and offsets.

- Generator configuration: number of above-grade/below-grade floors, floor-to-floor heights, accessibility/route constraints, density, room count/size range, corridor widths, entrance count, stair/elevator/ladder shafts, locked/secret areas.

- Structure presets: pyramid/tomb, ancient temple, fortress/castle, modern office, apartment/hotel, industrial facility, underground bunker, dungeon/ruin, and blank custom template.

- Style presets affect arrangement and proxy appearance only; final architectural accuracy/art quality is handled downstream.

## 6. Automatic Floor-Plan Generation

The generator produces an editable candidate layout within a selected footprint using deterministic seeds. Users may generate the entire building, a selected floor, one wing or a single room.

- Generate a circulation skeleton from entrances, exits, main route, secondary routes and vertical shafts.

- Partition usable space into named rooms/areas and corridors; preserve user-defined “must keep” rooms, anchors and walls.

- Keep staircase/lift/ladder connections geometrically aligned between floors unless explicitly marked as unconventional or nonphysical.

- Support a path-first mode: designer draws the desired route through a pyramid or temple, then generator surrounds it with rooms, chambers, dead ends and secret branches.

- Support plan-first mode: generator suggests complete floor plates with stairwells, corridors, and room distribution.

- Support rule presets: linear exploration, branching exploration, hub-and-spoke, maze, survival-horror chokepoints, puzzle chain and open-plan interior.

- Show proposed results as preview overlays with Accept, Reject and Regenerate controls; allow seed locking and partial regeneration.

- Preserve manually locked geometry and report impossible constraints rather than generating disconnected spaces.

## 7. Manual 2D Structural Editor

- Draw/move/resize walls, rooms, floors, hallways, doors, windows, openings and freeform paths using snap, grid, orthogonal/angle mode and numeric dimensions.

- Drag library parts into plan; snapping automatically creates compatible wall openings and maintains host/connection relationships.

- Place stairs, escalators, elevators, ladders, shafts, ramps, trapdoors, climb points, tunnels and drops as inter-floor connections.

- Assign door properties: locked/unlocked, key/item requirement, switch/code/puzzle dependency, destructible, one-way, timed, or scripted.

- Define secret doors, breakable walls, holes/openings and alternate player routes; visually distinguish discoverable and undiscovered links.

- Multi-select, copy/paste between floors, mirror, align, array, undo/redo and constraint locking.

## 8. Floors, Vertical Navigation & Local Structure Graph

Each floor is a separately editable plane, connected by explicit traversal edges. The Structure Graph represents rooms/spaces as nodes and navigable connections as edges; it is linked upward to the parent Level/Scene graph.

- Floor list: B2, B1, Ground, 2, 3 … Roof; support custom names and nonstandard elevations.

- Display floor overlays, section cutaways, stacked 3D view and connector indicators that expose destination floors.

- Each connection specifies source/destination room and floor, traversal method, direction, capacity, requirements and resulting spawn point.

- Optional teleport/magical transitions are modeled separately from physical stairs/ladders; maintain explicit transition data.

- Auto-identify unreachable rooms, inaccessible exits, broken stair alignments and invalid spawn locations.

## 9. Structural Parts & Gameplay Library

| Category | Initial Library Content |
|---|---|
| Spaces | Empty room, corridor, chamber, stairwell, elevator lobby, courtyard, roof, crawlspace. |
| Envelope | Wall, floor slab, ceiling, column, doorway, window, gate, arch, breakable wall, hole. |
| Traversal | Stairs, ladders, ramps, shafts, lift, hatch, trapdoor, rope/climb point, tunnel. |
| Barriers | Locked door, security gate, barricade, rubble, movable obstacle, collapsible passage. |
| Interactives | Lever, pressure plate, keypad, safe, switch, mechanism, destructible item, clue marker. |
| Gameplay | Pickup, weapon, inventory item, quest item, power-up, checkpoint, trap, enemy/NPC spawn, trigger. |
| Presentation | Camera marker, cinematic trigger, SFX, ambient zone, lighting proxy, dialogue anchor. |

Library assets may be built-in, project-level reusable prefabs or personal imported models. Each asset retains a stable type ID and parameter schema; duplicated instances receive independent IDs and overrides.

## 10. Structure as Nested Scene / Mini-Level

- Structure defines entry points, exit points, objectives, prerequisites, completion conditions and optional local objectives.

- Rooms may contain their own dialogue, events, puzzles, enemies, pickups, cinematics and state mutations.

- Attach local variables (e.g., generator_powered) and shared world variables (e.g., artifact_corrupted); specify scope explicitly.

- Support transitions from a parent scene into the structure and between internal rooms with a shared event/trigger contract.

- When the player leaves and re-enters, persistent state governs doors, collected items, defeated enemies and solved puzzles; allow explicit reset rules.

- Allow alternate routes and endings so replays can yield different sequences while still meeting parent scene dependencies.

## 11. Puzzle, Condition & Inventory Integration

Reuse VC Game Studio Puzzle Creator, Scene Authoring, Inventory/Item Library, Character/Adversary Creator, and setup/payoff references rather than creating incompatible local subsystems.

- Every door/obstacle can open a conditions editor: required item, clue, combination, switch state, quest flag, NPC action or timed trigger.

- Design dependency chains visually: find clue → obtain code → unlock safe → recover key → open restricted stairwell.

- Drag existing items and power-ups to locations or create a new catalog item in context; keep item definition separate from placement instance.

- Attach NPC patrol/guard states, detection volumes, encounter triggers, loot tables and cinematic cues to rooms.

- Display pathway changes dynamically when conditions are met or paths are blocked, with optional designer-defined fallback paths.

- Provide solvability checks for mandatory routes and key-item placement; flag circular dependencies and softlocks.

## 12. 2D to 3D Graybox Workflow

- Single source of truth for footprint, floors and wall/opening geometry. 3D views are generated from plan and editable within defined constraints.

- Double-click a room to open local 3D graybox; edit proxy walls, heights, door positions, stairs and placed props in 3D.

- Visualize stacked floors and navigate the building from entry to roof or basement.

- Map library placeholders to prefab/proxy geometry; preserve transforms, references and gameplay bindings when art assets are swapped.

- Provide quick first-person/third-person rough-play traversal, collision preview and agent navigation overlays.

## 13. Data Contracts / Suggested Entities

| Entity | Core Fields |
|---|---|
| Structure | id, projectId, levelId, sceneId, name, type, footprint, transform, generatorConfig, revision |
| Floor | id, structureId, index, name, elevation, height, footprint, visibility |
| Space | id, floorId, kind, polygon, dimensions, tags, objectives, roomSceneId |
| Connection | id, fromSpaceId, toSpaceId, kind, anchorTransforms, direction, conditions, targetSpawnId |
| AssetInstance | id, assetDefinitionId, spaceId, transform, parameterOverrides, bindings |
| Condition/Action | id, scope, expression, effects, persistence, triggerSourceId |
| GenerationRun | id, seed, algorithmVersion, settings, lockedElementIds, acceptedAt |

Requirements: stable UUIDs; serialized schema version; reference integrity; idempotent exports; deterministic generation from seed + version; autosave with transaction-safe undo/redo; separation of layout geometry from authored gameplay state.

## 14. Engine Export & Import

- Export hierarchical scene manifests, room/floor geometry, collision proxies, spawn/transition points, navigation connections, asset instances and gameplay logic metadata.

- Provide adapters/templates for Unreal, Unity and Godot with namespaced stable IDs and an engine-agnostic intermediate JSON format.

- Create placeholder nodes/prefabs for doors, lifts, stairs, triggers, pickups and enemies with stubbed interaction contracts; avoid claiming engine-ready bespoke AI or final animation.

- Allow re-export with changes applied by ID; do not overwrite user-edited engine assets without a conflict/reconciliation report.

- Import existing footprints/floor plans and custom 3D proxies (where supported), preserving scale and coordinate mappings.

## 15. Validation, Edge Cases & Performance

- Geometry: overlapping/zero-width rooms, door without host wall, stairs outside footprint, floor-height conflicts, invalid polygon, impassable clearance.

- Gameplay: inaccessible start/exit, mandatory objective unreachable, key behind its locked door, cyclic prerequisite chain, orphan item/trigger, transition without destination.

- State: duplicate asset IDs, missing cross-module references, conflicting persistence settings, broken scene links after parent move/rename.

- Performance: progressively load floors/rooms, cull invisible proxy elements, batch simple meshes and cache generated navigation graph.

- Accessibility/design options: configurable traversal assumptions (stairs-only, ladder-capable, wheelchair-accessible where desired); do not imply building-code compliance.

## 16. Acceptance Criteria

- A user can add a pyramid within an existing level and draw a route that the generator uses to create multiple connected chambers.

- A user can add a five-story building, generate corridor/room floor plans and edit stairwell placement without breaking floor links.

- A user can drag a locked door and a key into different rooms; configure the dependency; validator confirms the key is reachable first.

- A user can place an NPC, power-up and cinematic trigger within a room and link them to an existing parent scene.

- A user can enter a building from the parent level, traverse multiple floors in graybox play mode and return with persistent item/door state.

- Regenerating one unlocked floor preserves locked rooms, connections and manually configured puzzle conditions.

- Export creates a coherent engine-specific graybox hierarchy and reusable intermediate manifest with stable object IDs.

## 17. Recommended Delivery Phases

| Phase | Scope / Exit Gate |
|---|---|
| MVP 1 — Authoring Core | Create structure, polygon footprint, floors, manual rooms/walls/doors/stairs, hierarchy and save/load. |
| MVP 2 — Generation | Seeded plan-first and path-first layouts, previews, constrained partial regeneration. |
| MVP 3 — Gameplay | Nested scene state, condition editor, puzzles, inventory/character library placement, validation. |
| MVP 4 — Graybox & Handoff | 2D/3D sync, rough play, Unreal/Unity/Godot intermediate-export adapters, incremental re-export. |
| V2 Enhancements | Advanced procedural themes, imported CAD plans, richer interactive library, cooperative editing and prefab marketplace hooks. |

## 18. Example: Pyramid Quest

Parent Level: Ancient Civilization → Scene: Enter Royal Pyramid → Structure: Pyramid A → Floor: Entry / Subterranean → Spaces: Entrance Hall, False Tomb, Hidden Shaft, Relic Chamber. Designer draws the spine route, auto-generates chambers, places a breakable wall and a ladder leading to the lower level, and gates the relic chamber behind a symbol puzzle. Finding a clue in the false tomb reveals the symbol; the player activates the mechanism, retrieves the relic and exits by an alternate tunnel. Completion updates the parent scene, while collected items and opened doors persist according to configured rules.

## 19. Explicit Product Decisions to Track

- Select whether initial V1 includes elevators with full moving-platform simulation or just navigable export placeholders (recommend placeholders).

- Choose export schema and minimum common gameplay contracts before engine-specific coding begins.

- Define authoritative ownership of geometry edits made in an external game engine (recommend VC Game Studio owns authored layout; explicit opt-in to adopt engine changes).

- Confirm which imported drawing/model formats should be prioritized after MVP (e.g., SVG/DXF for plans; glTF/FBX for models).

End of specification · VC Game Studio / Structure Creator · v1.0

