# Level Designer

The Level Designer is where the story gets a place to happen. It is built from
[`specs/level-designer-spec.md`](specs/level-designer-spec.md) (the source is
the `.docx` beside it). Open it with **LEVELS** in the top bar, **View ›
Levels**, or **Ctrl+L** (⌘L). From the story graph or a scene, it opens on the
items linked to what you had selected.

## The screen (spec §2)

| Region | What it does |
| --- | --- |
| Toolbar | Level and floor pickers (with **+ New level** and **+ Floor above**), **2D map / 3D graybox**, the Select and Draw tools, overlays, snapping, **Frame**, and **Preflight**. |
| Library (left) | The starter catalog in every category in spec §4.2, plus the project's own assets and "my library". Drag an asset onto the map or the graybox, or click it and then click where it goes. Search matches names and descriptions. |
| Outliner (left, second tab) | Everything on this floor by layer. Each layer can be hidden; each item can be hidden or locked. |
| Map / graybox (middle) | The same items drawn top-down or in 3D. A status line shows the pointer's position and the selection's name, export name, GUID and size. |
| Inspector (right) | The authoritative place to edit (spec §6). With nothing selected it shows the level: its floors, story links, units, grid and naming. With several items selected it shows align, distribute, rotate, mirror, group, duplicate, save to library and delete. |

## What you can do

**Map (spec §3).**
- Drag spaces from the library, or use **Draw** to drag one out to size.
- Select, move, resize, rotate and marquee-select:
  - Click to select; Shift-click adds to the selection.
  - Drag to move.
  - Drag the eight handles to resize: the opposite edge stays put and sizes snap to the grid.
  - Drag the round handle to rotate, in 15° steps (Shift for free rotation).
  - Shift-drag empty ground to select an area.
- **Floor below** shows the floor underneath, ghosted.
- **Sizes** labels the selected item's width and depth in the project's units (metres or feet).
- **Story** badges every space linked to a scene with its code (SC-01…) and joins them in story order.

**Spaces and volumes of any shape (spec §3.1).**
- **Outline** (O) draws a space corner by corner, snapped to the grid. Close it by clicking the first corner, double-clicking, or pressing Enter. Backspace takes back the last corner; Escape drops the outline. An outline whose edges would cross is not made.
- The picker beside the tools says what it makes: a room, hallway, stairwell, exterior zone or arena, or a volume (trigger, cinematic trigger, ambient zone, hazard, damage volume, wave or checkpoint). **Irregular room** in the library starts as an L.
- A freeform volume notices the player anywhere inside its outline, up to its height, in Play Mode and in every engine.
- A selected outlined space or volume shows a diamond on each corner and a dot in the middle of each wall:
  - Drag a corner to move it.
  - Drag or click a wall's dot to add a corner there.
  - Double-click a corner to take it out (three is the fewest).
- **Edit corners** in the inspector turns a rectangle into an outline; **Make rectangular** turns it back, keeping its bounds. The inspector shows the corner count, the floor area and the length around.
- Width and depth still work: they scale the outline. So do turning, mirroring and duplicating.
- Every wall is one edge of the outline. The floor and ceiling follow the outline out to the walls' outer faces. The 3D graybox, Play Mode and every export use the same shape.
- Doors and windows stay where they stood when corners move. Each goes into the nearest wall of the new outline.
- Preflight flags an outline that crosses itself (from a hand-edited file), a wall shorter than 25 cm, and spaces whose outlines overlap. Spaces overlapping only in their bounds, such as a room in an L's corner, are fine.

**Walls, doors and windows (spec §5.3).**
- A door or window dropped near a room goes into its nearest wall.
- Dragging a door slides it along its wall, or moves it to another wall.
- Doors follow when the room moves, resizes or mirrors.
- A door that stops fitting its wall is flagged in red, not deleted, and recovers once the wall is long enough again.

**3D graybox (spec §5.1).**
- Double-click anything on the map, or press **3**, to see it in 3D.
- Rooms become a floor slab, walls with the openings cut, and optionally a ceiling. Everything else becomes its proxy.
- Left-drag orbits, right-drag pans and the wheel zooms. Click selects; drag a selected item to move it across its floor.
- Library drops land on the floor under the pointer.
- Toggles show ceilings, every floor, and logic volumes (triggers, zones, spawn radii).
- three.js loads the first time 3D is opened. Without WebGL the view says so, and the map and inspector still do everything.

**One model (spec §5.2).** The map, graybox, inspector and outliner all read the same items. Changing a room from 20 × 30 to 30 × 40 in the inspector changes its footprint and its walls at once. Every edit, whether a drag, a typed value or a regeneration, is one undo step.

**Library values and overrides (spec §4.3).**
- A placed item stores only what it changes.
- Changed values show a gold dot and a ↺ that resets to the library's value.
- Setting a value back to the default counts as a reset.
- The inspector shows which library, and which version, the item came from.

**Save to library (spec §4.4).**
- One item becomes a template, with its changes as the new defaults.
- Several items become an assembly, placed as a group with new GUIDs. A room's doors are saved with it and go back into the new room's walls.
- **↑** promotes a project asset to *my library* on this computer. Placing one copies it into the project, so the file still opens elsewhere.

**The story (spec §7).**
- Any item or level can link to plot points, scenes, locations, characters, items, puzzles, cinematics, choices and dialogue.
- Ref parameters tie a pickup to its inventory item, an NPC to a character, a door to its key, and a cinematic trigger to its cinematic.
- From the level, a linked scene opens the scene and anything else opens the Bible.
- From the Bible or a scene panel, **In the levels** lists the items that use the element; each one opens the Level Designer on it.
- Deleting a story element says which level items lose their link, and the links are cleaned up.
- **Present only when** shows or hides an item by the same conditions the story uses (choices, flags, items, puzzles), so choices can open and close doors, paths, encounters and exits.

**Logic (spec §8).** Rules on an item run on enter, exit, interact, pickup, use, destroy, a timer, a story change, or a custom event. Each rule has:
- conditions ("Only if")
- story effects: the same effects the timeline uses
- level actions: open, close, enable, disable, spawn, despawn, start a scene, play a cinematic, play audio, activate an objective, go to a level

**Names and identity (spec §10).**
- Every item has a GUID that never changes.
- Its export name follows `TYPE_Context_Name_###`, for example `RM_SunkenVault_VaultChamber_004` or `INV_SiltCamp_VaultKey_001`. The context is the level for spaces, and the space an item stands in for everything else.
- The serial is fixed when the item is created, so deleting one item never renumbers the rest.
- The prefixes and the pattern are project settings; an item can also have its own export name.

**Preflight (spec §12).** The toolbar counts what would break in play or on export. Each entry says what the export would do about it and selects the item when clicked. It checks for:
- a missing player start
- duplicate export names, including names that only clash once an engine sanitises them
- links and references to deleted things
- doors that don't fit their wall, or aren't in one
- spawners with nothing to spawn
- pickups that aren't tied to an item
- actors that stand for no character
- cinematic triggers with no cinematic
- triggers with no rules
- overlapping spaces
- items whose library asset is missing

**Keys.**

| Keys | Action |
| --- | --- |
| **2** / **3** | Switch between the map and the graybox |
| **V** / **D** | Select tool / draw tool |
| **R** (Shift+R) | Rotate 90° (the other way) |
| Ctrl+D | Duplicate |
| Ctrl+G (Ctrl+Shift+G) | Group (ungroup) |
| Ctrl+A | Select everything on the floor |
| Arrows | Nudge by the grid (Shift: four steps) |
| **F** | Frame the selection |
| Delete | Delete, asking first when a room's doors would go with it |
| Esc | Put down what you picked up, then clear the selection |

## Play Mode (spec §9)

Press **▶ Play** in the toolbar, or **F5** (Shift+F5 plays from the
selection). Beside the button, choose where to start and what the story holds:
- **from the start** (the level's player start), **from the selection** (standing beside the selected item, or in the selected space), or **from the 3D camera** (where the graybox camera stands, dropping to the floor)
- **a fresh story**, or a **test preset** saved while playing
- the **perspective** (first person, third person or top-down), a project setting that can also be changed while playing (**V**)

**Controls.**
- **Keyboard and mouse:** WASD or the arrows to move, the mouse to look, Shift to run, Space to jump, **E** to use what's in reach. Click the view to capture the mouse; Esc gives it back. Without pointer lock, dragging looks around.
- **Controller:** the left stick moves, the right stick looks, A jumps, X uses and Start pauses.
- **Rebinding:** every action's keys and buttons can be changed in the pause panel's **Controls** tab, along with look speed, inverted look and the stick dead zone. These are kept on this computer.

**What happens.** The player is a capsule that walks, climbs steps and stairs,
slides along walls, falls off edges and stands on floors. Closed doors,
solids and blocking gates are in the way; doorways and open doors are not. A
door or window cuts every wall it sits in, so rooms that share a wall share
the opening.

The level runs on the same story state as the story's play-through, changed by
the same effects, with triggers and puzzles settling after every change:
- **Doors:** open and close; a locked door says what it needs, and opens with its key item.
- **Pickups:** give their inventory item.
- **Characters:** a linked scene starts, shown as a scene card.
- **Interaction points:** tied to a story object, they use it the way free play does.
- **Volumes:** notice entering and leaving. Cinematic triggers play their cinematic (with its shot list, skippable); checkpoints set where you come back; portals lead to another level, carrying the story with them; hazards and damage volumes hurt.
- **Spawners:** put their characters or items in the level, after their delay.
- **Rules:** run on enter, exit, interact, pickup, use, timers and story changes. Each is logged with its conditions and whether they held, then its story effects and level actions.
- **Present only when:** items appear and disappear as it comes and goes; in the sample, the flooded seam drains and the bronze door gives way once the lever is pulled.

**Test tools (spec §9.3).**
- **Pause** (Tab, P or Esc) opens the inspect panel:
  - what the player carries, every state and object state, puzzles, scenes seen, all changeable by hand
  - the level: objective, health, checkpoint, the volumes you're in, doors, spawned actors
  - **Save preset** keeps the story state to start from later
- **Event log:** every check (✓ or ✗) and everything that fired, newest first, filterable.
- **Notes:** record an issue against the nearest item or the level. Notes appear in the preflight and on the item's inspector until resolved.
- **Debug overlay** (F3): every item's name, export name and story links over it; volumes and markers drawn; the player's position and the volumes they're in; the last few log entries.
- **Game over** offers the last checkpoint, or starting again.

## Sending a level to an engine (spec §11)

Levels go with the story when you send to an engine from **Engine handoff**.
The handoff shows each level as a row, and says which items are new, changed
or removed since the last export. Every item keeps its GUID, so an engine
finds what it placed last time and updates it.

- **Godot 4:** `levels/<level>.tscn` has a node per item, with its graybox, its
  collision, its volumes (`Area3D`), lights and markers, and
  `metadata/vcgs_guid`. Its script, a `VCGSLevel`, runs the doors, pickups,
  volumes and rules against the story. Run `levels/play_<level>.tscn` to walk
  it; in your game, instance the level and put your player in the "player"
  group.
- **Unity 6:** `Levels/<level>.json`, the level runtime (`VcgsLevel`,
  `VcgsLevelItem`) and an editor builder. Open the scene the level belongs in
  and run **VCGS › Update level from data…**.
- **Unreal Engine 5:** `Levels/<level>.json`, the plugin's `AVcgsLevelItem` and
  `AVcgsLevelDirector`, and `build_level.py`. Open the map and run the script
  (**Tools › Execute Python Script**). Positions are in centimetres, X forward.
- **JSON:** `story.json` gains `levels`, described in `story.schema.json`.

A freeform space's floor and ceiling go over as a **slab**: the outline raised to its thickness, with its triangles.
- **Godot:** a `CSGPolygon3D`, colliding through a `ConcavePolygonShape3D` of its faces.
- **Unity:** a mesh saved under `Levels/Meshes`, with a `MeshCollider`.
- **Unreal:** the item keeps its slabs as data (`FVcgsSlab`) and builds them into a procedural mesh whenever it is constructed. The plugin now depends on Unreal's ProceduralMeshComponent plugin.
- **JSON:** a `slab` piece with `outline` and `triangles`, and the space's own `outline`.

A freeform volume goes over as a `volume` piece of shape `slab`. Engine triggers must be convex, so it is built from one upright prism per triangle.
- **Godot:** convex shapes under the volume's `Area3D`; Godot reports entering and leaving across all of them.
- **Unity:** convex trigger `MeshCollider`s on the item. The item counts overlaps, so crossing from one prism to the next isn't an exit and an entry.
- **Unreal:** the item keeps its outline as `Zones` and builds convex trigger collision on a `Zone` component; the director listens to it as it does to the box.
- A blocking state gate is solid only in Godot and in Play Mode, as before: the Unity and Unreal builders don't yet make any gate solid, box or outline.

**Who owns what.** VC Game Studio owns each item's place, name, collision,
graybox and data. The Unity and Unreal builders never touch final art, or
anything else you added in the engine:
- An item's **final asset** replaces its graybox.
- With **replacement locked**, re-export leaves the art alone.
- An item **moved in the engine** keeps its place, and the update lists it.
  Choose "VC Game Studio wins" (Unity) or set `VCGS_WINS` (Unreal) to put it
  back.
- **Removed items** are listed and left in place, for you to delete.
- Items whose revision hasn't changed are skipped.

**Files changed in the engine.** Before sending to a folder, the desktop app
checks the files it wrote last time. If one was changed since, it asks
whether to overwrite it or keep the engine's version; nothing is replaced
silently. If you keep a file, it is pointed out again next time.

## The sample

*The Sunken Vault* (**File › New from the sample**) includes a level:
- **Spaces:** the Cave Mouth, the Squeeze, the Silt Camp and the Vault Chamber, each linked to its scene. The Cave Mouth is open ground with an irregular outline, and the Vault Chamber has its corners cut. So does its Dripping echo ambient zone.
- **The Bronze Door:** needs the Vault Key and stays until the puzzle is solved.
- **The Vault Key:** a pickup that gives the story's key.
- **The Rusted Lever:** an interaction that sets the lever up.
- **The flooded seam:** gone once the lever is up.
- **The cinematic trigger:** plays *Door in the dark* on the way in.
- **People and lighting:** Mara, a player start, lights, a camera marker and an ambient zone.

Its preflight is clean.

## How it is built

| Path | What it is |
| --- | --- |
| `model/level/types.ts` | The entities in spec §13: `LevelSet` (settings, levels, items, project assets, serial counters, manifest), `Level`, `Floor`, `LevelItem` (the asset instance), `AssetDefinition`, `LevelRule`, `LevelAction`. Stored in `Project.levels`. |
| `model/level/library.ts` | The starter catalog. Each asset has a kind, a role, a naming class, default size, proxy shape, parameters grouped by inspector section, and hints for the Godot, Unity and Unreal mappings. |
| `model/level/level.ts` | Every edit, as a pure function returning a new project. |
| `model/level/geometry.ts` | Frames, walls, openings, nearest wall, and `meshesFor`, which turns a level into engine-neutral graybox pieces. The map, the graybox and (next) the exporters all draw from it. |
| `model/level/play.ts`, `controller.ts` | Play Mode's rules (doors, pickups, volumes, spawns, hazards, rules and actions, presets, notes) and the character controller. Pure functions, tested without a screen. |
| `model/level/naming.ts`, `validate.ts`, `links.ts` | Export names, preflight, and story links (including clean-up when story elements are deleted). |
| `model/handoff/levels.ts` | The levels in the handoff model: every item with its GUID, export name, position, turn, size, effective parameters, story links, rules, final art and graybox pieces, and a revision for each. `levelChanges` compares them with the last export. |
| `model/handoff/{godot,unity,unreal}-levels.ts` | Each engine's level files: runtime, scene or data, and the builder that places them. |
| `components/level/` | `LevelDesigner`, `LevelMap` (SVG), `Graybox` and `PlayMode` (three.js, loaded on demand), `PlayInspect`, `PlayControls`, `input.ts`, `LevelLibrary`, `LevelInspector`. |

Coordinates are metres. A plan position (x, y) is the item's centre seen from
above, x east and y south; in 3D that is (x, z) with y up. Rotation is
clockwise seen from above.

## Status against the spec

| Spec | Status |
| --- | --- |
| §2 Workspace | Done. |
| §3 2D map | Done: spaces as rectangles or freeform outlines, grid, snap, align, distribute, rotate, duplicate, mirror, groups, layers, hide and lock, floors with a ghosted floor below, units, dimension labels, symbols. Spaces and volumes can both be outlined. |
| §4 Asset library | Done: every category, definitions and instances, overrides with reset, project assets, assemblies, my library. The migration step that applies a changed definition to old instances is recorded (versions) but not yet offered in the UI. |
| §5 3D graybox | Box, plane, cylinder, sphere, wedge, stairs and ramps; walls with openings; move, rotate and scale, and hosted assets that follow their wall. Moving in 3D is done. **Not yet:** resize handles in 3D, pivot editing, extrude, and collision or navigation preview beyond showing the volumes. |
| §6 Inspector | Done, including search and "More" for advanced fields. |
| §7 Narrative | Links both ways, conditions from choices and state. The Scene timeline does not reference level objects yet (§7.3). |
| §8 Logic, spawns | Done: rules, conditions, story effects and level actions run in Play Mode; spawners spawn after their delay, conditionally. Spawned actors stand where they spawn (no AI or pathing). |
| §9 Play Mode | Done: first person, third person and top-down; keyboard, mouse and controller through rebindable actions; collision, gravity, jumping, stairs; pause and inspect with editable state; test presets; start from the level start, the selection or the 3D camera; debug overlay; event log; notes linked to items. Scenes linked to characters show as cards rather than playing their script in the level. |
| §10 Identity and names | Done. |
| §11 Engine handoff | Done: Godot, Unity, Unreal and JSON (see *Sending a level to an engine*). Checked in Godot 4.3, and against Unity and Unreal stand-ins (C#, C++ with g++ and clang, and the Python builder). |
| §12 Preflight | Done, including engine-specific checks (roles an engine gets as data only, wedges in Unreal, locked art with no final asset) and files changed in the engine since the last export. |
| §14 Undo, persistence | Done: every edit is one undo step, GUIDs survive save, load, duplicate (which gives new ones), rename and re-export, and the data is plain JSON in the project file. |
| §19 Future | Not started, as the spec says. |
