<!-- Converted from level-designer-v2-spec.docx. The .docx is the source. -->

# VC Game Studio - Level Development Spec V2

Hierarchical world, region, level, building, interior, and 2D/3D gray-box level design system


## 1. Purpose

- Level Designer V2 should let a designer begin with a large world and progressively drill down into playable spaces without losing spatial context. The workflow moves from an abstract world/treasure map to regions and levels, then to cities, buildings, floor plans, rooms, props, interactions, puzzles, and final 3D spaces.

## 2. Core Design Principle: Big to Small

- Create or select the overall World.
- Place Regions, Destinations, travel paths, landmarks, and level entrances on the World Map.
- Open a Region or Level to work at a more detailed geographic scale.
- Gray-box cities, towns, compounds, castles, pyramids, dungeons, and other gameplay areas.
- Open an explorable building or structure and define its floors and floor plans.
- Open individual rooms and populate them with doors, furniture, props, puzzles, NPC positions, triggers, and other gameplay objects.
- Switch between 2D planning and 3D visualization at the appropriate scale.

## 3. World and Map Scale Presets

- The user may enter exact dimensions, but the application should provide practical starting presets. Presets are editable and should not impose engine limits.
| Preset | Example Size | Typical Use | Behavior |
| --- | --- | --- | --- |
| Small World / Region | 10 km x 10 km | One city, island, valley, district, or discrete travel map | Often used as a self-contained level or region. |
| Medium World | 25-50 km x 25-50 km | Several towns/biomes/major destinations | Supports multiple nested levels and travel routes. |
| Large World | 100 km x 100 km | Large open world / broad campaign geography | Encourages region subdivision, streaming boundaries, and nested maps. |
| Custom | User-defined | Any project | Designer specifies width, depth, units, origin, grid, and scale. |

## 4. Nested Spatial Hierarchy

- Recommended default hierarchy:
- Project / Game
- World
- Region or Area
- Level / Destination
- District, Town, City, Dungeon, Compound, or Landmark
- Building / Structure / Exterior Site
- Floor
- Room / Interior Space
- Object / Prop / Smart Object / Trigger / Puzzle Element
- The hierarchy must remain flexible. A designer can define a city as a Level, place several Levels inside a single continuous World, or use separate regional maps that load independently. The tool should not force one definition of 'level.'

## 5. World Map / Treasure Map Screen

- Broad, readable map rather than a cluttered construction view.
- Place Regions, Levels, cities, landmarks, castles, pyramids, dungeons, portals, travel nodes, and other destinations.
- Draw roads, trails, rivers, routes, fast-travel connections, locked routes, and progression paths.
- Allow locations to be classified as Level, Area, Hub, Landmark, Transition, or custom type.
- Click or double-click a map node to enter its child map.
- Show parent/child relationships and optional connectors between destinations.
- Optional background map/image import for tracing an existing design.

## 6. World/Level Navigator Tree

- Persistent left-side hierarchy tree showing World > Region > Level > Building > Floor > Room.
- Expand/collapse branches without leaving the current editor.
- Selecting an item highlights its location on the broader map.
- Breadcrumb navigation at the top of the workspace.
- Search, filter, favorites, visibility toggles, lock/unlock, duplicate, rename, move, and delete.
- Status indicators for empty, gray-boxed, detailed, gameplay-complete, and final areas.

## 7. Context-Sensitive Editor Screens

- Menus and asset libraries should change automatically based on the current spatial layer.

### World / Region Mode

- Regions
- terrain zones
- travel routes
- major landmarks
- level entrances
- biomes
- streaming/loading boundaries

### City / Level Mode

- roads
- blocks
- building masses
- walls
- terrain
- vegetation proxies
- encounter zones
- spawn areas

### Building / Floor Mode

- floor-plan tools
- walls
- doors
- stairs
- elevators
- rooms
- windows
- vertical connections

### Room / Detail Mode

- furniture
- lights
- props
- interactive objects
- puzzle objects
- loot
- doors
- triggers
- NPC markers

## 8. 2D-to-3D Gray-Box Workflow

- 2D map is the fastest planning surface for placement, dimensions, adjacency, routes, and floor plans.
- Any 2D room/building proxy can have a corresponding 3D proxy representation.
- Switch to 3D without rebuilding the layout.
- Changes to dimensions or placement should synchronize between compatible 2D and 3D representations.
- A building can initially be only a gray box. Opening it creates a child building/floor-plan workspace.
- Rooms may remain abstract until the designer chooses to detail them.

## 9. Preset Asset Library

- Prebuilt proxy rooms: square room, corridor, hall, stairwell, lobby, warehouse, arena, cave chamber, etc.
- Prebuilt structures: house, tower, castle section, shop, temple, pyramid chamber, dungeon module, city block, and configurable primitives.
- Furniture and props for room-scale blocking.
- Each preset has editable parameters rather than being a fixed mesh.
- Drag-and-drop from library into 2D or 3D views.
- Assets may include snap points, doors/openings, collision proxy, traversal metadata, and category tags.

## 10. Personal Asset Library and Import

- Import existing level maps, floor plans, heightmaps, reference images, and supported scene/geometry data.
- Import user-owned proxy 3D models into a separate Personal Assets library.
- Store thumbnails, dimensions, source file, category, tags, default scale, pivot/origin settings, and collision settings.
- Allow imported assets to be reused across projects where licensing permits.
- Provide unit/scale conversion on import to avoid incorrectly sized geometry.

## 11. Right-Hand Properties Inspector

- Context-sensitive properties for the selected World, Region, Level, Building, Room, or Object.
- Transform: position, rotation, scale, width, length, height.
- Classification, tags, parent, child links, gameplay state, visibility, lock state, and notes.
- For parametric presets: room dimensions, wall thickness, floor height, openings, number of floors, door/window placement, etc.
- For map areas: physical dimensions, coordinate origin, grid spacing, streaming/loading behavior, environment profile, and navigation settings.

## 12. Scale and Coordinate Handling

- Use real-world units internally, with meters as the default authoring unit.
- Display kilometers automatically for world-scale measurements and meters/centimeters for local detail.
- Every child map stores its relationship to its parent map.
- Provide a local origin for detailed areas so designers are not forced to manipulate huge coordinate values.
- Engine exporters should translate the authored hierarchy into the destination engine's preferred world/scene/streaming structure.

## 13. Level Boundaries and Travel

- A location may be Continuous, Streamed, Instanced, Loaded by Transition, or Map-Only.
- Travel connectors can represent roads, doors, elevators, portals, fast travel, cinematics, or loading transitions.
- A destination may exist physically inside the parent world or function as a separate loaded map.
- Designers can define prerequisites and locks on travel connections.

## 14. Puzzle and Gameplay Integration

- Rooms and areas can contain links to Puzzle Creator definitions.
- Puzzle entry points, required objects, clue locations, completion gates, and success outputs can be visualized in the level.
- Interactive objects placed in a level can be bound to puzzle nodes without duplicating logic.
- Completed puzzle states can unlock doors, routes, cinematics, inventory items, state changes, or new levels.

## 15. UX Requirements

- A new user should be able to choose a world preset and place the first destination within minutes.
- Always show where the user is in the hierarchy using breadcrumbs and the navigator tree.
- Use progressive disclosure: world tools at world scale; room tools at room scale.
- Provide Back to Parent Map and Open Child Map commands.
- Autosave hierarchy changes and warn before deleting an object that owns child maps.
- Support undo/redo across placement, hierarchy, and parameter changes.

## 16. Suggested Data Model

- SpatialNode: id, type, name, parentId, transform, bounds, scaleProfile, metadata.
- MapDocument: nodeId, dimensions, unitSystem, coordinateOrigin, background/reference data.
- AssetInstance: assetId, transform, parameterOverrides, interactionBindings.
- TravelLink: sourceNode, destinationNode, linkType, prerequisites, transition behavior.
- ChildMapLink: parent object to detailed child map relationship.
- EngineExportProfile: Unity / Unreal / Godot mapping rules and project-specific overrides.

## 17. Acceptance Criteria

- User can create a world from a preset or custom dimensions.
- User can place a city/region/level on the world map and open it as a child map.
- User can gray-box buildings in 2D, view them in 3D, and open an explorable building into floor/room maps.
- Contextual libraries change appropriately as the user drills down.
- User can import a map and personal proxy assets.
- Tree navigation and breadcrumbs preserve orientation at every depth.
- Scale remains consistent when moving between world, city, building, and room views.
- Puzzle objects can link to Puzzle Creator logic.
- Project can retain enough hierarchy and metadata for later Unity, Unreal, and Godot export.
