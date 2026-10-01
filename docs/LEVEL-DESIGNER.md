# Level Designer

The Level Designer is where the story gets a place to happen. It is built from
[`specs/level-designer-spec.md`](specs/level-designer-spec.md) (the source is
the `.docx` beside it). Open it with **LEVELS** in the top bar, **View ›
Levels**, or **Ctrl+L** (⌘L). From the story graph or a scene, it opens on the
items linked to what you had selected.

Version 2 of the spec, [`specs/level-designer-v2-spec.md`](specs/level-designer-v2-spec.md),
adds the scale above a level: worlds, regions and the maps inside them. See
*Worlds, regions and child maps* below.

## The screen (spec §2)

| Region | What it does |
| --- | --- |
| Navigator (left, top) | Every map, World › Region › Level › Building › Floor › Room (spec V2 §6). Click to see a map (on the map open now if it sits there, else it opens), double-click or ▸ to open it; search, favourites, each map's status, and ⋯ for a new map inside, rename, favourite, hide, lock, duplicate and delete. |
| Breadcrumbs (toolbar) | Where you are, from the top map down to the floor and the room selected; click one to go there, ↑ (or Alt+↑) for the parent map. |
| Toolbar | Level and floor pickers (with **+ New level** and **+ Floor above**), **2D map / 3D graybox**, the Select and Draw tools, overlays, snapping, **Frame**, and **Preflight**. |
| Library (left) | The starter catalog in every category in spec §4.2, plus the project's own assets and "my library". Drag an asset onto the map or the graybox, or click it and then click where it goes. Search matches names and descriptions. |
| Outliner (left, second tab) | Everything on this floor by layer. Each layer can be hidden; each item can be hidden or locked. |
| Map / graybox (middle) | The same items drawn top-down or in 3D. A status line shows the pointer's position and the selection's name, export name, GUID and size. |
| Inspector (right) | The authoritative place to edit (spec §6). With nothing selected it shows the level: its floors, story links, units, grid and naming. With several items selected it shows align, distribute, rotate, mirror, group, duplicate, save to library and delete. |

## Worlds, regions and child maps (spec V2)

Start big and work in (spec V2 §2). **+ World** in the navigator, **+ New
world…** in the level picker, or **+ Start with a world** on an empty
project opens the world presets (spec V2 §3): a small world or region (10 km),
a medium world (40 km), a large world (100 km), or custom, with its width,
depth, grid and origin. Nothing is an engine limit, and the size can change
later.

- **The hierarchy (spec V2 §4):** every map is a World, Region, Level, District (town, city, dungeon, compound), Building or Interior. It is the designer's word, not a rule: a city can be a Level, a Level can sit straight in a World, and a map needn't be part of anything. A map's **Map** section in the inspector sets what it is, what it is part of, and moves it (never into itself).
- **Child maps:** select anything on a map and **Open as a map ▸** (or double-click an item that already opens) makes it a map of the next scale down, named after it and the size it is there; the item is marked **▸** with the map's name. Resize the item and the map follows, so the scale is the same at every depth (spec V2 §12); a map can also have a size of its own. A room opens as an interior; a building's map gets its floors in the inspector.
- **Scale (spec V2 §12):** lengths are metres inside; the map reads kilometres (or miles) once a distance is that long. Each map has its own snap grid (a world snaps in hundreds of metres, a room in fractions of one), and its own origin, so detail is never drawn at huge coordinates. The map's edge is drawn, and an empty map frames it.
- **How it is reached (spec V2 §13):** Continuous, Streamed, Instanced, Loaded by transition or Map only. The preflight only asks for a player start where the game loads a map on its own: not a world or region, not a map only for planning, not a building the player walks into from its parent.
- **Status (spec V2 §6):** Empty, Grayboxed, Detailed, Gameplay complete or Final: worked out from what is on the map (spaces and solids, then props and lights, then a player start and something to do), or set by hand.
- **The world map (spec V2 §5):** the library's **World + regions** (Region, Biome / terrain zone, Streaming boundary, Destination, Landmark, Level entrance, Travel node) and **Towns + structures** (City / town, Dungeon, Compound, City block, Road, Terrain, Vegetation proxy, Town wall, and building masses: Building mass, House, Shop, Tower, Castle section, Temple, Pyramid, Dungeon module). Destinations and landmarks are classed Level, Area, Hub, Landmark, Transition or a custom type, shown beside their names; a place that opens says what as (**Opens as**), and double-clicking it opens it.
- **Routes (spec V2 §5, §13):** the **Route** tool (T) draws roads, trails, rivers, routes, progression paths, fast travel, doors, elevators, portals, cinematics and loading transitions. Click the place it starts at (or a point), the points it passes, and the place it ends at; Enter or a double-click ends it on a point, Backspace takes one back, Escape drops it. Its ends follow the places they are tied to; a deleted place leaves the end where it stood. Selected, its points can be dragged and the inspector sets its kind, name, transition (walk, ride, sail, fade, cinematic, loading screen, instant), one way, another map it takes the player to, and a lock with the rule that opens it. Each kind is drawn its own way: roads wide, trails dashed, rivers blue, fast travel dotted, locked routes red with 🔒.
- **Buildings (spec V2 §8):** a building mass (House, Shop, Tower, Castle section, Temple, Pyramid, Dungeon module, or a plain Building mass) says how many **Floors** it has and how tall each is. Opened, its building map starts with those floors, its footprint the mass's. The two stay in step: add, remove or resize a floor in the building and the mass on the town map counts it and grows or shrinks to fit; raise the mass's Floors and the building gets the floors it lacks (lowering it takes none away, as rooms may be on them: remove floors in the building). 2D and 3D are the same items at every scale, and the 3D view's reach, fog, grid and shadows grow with the map, so a world or a town can be seen in 3D as well as a room.
- **Rooms (spec V2 §2, §7):** **Detail this room ◎** in a room's inspector (or a double-click on the room in the navigator, or its name in the breadcrumbs) frames it and dims the rest of the floor, which stays put; the library turns to what goes in a room (furniture, lights, props, things to use, puzzles, loot, doors, triggers, NPCs), and the breadcrumbs show the room. **×**, **Back to the whole floor** or Alt+↑ leaves it. A room can also be opened as its own interior map.
- **Tools for the scale (spec V2 §7):** the library shows a world's tools on a world or region, a town's in a district, rooms, architecture and furniture in a building or interior, and everything but the world's on a plain level; **Show everything** (or a search) shows the rest. New room presets: Square room, Corridor, Hall, Lobby, Warehouse, Cave chamber (outlined).
- **Safety (spec V2 §15):** deleting a map lists the maps inside it and how many items go with them; deleting an item that opens into a map says the map stays, no longer tied to a place. A locked map turns changes to its items down. Every change is one undo step.

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
- **Handles** on the selected item, from the tools beside 2D and 3D:
  - **Size:** a gold handle on each face. Drag a side out or in and the opposite side stays put; drag the top to change the height. On an outlined space or volume each wall has a handle, pushing or pulling that one wall (extrude).
  - **Move:** arrows along the world's axes, or the item's own (**Its own axes**), for a move in one direction only. Dragging the item itself still moves it freely.
  - **Pivot:** drag the point it turns about and grows from. It settles on a corner, an edge's middle or the centre when near one. The inspector's **Pivot** picks one of those too, and the map marks it. Turning (R, the rotate handle, the inspector's rotation) and resizing keep the pivot where it is. It's for editing only: engines still get the item's centre.
  - Sizes and moves snap to the grid, and each drag is one undo step.
- **Collision** outlines in red everything the player bumps into and stands on, seen through walls.
- **Walkable** shows where the player can stand: green where they can walk to from the player start, amber where they can't.
  - Doors and state gates count as open.
  - A step is climbable up to 42 cm, and a drop down to 4 m.
  - Ladders, elevators and traversal links join the floors beside them.
  - Doorways must be taller than the player (1.75 m).
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

**Updating a library asset (spec §4.3, §4.4).**
- **Save changes to *asset*** (in the inspector of an item placed from a project asset) makes that item's changes the asset's new defaults. The asset's version goes up, and the item goes back to inheriting everything.
- The asset keeps what each earlier version gave. Every other item placed from an older version is flagged, in the inspector and in preflight, until someone reviews it. Nothing it had is lost without being shown.
- The review lists:
  - each value it inherited that the new version changes, with a box to **keep the old** one as its own;
  - its own values the new version makes pointless (now the default), no longer valid (an option gone, out of range), or no longer has (a setting removed).
- **Update to v*n*** applies that. **Update all** brings every outdated item from the asset up to date, taking the new values.
- Every step is one undo.

**Scene timeline events in the level (spec §7.3).**
- An event on a scene's timeline can happen somewhere in the level. **Where in the level** in the event's inspector picks the item: the opening cinematic's trigger, the NPC who speaks, the lever being pulled, the door out. An action can also say where an actor **moves to**.
- Without a choice, the place is found through the level's links: a cinematic at the trigger that plays it, dialogue at the NPC who stands for its speaker, an interaction at the item linked to its object.
- Events with a place show ⌖ on the timeline. **Locate** opens the Level Designer on the item.
- An item's inspector lists **On scene timelines**: the events that happen there, each opening its scene.
- Places go to every engine as the item's GUID (`place`, `placeTo` on the event). Removing the item takes the place off the event.

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
- **Keyboard and mouse:** WASD or the arrows to move, the mouse to look, Shift to run, Space to jump, **C** or Left Ctrl to crouch, **L** for the light, **E** to use what's in reach, **R** to use what's in hand, **I** for the gear screen. Click the view to capture the mouse; Esc gives it back. Without pointer lock, dragging looks around.
- **Controller:** the left stick moves, the right stick looks, A jumps, X uses, the right stick's press crouches, the right bumper works the light, the right trigger uses what's in hand, the left trigger opens the gear screen and Start pauses.
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
- **Patrols (spec §11):** an NPC, enemy or neutral actor whose **Patrol** names a patrol walks the **Patrol nodes** of that name (Actors) in their **Order**, at its **Speed**, waiting each node's **Wait** at it, round and round. They walk straight from stop to stop: there is no pathfinding, so lay a patrol out with a clear line between its stops. Talk to someone on a patrol where they are. The map draws each patrol as a dashed loop, its stops numbered, and the preflight warns of a Patrol that names no nodes.
- **Crouching:** held, it lowers the player to 1.1 m, at under half pace, with no jumping. Let go under something low and the player stays down until there is room to stand. The preflight flags only doors lower than a crouching player.
- **Darkness (spec §6):** a **Darkness** zone (Logic) darkens the view by its **Dark** percent while the player is in it. With **Needs light** on, what is in it can't be used in the dark: it says "Too dark to see", and what the light needs.
- **The player's light:** the player start's **Light** names what lights it, a story item carried or a mechanic available; **Light fuel** is how many seconds it burns (0 for ever) and **Light range** how far it reaches. **L** turns it on, if the player has what lights it and fuel is left; the HUD shows the fuel, and the light goes out when it runs out or its source is gone. A rule's **Refill the light of** action fills it up again.
- **Companions:** a companion that **Follows the player** keeps within its **Follow distance**, walking at its Speed (faster when far behind). More than 12 m behind, or on another floor, it catches up at once, behind the player.
- **Gear, skills and crafting (spec §8):** the **Gear** button (or **I**) pauses on the gear screen: the story's Equipment, Skills and Crafting panels, as in the story play-through. Equip, use or put away what is carried, learn a skill and craft by the same rules; each says what it did ("Equipped Diving Knife", "Crafted 2 × Flare") or why not, on screen and in the event log, and the level's rules waiting on the story get their turn (a stat condition, say). The HUD shows what is in the **Hand** slot, its ammunition and uses left; **R** uses it (the knife wears out and breaks, the flare pistol burns flares).
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

**Patrols and companions** go to every engine as each actor's `motion`: a
patrol's stops in order (level positions, with their waits) or a companion's
follow distance, with its speed. Each runtime moves them by the same rules as
Play Mode (the engines' checks find the sample's Mara at the same place after
five seconds as Play Mode does):
- **Godot:** `VCGSLevel` moves the actor's node each frame (`actors` holds the poses; `step_patrol` and `step_follow` are the rules). Companions follow the node in the "player" group, or `player`.
- **Unity:** `LevelLogic.Poses`, moved by `Tick`; `VcgsLevel` puts each GameObject there, and tells the logic where its `player` (or the GameObject tagged Player) is.
- **Unreal:** `vcgs::LevelLogic::Poses`, moved by `Tick`; `AVcgsLevelDirector` sets each actor's location and rotation, and follows the player pawn.
- **JSON:** the `motion` object, described in the schema.

**Darkness and the light** go over as the level's `light` (what lights it, its fuel and range, from the player start) and each item's `in_dark` (the darkness zones that need light and hold it). Each runtime runs the light as Play Mode does: turning it on needs its source and fuel, it burns while lit, a `refuel` action fills it, and an item in the dark can't be used until it is lit. The checks take the sample's lantern, find the Squeeze 0.96 dark, burn ten seconds of oil and have Mara top it up.
- **Godot:** `VCGSLevel.toggle_light()`, `darkness()`, `light_on`, `light_fuel` and the `light_changed` signal. `play_<level>.tscn`'s player turns it on with L, crouches with C or Ctrl, darkens the screen and carries a lamp.
- **Unity:** `LevelLogic.ToggleLight()`, `Darkness()`, `IsLit`, `LightFuel` and `LightChanged`; bind them to your input and lights.
- **Unreal:** `AVcgsLevelDirector::ToggleLight()`, `Darkness()`, `IsLit()`, `LightFuel()`, `LightRange()` and `OnLightChanged`, for Blueprints; crouching is the character's own.

**Gear, skills and crafting** in the level work the same everywhere: a gear menu in Play Mode's order (each item of equipment carried, Use and Put away when equipped or else Equip, then each skill, then each recipe, each with why not), its text ("GEAR", then each option numbered, why not in brackets), doing one by the story's rules with the studio's words, and using what is in the Hand slot.
- **Godot:** `VCGSLevel.gear_menu()`, `gear_text()`, `gear_do(act, key)`, `in_hand()` and `use_in_hand()`, said through `message_shown`. `play_<level>.tscn`'s player uses what is in hand with R, and shows the gear screen with I (1-9 do its options).
- **Unity:** `LevelLogic.GearMenu()`, `GearText()`, `GearDo(act, key)`, `InHand()` and `UseInHand()`, said through `Message` (and on `VcgsLevel`); bind them to your input.
- **Unreal:** `AVcgsLevelDirector::UseInHand()`, `InHand()`, `GearText()`, `GearPick(index)` and `GearDo(act, key)`, for Blueprints, said through `OnMessage`.

A freeform space's floor and ceiling go over as a **slab**: the outline raised to its thickness, with its triangles.
- **Godot:** a `CSGPolygon3D`, colliding through a `ConcavePolygonShape3D` of its faces.
- **Unity:** a mesh saved under `Levels/Meshes`, with a `MeshCollider`.
- **Unreal:** the item keeps its slabs as data (`FVcgsSlab`) and builds them into a procedural mesh whenever it is constructed. The plugin now depends on Unreal's ProceduralMeshComponent plugin.
- **JSON:** a `slab` piece with `outline` and `triangles`, and the space's own `outline`.

A freeform volume goes over as a `volume` piece of shape `slab`. Engine triggers must be convex, so it is built from one upright prism per triangle.
- **Godot:** convex shapes under the volume's `Area3D`; Godot reports entering and leaving across all of them.
- **Unity:** convex trigger `MeshCollider`s on the item. The item counts overlaps, so crossing from one prism to the next isn't an exit and an entry.
- **Unreal:** the item keeps its outline as `Zones` and builds convex trigger collision on a `Zone` component; the director listens to it as it does to the box.
- A blocking state gate is solid as well as a trigger, box or outline: Godot gets a static body, Unity a collider under the item's `Collision`, and Unreal an unseen solid piece or slab. It stops blocking once it leaves the level, like any item.

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

**Files changed in the engine.** Before sending to a folder, the studio
reads what is there and shows a review of each file that would change, with
its diff. A file changed in the engine since the last export (outside its
custom code region: see ENGINE-ADAPTERS.md) is flagged, and you choose to
overwrite it or keep the engine's version; nothing is replaced silently. If
you keep a file, it is pointed out again next time. Code in a generated
script's custom region is always kept.

## The sample

*The Sunken Vault* (**File › New from the sample**) includes a level:
- **Spaces:** the Cave Mouth, the Squeeze, the Silt Camp and the Vault Chamber, each linked to its scene. The Cave Mouth is open ground with an irregular outline, and the Vault Chamber has its corners cut. So does its Dripping echo ambient zone.
- **The Bronze Door:** needs the Vault Key and stays until the puzzle is solved.
- **The Vault Key:** a pickup that gives the story's key.
- **The Rusted Lever:** an interaction that sets the lever up.
- **The flooded seam:** gone once the lever is up.
- **The cinematic trigger:** plays *Door in the dark* on the way in.
- **People and lighting:** Mara, pacing the Cave Mouth on the *Cave watch* patrol (two stops, a wait at each), a player start, lights, a camera marker and an ambient zone.
- **The Crawlway** into the Squeeze is 1.3 m high: crouch to get through.
- **The dark:** the player start's light burns Lantern oil, 90 seconds of it. Take the **Lantern** at the Cave Mouth to light it (it makes Lantern oil available); the **Squeeze dark** zone makes the Squeeze 96% dark; talking to Mara fills the lantern again.

Its preflight is clean.

## How it is built

| Path | What it is |
| --- | --- |
| `model/level/travel.ts` | Spec V2's travel links: kinds, transitions, drawing, ends that follow their places, locks and the rule that opens them (`canTravel`). |
| `model/level/hierarchy.ts` | Spec V2's hierarchy: world presets, map kinds, boundaries and statuses; child maps from items, paths (breadcrumbs), bounds, per-map grids, moving, duplicating and deleting maps, and the navigator tree. |
| `model/level/types.ts` | The entities in spec §13: `LevelSet` (settings, levels, items, project assets, serial counters, manifest), `Level`, `Floor`, `LevelItem` (the asset instance), `AssetDefinition`, `LevelRule`, `LevelAction`. Stored in `Project.levels`. |
| `model/level/library.ts` | The starter catalog. Each asset has a kind, a role, a naming class, default size, proxy shape, parameters grouped by inspector section, and hints for the Godot, Unity and Unreal mappings. |
| `model/level/level.ts` | Every edit, as a pure function returning a new project. |
| `model/level/geometry.ts` | Frames, walls, openings, nearest wall, and `meshesFor`, which turns a level into engine-neutral graybox pieces. The map, the graybox and (next) the exporters all draw from it. |
| `model/level/nav.ts`, `migrate.ts`, `places.ts` | The walkable preview and what can't be reached; library version review; where timeline events happen in the level. |
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
| §4 Asset library | Done: every category, definitions and instances, overrides with reset, project assets, assemblies, my library. Updating an asset from an item, and reviewing items from older versions, keeping old values or taking new. |
| §5 3D graybox | Done: box, plane, cylinder, sphere, wedge, stairs and ramps; walls with openings; move (free, or along world or local axes), resize and extrude faces and outline walls, pivots, hosted assets that follow their wall, collision and walkable previews. |
| §6 Inspector | Done, including search and "More" for advanced fields. |
| §7 Narrative | Done: links both ways, conditions from choices and state, and scene timeline events placed in the level. |
| §8 Logic, spawns | Done: rules, conditions, story effects and level actions run in Play Mode; spawners spawn after their delay, conditionally. Placed actors walk their patrols and companions follow the player (§11 of the Game Studio spec), in Play Mode and every engine; spawned actors stand where they spawn, and nothing paths around walls. |
| §9 Play Mode | Done: first person, third person and top-down; keyboard, mouse and controller through rebindable actions; collision, gravity, jumping, stairs; pause and inspect with editable state; test presets; start from the level start, the selection or the 3D camera; debug overlay; event log; notes linked to items. Scenes linked to characters show as cards rather than playing their script in the level. |
| §10 Identity and names | Done. |
| §11 Engine handoff | Done: Godot, Unity, Unreal and JSON (see *Sending a level to an engine*). Checked in Godot 4.3, and against Unity and Unreal stand-ins (C#, C++ with g++ and clang, and the Python builder). |
| §12 Preflight | Done, including what can't be reached from the player start, doorways lower than the player, items from older library versions, engine-specific checks (roles an engine gets as data only, wedges in Unreal, locked art with no final asset) and files changed in the engine since the last export. |
| §14 Undo, persistence | Done: every edit is one undo step, GUIDs survive save, load, duplicate (which gives new ones), rename and re-export, and the data is plain JSON in the project file. |
| §19 Future | Not started, as the spec says. |

Against spec V2:

| Spec V2 | Status |
| --- | --- |
| §3 Scale presets | Done: small, medium, large and custom, editable. |
| §4 Hierarchy | Done: kinds, parents, child maps from items, moving between parents. |
| §6 Navigator | Done: tree to rooms, breadcrumbs, search, favourites, status, hide, lock, rename, duplicate, move (the Map section's *Part of*), delete with a warning. |
| §11–§12 Map properties, scale | Done: extent, origin, grid, boundary, environment and navigation words; kilometres at world scale. |
| §5 World map | Done: regions, biomes, streaming boundaries, destinations classed Level/Area/Hub/Landmark/Transition/custom, landmarks, entrances, travel nodes, towns, dungeons and structures; routes of every kind; opening a place by double-click. Background images come with §10. |
| §7 Context-sensitive tools | Done for world, town, level, building and room scales. |
| §8 2D-to-3D | Done: building masses open into their floors and stay in step with them; rooms detailed in place or opened as interiors; the 3D view at every scale. |
| §9 Presets | Done: rooms (square, corridor, hall, stairwell, lobby, warehouse, arena, cave chamber), structures (house, tower, castle section, shop, temple, pyramid, dungeon module, city block, building mass), furniture and props, all parametric. |
| §13 Boundaries and travel | Done in the studio: boundaries per map, travel links with kinds, transitions, locks and prerequisites. |
| §10, §14, engine export | Next: reference images and personal models, puzzle overlays, and the hierarchy and routes in the engines. |
