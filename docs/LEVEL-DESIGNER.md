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

## The sample

*The Sunken Vault* (**File › New from the sample**) includes a level:
- **Spaces:** the Cave Mouth, the Squeeze, the Silt Camp and the Vault Chamber, each linked to its scene.
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
| `model/level/naming.ts`, `validate.ts`, `links.ts` | Export names, preflight, and story links (including clean-up when story elements are deleted). |
| `components/level/` | `LevelDesigner`, `LevelMap` (SVG), `Graybox` (three.js, loaded on demand), `LevelLibrary`, `LevelInspector`. |

Coordinates are metres. A plan position (x, y) is the item's centre seen from
above, x east and y south; in 3D that is (x, z) with y up. Rotation is
clockwise seen from above.

## Status against the spec

| Spec | Status |
| --- | --- |
| §2 Workspace | Done. |
| §3 2D map | Done: spaces, grid, snap, align, distribute, rotate, duplicate, mirror, groups, layers, hide and lock, floors with a ghosted floor below, units, dimension labels, symbols. **Freeform (non-rectangular) boundaries are not done yet**: spaces are rectangles. |
| §4 Asset library | Done: every category, definitions and instances, overrides with reset, project assets, assemblies, my library. The migration step that applies a changed definition to old instances is recorded (versions) but not yet offered in the UI. |
| §5 3D graybox | Box, plane, cylinder, sphere, wedge, stairs and ramps; walls with openings; move, rotate and scale, and hosted assets that follow their wall. Moving in 3D is done. **Not yet:** resize handles in 3D, pivot editing, extrude, and collision or navigation preview beyond showing the volumes. |
| §6 Inspector | Done, including search and "More" for advanced fields. |
| §7 Narrative | Links both ways, conditions from choices and state. The Scene timeline does not reference level objects yet (§7.3). |
| §8 Logic, spawns | The rule model and editor, spawn parameters and radius preview are done. They run in Play Mode, which is next. |
| §9 Play Mode | **Next.** A first-person, third-person or top-down walk through the graybox, running the rules, pickups, doors and triggers on the same state the story's play-through uses. |
| §10 Identity and names | Done. |
| §11 Engine handoff | **Next.** Levels go through the Godot, Unity, Unreal and JSON adapters using `meshesFor` and the GUID manifest; "final art locked" is already a per-item setting. |
| §12 Preflight | Done for everything the studio can know today. Engine-specific checks (unsupported properties, externally modified assets) arrive with the exporters. |
| §14 Undo, persistence | Done: every edit is one undo step, GUIDs survive save, load, duplicate (which gives new ones), rename and re-export, and the data is plain JSON in the project file. |
| §19 Future | Not started, as the spec says. |
