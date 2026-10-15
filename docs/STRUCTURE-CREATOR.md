# Structure Creator

Pyramids, temples, fortresses, offices, apartment blocks, factories, bunkers
and dungeons, each a mini-level inside a level (spec:
[`specs/structure-creator-spec.md`](specs/structure-creator-spec.md)).

A structure is a building map in the Level Designer, with more to it. Its
mass stands on the parent map. It opens as a map of its own, with every floor
from the basements to the roof, a footprint on each floor, and a structure
graph that checks every room can be reached. The 2D map, the 3D graybox,
Play Mode and the engines read the same rooms, doors and stairs as on any
other map (spec §3, §12). Nothing is kept twice.

## Phases (spec §17)

| Phase | What | Status |
|---|---|---|
| MVP 1: Authoring core | Structures from presets, footprints, floors from basements to the roof, rooms, walls, doors and stairs (the Level Designer's own), the structure graph, validation, save and load | **Built** |
| MVP 2: Generation | Seeded plan-first and path-first layouts, previews to accept or reject, locked rooms, regenerating part of a structure | **Built** |
| MVP 3: Gameplay | Door rules (one-way, timed, secret, breakable), the structure as a scene with objectives, completion and state that stays on re-entry, local and world states, items and characters placed in rooms, solvability (the key before its door, softlocks) and a walkthrough | **Built** |
| MVP 4: Graybox and handoff | Stacked floors, cutaways and the structure graph in 3D, rough play into a structure and back out, a structure manifest for Godot, Unity and Unreal, door rules and objectives in their runtimes, re-export by id | **Built** |
| V2: Enhancements | The structure library (levers, plates, gates, breakable walls, traps, chests…), procedural themes, CAD plan import, prefabs and marketplace hooks, cooperative editing | **Built** |

Much of what the spec asks for was already in the Level Designer. MVP 1
builds on it rather than beside it:

- Building masses (Pyramid, Temple, Castle section…) that open into building maps.
- Rooms of any outline, with walls and the doors and windows in them.
- Stairs, ramps, ladders and lifts, and the Walkable view.
- Room focus, reference images to trace, puzzle bindings and conditions.

## Adding a structure (spec §2, §5)

**+ Structure** in the Level Designer's toolbar (on any map but a world or
region) opens **New structure**. Pick a preset; each sets a size, the floors
above ground and below, a floor height, a roof, a footprint shape and how its
floors are reached:

| Preset | Size | Floors | Footprint | Between floors |
|---|---|---|---|---|
| Pyramid / tomb | 60 × 60 m | 3 up, 1 down, 6 m each, stepped in 8 m a floor | Rectangle | Anything climbable |
| Ancient temple | 24 × 36 m | 1 up (10 m), 1 down, roof | Rectangle | Stairs |
| Fortress / castle | 40 × 40 m | 3 up, 1 down, roof | U (an open yard) | Stairs |
| Modern office | 30 × 20 m | 5 up, 1 down (parking), roof | Rectangle | Step-free |
| Apartment block / hotel | 24 × 16 m | 6 up, roof | L | Stairs |
| Industrial facility | 40 × 30 m | 2 up (6 m), roof | Rectangle | Ladders and stairs |
| Underground bunker | 20 × 20 m | 1 up, 3 down | Rectangle | Ladders and stairs |
| Dungeon / ruin | 30 × 30 m | 1 up, 2 down | Cross | Anything climbable |
| Blank structure | 16 × 12 m | 2 up | Rectangle | Stairs |

Every value can be changed before it is made:

- the name;
- the width and the depth;
- the floors above ground and the basements;
- the floor height;
- the footprint (rectangle, L, U, cross or octagon);
- how far each floor up is drawn in (for a stepped pyramid);
- how its floors are reached;
- whether it has a roof;
- the scene it plays as.

Nothing is laid out yet: draw the rooms, or **Generate** them.

**Create structure** puts its mass where the map is in view, and opens the
structure on its ground floor.

**Pyramid A**, the spec's example (§18), comes out with these floors and
footprints:

| Floor | Code | Elevation | Footprint |
|---|---|---|---|
| Basement 1 | B1 | −6 m | 60 × 60 m |
| Ground floor | G | 0 m | 60 × 60 m |
| Floor 2 | 2 | 6 m | 44 × 44 m |
| Floor 3 | 3 | 12 m | 28 × 28 m |

Its mass on the level is 60 × 60 × 18 m, three storeys.

## Generating a layout (spec §6)

On a structure, **Generate** in the toolbar opens the generator under the
map. It proposes a layout from a seed, inside each floor's footprint. Every
room, corridor and door it makes is an ordinary Level Designer item,
editable like any other.

**Around the hallways.** Draw hallways first with the **Hallway** tool (see LEVEL-DESIGNER.md), then **Fill with rooms**, or choose the **Around the hallways** rules: the generator makes no corridors of its own and fills the floor with rooms round the ones drawn. Doors open onto the hallway first: every room with a wall on a hallway long enough for a door (1.4 m) gets its door there, through a pocket it took in if need be, and each room further in opens into the neighbour fewest doors from a hallway, so nobody walks through more rooms than they must. The same goes for the corridors the Linear, Branching and Hub rules make. The hallways count as one way round the floor, and the way in can go through one. The rooms beside a hallway sit flush against it whatever its width (an 8 ft hallway is off the 1 m grid): the grid lines along its sides move onto its walls, so those rooms, their neighbours and the doors between them all line up with it. A leftover pocket too small for a room of its own (and no room could widen into it as a rectangle) goes to the room beside it that shares the most wall with it: that room becomes an outline round both (an L, a T…), so there are no dead gaps between walls. This happens with every rule set, not only around hallways; a larger empty stretch (lower density) is left as it is.

**Pyramids.** A pyramid mass is a square pyramid in the graybox and Play Mode (seen from above, its edges run to the point), a four-sided point in Godot, a mesh of its own in Unity, and a cone in Unreal (which has no pyramid shape: the preflight says so).

**Floor by floor (a building with more than one floor).** Ticked by default, the generator asks for things in order:

1. **The way in.** **Set the entrance**, then click on the ground floor's outside wall (the footprint's edge) where it goes. A *Way in* pin marks it. The ground floor's entrance door goes on the nearest outside wall of a room, as close to the pin as it fits.
2. **The ground floor.** **Generate** lays it out from the way in. There is no stair core yet.
3. **The stairs.** Once the ground floor is accepted, the generator asks where the stairs go up: click there, inside the footprint. A *Stairs* pin marks it.
4. **Each floor in turn.** Floors go up to the roof, then down through the basements, each with **Generate**.
   - Every floor gets its own seed, so no two plans are alike.
   - Every floor's stair core (its stairwell) stands at the stairs pin, so the stairs line up through the whole building.
   - A floor is ready once the floor next to it, on the way back to the ground, is laid out.
   - As each floor is accepted, the stairs come up into it from the floor below: on the ground floor, in the room where you set them; above, in the stairwell. A step-free building also gets a lift beside them.

**Again** lays out a floor afresh. **Move it** and **Move them** reset the pins. Untick **Floor by floor** to lay out the whole structure in one go, as before.

**What to lay out (all at once):**

- the whole structure;
- this floor;
- inside a selected space or volume: a wing, or a generated room to divide up.

**Plan-first** lays out whole floor plates with a rule preset:

| Rules | What it makes |
|---|---|
| Linear | One corridor through the floor, rooms off it |
| Branching | A main corridor with side corridors off it |
| Hub and spoke | A central hall with corridors out to the walls |
| Maze | Rooms opening into rooms, with a few loops |
| Chokepoints | One way through, single doors, dead ends (survival horror) |
| Puzzle chain | Chambers one after another (Chamber 1, 2 …) with clue rooms off the chain |
| Open plan | A few large spaces joined by wide openings |

How plan-first lays out the floors:

- **Stair core.** A stair core stands at the same place on every floor laid out. It goes where the stairs of floors kept come up, or where a stairwell already is, else the middle. Stairs in it rise to the floor above.
- **Traversal style.** A step-free structure also gets a lift through every floor. A ladders structure gets ladders instead of stairs.
- **Ways in.** The ground floor gets its ways in on outside walls: a corridor first, the south side first.
- **Roof.** The roof is laid out as open roof areas round the stair house.
- **Density.** Density leaves part of each floor unplanned. At 100%, rooms grow to close the gaps between them, so neighbours share walls to put doors in.

**Path-first** builds round the route drawn on each floor. Draw it with
**Draw the route**, which switches to the Route tool for a **Progression
path**: click the way in, then each chamber along the way. Then:

- **Chambers.** Each point of the route gets a chamber. The first is the entrance (Entrance Hall in a pyramid), the last the final chamber (Relic Chamber).
- **Passages.** Passages join the chambers in route order: across, then along.
- **Dead ends and secret branches.** These go off chambers along the way. A secret branch is behind a **Secret door** (its Secret rule on, and tagged `secret`): the wall until the player searches it.
- **The way in.** It is through the first chamber. A passage is cut out to the nearest outside wall if the chamber doesn't reach one.
- **Between floors.** Where a chamber stands over a chamber on the next floor, a shaft with a ladder joins them.
- **Floors without a route.** These are left empty, and the generator says so.
- **Filling the rest.** **Fill the rest with rooms** fills the rest of each floor too.

**Preview, Accept, Regenerate, Reject.** A layout is a preview first. The map,
the 3D graybox and the structure graph show it, and editing waits.

- **Accept** keeps it in one undo step, records the run and makes its seed the structure's.
- **Regenerate** tries a new seed, unless **Keep the seed** is ticked.
- **Reject** drops it.

The same seed, settings and generator version always give the same layout.

**Your work stays (spec §3, §6).** A layout replaces only what an earlier
layout made and nobody has changed since. These are kept, and listed with
the reason:

- rooms and anything else placed by hand;
- locked items;
- generated items edited since: moved, resized, renamed, a door's settings changed;
- generated rooms holding something placed by hand.

New rooms are laid out round what is kept and joined to it by doors.

**Reported, never left broken.** The generator says what it couldn't do, for
example:

- a footprint too small for its rooms;
- a route point outside the footprint;
- no place for a stair core on every floor;
- floors whose chambers don't line up.

Anything it made that couldn't be reached is taken out again, not left disconnected.

**The record (spec §13 GenerationRun).** Each accepted layout is kept on the
structure, the last 20, with:

- its seed, its settings and the generator's version;
- the floors and area it laid out;
- what it kept;
- what it made, with a fingerprint of each item as made. An item that no longer matches its fingerprint has been changed by you.

Each generated item carries its run's id (`generated`).

## Procedural themes (spec V2)

A theme dresses a layout as somewhere. The Generate panel's **Theme** starts from the structure's type, and you can change it:

| Theme | Walls | Lights | Dressing |
| --- | --- | --- | --- |
| None | as drawn | none | bare rooms |
| Ancient tomb / temple | stone | flickering torches on the walls | sarcophagi, urns, altars, statues, inscriptions; traps in the passages |
| Gothic castle | stone | torches | long tables, armouries, bunks, cells, stores |
| Modern office | neutral | ceiling lamps | desks and chairs, meeting tables, server racks, reception |
| Residential | wood | ceiling lamps | beds, tables, shelves, front desks |
| Industrial | metal | harsh lamps | machines, pipe runs, crates and barrels, consoles |
| Sci-fi facility | metal | cold light | consoles, machines, med bays, quarters |
| Ruin / dungeon | stone | torches | sarcophagi, rubble, barricades, many traps |

What goes in a room depends on what the room is for: its name first (a Server Room gets racks and a console, a Crypt a sarcophagus), then its kind (room or corridor). A big room takes more.

**Ruin** and **Traps** set how much of it there is, from 0 to 100%; each theme has its own starting point.

- Ruin puts rubble in a room or a barricade across a passage. Both are breakable, so the player can clear them.
- Traps put a spike or dart trap in a room or passage. It fires in a cycle (2 to 4 seconds, active for 1).

**What dressing never does:**

- It never moves a wall. It uses its own random stream from the seed, so changing the theme leaves the layout exactly as it was.
- It never puts anything in a doorway, on the stairs, by a lift or ladder, or on top of something already there.

The same seed and theme always dress the same way.

**Dress rooms only.** Tick it to keep the layout and dress only the rooms. This works for rooms drawn by hand too:

- Lay out picks which rooms: the structure, this floor, or the selected room.
- What an earlier dressing put there is replaced, unless you moved, changed or locked it; then it stays, and the preview says so.
- Dressing with theme None takes it all out again.

Regenerating a layout leaves alone the dressing inside rooms that stay.

Everything dressing makes is tagged `dressing` and recorded as part of its run, like the rest of the generator's work. It goes to the engines like anything placed by hand: furniture as solids, lights with their colour and flicker, traps with their cycle.

## Importing a CAD plan (spec V2)

**Import plan** on a structure's toolbar puts a floor plan drawn elsewhere onto the floor in view. It reads:

- DXF, saved as text (ASCII), from AutoCAD, BricsCAD, LibreCAD or a Revit export;
- SVG, from Illustrator, Inkscape or any vector tool.

The file is read on this computer and never sent anywhere.

**What it reads.**

- DXF: lines, polylines (with their arcs), arcs, circles, text and multiline text, and block inserts (moved, scaled and turned, blocks inside blocks). It also reads the units the file says it is in (`$INSUNITS`).
- SVG: rects, polygons, polylines, lines, paths, circles and text. It follows each group's transform. A layer is an Inkscape layer or a group's id; the units come from the width (`2000cm` over a 2000-wide viewBox is centimetres).

Anything else (dimensions, hatches) is left out, and the dialog says so.

**Layers and their roles.** Each layer gets a role, guessed from its name; change any of them in the dialog:

| Role | Guessed from | Becomes |
| --- | --- | --- |
| Rooms | A-AREA, room, space, zone | a room for each closed shape, named by the text inside it |
| Walls | A-WALL, wall, partition | rooms too, when there is no Rooms layer; the biggest closed wall is then the outside, the footprint |
| Doors | A-DOOR, door, opening | a door for each swing (hinge and arc) or door block, in the nearest wall, as wide as the swing |
| Stairs | stair, step | stairs the size of the shape |
| Outline / footprint | outline, boundary, footprint | the floor's footprint, reshaped to it |
| Room names | text, anno, label | the names (text on any kept layer counts) |
| Leave out | furniture, dimensions, grid, hatch | nothing |

**Units.** The units are what the file says. If it doesn't say, they are guessed from its size: a plan 30 000 across is in millimetres. You can change them.

**Shapes.** Loose lines that meet end to end count as one shape, so a room drawn line by line still closes. A rectangle stays a rectangle; any other shape becomes an outlined room.

**The preview.** It shows:

- every kept line, coloured by its role;
- the rooms with their names;
- the doors;
- the plan's size, and how many rooms, doors and stairs it found.

**Importing.** Import is one change, so Undo takes it all back. North stays up, and the plan is centred on the structure. Everything imported is tagged `cad`.

Problems are reported rather than left broken, for example:

- a door found on no room's wall (within a metre and a half) is left out;
- a room outside the footprint is named;
- a shape that crosses itself becomes a rectangle round it.

## Prefabs and catalogs (spec V2)

A prefab is a piece of a level kept to place again, in this project or another: a guard post, a lever and the gate it works, a locked vault with its key. **Prefabs** on the Level Designer's toolbar opens them; it works on any map, not only structures.

**Saving one.**

- **Save the selection** takes what is selected and what belongs with it:
  - the doors in its rooms;
  - what is inside its rooms;
  - whatever a chosen lever or plate works.
- On a structure's map, **Save the whole structure** takes every floor, each piece marked with its floor's code (B1, G, 1…).

A prefab carries what it needs to work where it lands:

- its items, kept round its centre;
- the project or personal assets they are made of;
- the story objects they point at: the key a door needs, what a chest holds, the scene a trigger starts.

**Placing one.**

- It goes in the middle of the view, as one change.
- Every piece gets a new GUID, a serial and a name not yet used on the map.
- What one part works or acts on is the copy of it, so the copied lever lifts the copied gate.
- Story objects and assets join the project only if it hasn't them; placing it again shares them rather than doubling them.
- A structure prefab goes onto the floors with the same codes. Floors the structure lacks are named, and what was on them is left out.

**Starters.** The studio comes with a few: Guard post, Lever and gate, Locked vault (with its key) and Trapped passage. They are built from the starter library each time, so they are always current.

**Files.** **File** saves a prefab as a `.vcgsprefab.json` package (format `vcgs-prefab`, version 1). **Open a prefab file…** reads one into the project's prefabs, after checking that:

- it is a prefab;
- it isn't from a newer studio;
- every piece has what a piece must have;
- it is under 4 MB and 5000 pieces.

It is only data; nothing in it runs.

**Catalogs (marketplace hooks).** A catalog is an index file at an https address (or a server on this computer).

- Add its address and it is kept with your preferences; it is fetched only when you open it.
- Each listed prefab is either:
  - a package to **Download**: checked against the SHA-256 the catalog lists, refused if it differs, then kept in the project;
  - a page to **Get it** from, with its price if it has one, opened in your browser. This is the hook for a store: the studio never takes payment itself.
- Entries without a safe address, or without a SHA-256 for their package, are left out, and the panel says how many.

The catalog format:

```json
{
  "format": "vcgs-prefab-catalog",
  "version": 1,
  "name": "Tomb kits",
  "prefabs": [
    { "id": "treasury", "name": "Treasury", "description": "…", "author": "A. Maker", "license": "CC-BY-4.0", "tags": ["tomb"], "url": "packs/treasury.json", "sha256": "<64 hex digits>" },
    { "id": "deluxe", "name": "Deluxe crypt", "page": "https://example.com/deluxe", "price": "$4" }
  ]
}
```

A package's `url` is relative to the catalog or absolute; its `sha256` is the hash of the file as served.

## Working on a structure together (spec V2)

Several people can work on one project's structures without a server: a structure is handed out as a file and merged back. **Team** on a structure's toolbar opens this.

**Claims.** **Claim it** puts your name (from Preferences) on the structure.

- Everyone who opens the project sees "Sam is working on this" on the toolbar.
- A claim warns; it doesn't lock.
- **Release the claim** frees it, and merging a working copy back releases it too.

**Handing out a working copy.** **Hand out a working copy** asks whose it is, then:

- saves a project file to give them;
- claims the structure for them.

The file is the whole project, so the story, its items and characters are all there. It also keeps the structure as it was handed out, its *base*. They open it like any project and work on it. The toolbar says "Working copy from Kim".

**Sending it back.** In their copy, **Team** offers **Send it back**, which saves the copy to return. Only the structure goes back; anything else they change stays in their copy.

**Merging it back.** **Open the working copy…** compares, by GUID, three versions:

- the base;
- the structure here now;
- theirs.

For each item, each floor and the structure's own settings:

| Here | Theirs | Result |
| --- | --- | --- |
| unchanged | changed, added or removed | theirs comes in |
| changed | unchanged | yours stays |
| changed | changed the same way | nothing to do |
| changed (or removed) | changed differently (or removed) | a **conflict**: **Keep mine** or **Take theirs**, item by item; mine unless you choose |

The dialog lists:

- their changes;
- each conflict, with the fields that differ;
- the new story objects their structure points at, which come with it.

If the structure was handed out again since, the dialog warns, and the newer claim stays. **Merge** is one change, so Undo takes it back. Serial counters stay ahead of anything they numbered.

## Floors (spec §8)

- **Codes.** Every floor has a code: B2 and B1 below ground, G, then 2, 3 … and R for the roof. The floor picker and the inspector's Floors section show them.
- **Floor kinds.** A floor is a basement, the ground, an upper floor or the roof. A floor made before the Structure Creator is a basement if it is below ground.
- **Adding floors.** **+ Basement** (in the inspector's Structure section) adds one under the lowest floor. **+ Roof** adds a roof on top, if there isn't one. **+ Floor above** goes under the roof, and the roof goes up.
- **The mass.** The mass on the parent map counts only the storeys, so not the basements or the roof. It is as tall as they are. Raise its **Floors** and the structure gets the floors it lacks, under its roof.

## Footprints (spec §5)

Each floor has a **Structure footprint**: the outer edge of that floor, drawn
dashed on the map.

- **Shaping it.** Drag its corners, add corners on its walls, or switch it between outline and rectangle, as with any outlined volume.
- **Stepped floors.** A pyramid's floors step in, each smaller than the one below.
- **Adding one.** The footprint is in the library under Architecture, for a floor that has none.
- **In the engines.** It goes to the engines as data, not geometry.

## The structure graph (spec §4, §8)

On a structure, **Structure graph** in the toolbar shows a panel under the
map:

- **Floors and rooms.** Each floor is a band, the top floor first. Its rooms, halls and stairwells are dots, spread east to west.
- **Connections.** These are worked out from the plan, so they are never out of step with it:
  - a door between two rooms, or between a room and **Outside** (an entrance);
  - an open space (no walls) joining what it touches;
  - stairs and ramps from where they start to the room they come up in, on the floor their top reaches;
  - ladders and traversal links straight up, and lifts at every floor within their travel;
  - portals out.
- **How lines are drawn.** Lines between floors are dashed gold. A door with a key, a condition or a puzzle gate is red. A one-way door has an arrow, the way it can be gone through. A secret door is dotted.
- **Shut off.** A room the walkthrough can't get to, because a locked door stays shut, is ringed with a dashed line.
- **Unreachable rooms.** A room no one can get to from an entrance (or from the player start, with no entrance) is ringed in red.
- **The issues list.** It is on the right. Click an issue or a room to go to it, on its floor.

**Between floors** decides which connections count:

- **Stairs:** stairs, ramps and lifts.
- **Ladders and stairs:** ladders as well.
- **Anything climbable:** traversal links as well.
- **Step-free:** lifts and ramps only. This is a design option; it doesn't mean building-code compliance (spec §15).

## Door rules (spec §7)

A door in a structure (or on any map) has these rules in the inspector, under
Gameplay:

| Rule | What it does in Play Mode |
|---|---|
| **Locked**, with what it **Needs** | Shut until the player has the key. Then it unlocks, and stays unlocked. A door that names a key but isn't locked opens for anyone (the walkthrough says so). |
| **Breakable**, **Broken with** | A locked door the player can break open, for good: with bare hands, or with the item named. "Locked. Needs Bronze Key, or Crowbar to break it." |
| **Opens from** | Both sides, or one way: only from inside its room (the room whose wall it is in), or only from outside it. From the wrong side: "It won't open from this side." Once open, it is open both ways. |
| **Closes again after** | A timed door: it shuts this many seconds after it opens, but never on the player standing in the doorway. 0: it stays open. |
| **Secret** | It looks like the wall, in the 3D view of Play Mode too, and doesn't open as the player walks up. Interact by it offers **Search the wall**; then it is a door like any other. |

Switches, codes and puzzles already open doors: a rule's **Open** action, a
condition on the door, or a puzzle gate binding.

The door rules go to the engines with the door's other settings, and
Godot, Unity and Unreal play them as the studio does (see
[In the engines](#in-the-engines-spec-13-14)).

## The structure library (spec §9)

The library has the parts the spec lists, each working in Play Mode and in
Godot, Unity and Unreal:

| Category | Parts |
|---|---|
| Spaces | Courtyard (no walls or ceiling of its own), Crawlspace (crouch through it), Tunnel, Elevator lobby, Shaft |
| Envelope | Archway, Hole in the wall, Column, Breakable wall |
| Traversal | Hatch and ladder, Rope / climb point, Trapdoor |
| Barriers | Gate / portcullis, Barricade, Rubble, Movable block |
| Interactives | Lever, Switch, Mechanism, Pressure plate, Keypad, Clue marker |
| Gameplay | Chest, Safe, Quest item, Trap |
| Dressing | Urn (breakable), Statue, Sarcophagus, Altar, Machine, Pipe run, Console |

How they work:

- **Lever, Switch, Mechanism, Pressure plate.** Each **Works** another item on the map, picked in the inspector, and **Does**:
  - **toggle**, **open** or **close** (for a door or gate);
  - **switch on** or **switch off** (for anything else: a trap, rubble, a trapdoor, a light);
  - **while held** (a plate): works it as the player steps on, and puts it back as they step off.

  For anything but a door, "open" means out of the way (switched off). A lever opens a locked gate: the lever is its key.
- **Starts switched off.** Rubble, traps and breakable walls can start switched off: not there until a lever, a plate or a rule switches them on. Rubble that falls as the player steps on a plate is a collapsing passage. A trapdoor that a plate switches off drops the player to the floor below.
- **Breakable.** A breakable wall, a barricade, rubble or an urn is broken for good with Interact: by hand, or with what it says it takes ("Needs Pickaxe to break it.").
- **Chest and Safe.** Opened once, with its key if it is locked, it gives what it **Holds** and stays where it is. A second Interact has nothing to do; an empty one says "It's empty."
- **Trap.** It hurts whoever stands in it while it fires: every **Cycle** seconds, for **Active for** seconds (a cycle of 0 is always on).
- **Keypad** and **Clue marker** tie into the Puzzle Creator: bind a keypad to a keypad puzzle (its gate opens when the code is right), and a clue to the lore it reveals.

The walkthrough opens doors with the levers and plates that work them ("Open Portcullis with Rusted lever."), and opens chests once their key is in hand ("Open Chest with Tomb Key: take Gold Idol in Treasury."). Preflight warns about a lever that works something no longer on its map. Copying a lever with its gate, or a whole map, keeps them working each other.

What levers, plates and rules switched on and off is remembered with the doors (**Coming back in**); chests opened are remembered with the items.

## The structure as a scene (spec §10)

With nothing selected, the inspector's **As a scene** section says what the
structure is for in play.

**Objectives.** What the player comes to do, in order. Each is done in one of
three ways:

- by reaching a room;
- by coming up to an item;
- when its condition holds ("Anywhere (by its condition)").

An objective can be **Optional**. Play Mode shows the next objective, says
when one is done, and goes on to the next.

**Complete when.** By default the structure is complete when every objective
that isn't optional is done. A condition here replaces that.

**When it is complete, outside.** Effects on the story: set a state, give an
item, solve a puzzle, start or complete a quest. These are how the structure
changes the scene it is part of. They happen once.

**Its own states (local).** A story state ticked here belongs to the
structure. It goes back to how the story starts it whenever the structure's
puzzles reset (below), and the first time the player comes in. Every other
state is the world's: it carries in and out.

**Coming back in.** What the structure remembers when the player leaves it
(through a portal or a rule's **Go to level**) and comes back:

| | Kept | Reset each visit |
|---|---|---|
| Doors | Opened, unlocked, found and broken, as left | As they start |
| Items | Pickups taken stay taken | Pickups are back |
| Enemies | Who was spawned, where they are, who is down | As they start |
| Puzzles | Solved stays solved | Its puzzles unsolved, its local states as the story starts them |

Everything is kept unless you say otherwise. Objectives done and the
structure's completion are always kept. Play Mode's log says what came back:
"Back in Tomb: doors, items, enemies, puzzles as you left them."

The memory is kept with the story's state (the play world), so it travels
from map to map.

## Putting things in a room (spec §9)

Select a room in a structure. **Put in this room**, in the inspector, takes:

- **an item from the story's catalog.** It goes in as a pickup that gives it;
- **a character.** An enemy goes in as an Enemy marker, an ally as a Companion, anyone else as an NPC;
- **a new item.** Its name makes an inventory item in the catalog, then a pickup for it here.

The room holds the placement; the definition stays in the catalog. Renaming
the pickup doesn't rename the item, and editing the character in the
Character Creator changes them everywhere they are placed. Things go round
the room's middle, so they don't land on each other.

## Solvability and the walkthrough (spec §11, §15)

**Walkthrough**, a tab beside the issues in the structure panel, walks the
structure as a player would:

1. In from outside (or from the player start).
2. Through every door that will open.
3. Taking what is lying in each room it reaches: pickups, and things whose rules give items.
4. Unlocking locked doors once their key is in hand, breaking breakable ones, opening ones a switch opens, searching for secret doors.
5. Round again until nothing more opens.

It lists each step: "Take Bronze Key (Key on the altar) in Entrance Hall.",
"Unlock Inner door with Bronze Key.", "Reach Burial Chamber.". Then come the
objectives it can reach. Click a step to go to it.

A door kept shut by a condition or a puzzle gate counts as open here: the
Puzzle Creator's own check says whether the puzzle can be solved.

What the walk couldn't do is in the issues, and in preflight:

| Issue | |
|---|---|
| A key behind the door it opens | Error: every way to the key goes through that door |
| Locked doors waiting on each other | Error: Inner door needs the Bronze Key, behind the Vault door, which needs the Crowbar, behind the Inner door |
| A locked door whose key isn't in the structure | Warning: the player has to bring it in |
| A locked door with no key, not breakable | Warning |
| A door that stays shut because its key is behind another door the player can't open | Warning |
| A one-way door with no way back and no way out beyond it | Warning: a softlock (a portal or an objective beyond it is a way out) |
| An objective that can't be reached | Error, or a warning if it is optional |
| An objective with nowhere to be done and no condition | Warning |
| A portal that leads nowhere, or to a map that isn't there; a rule that goes to a map that no longer exists | Error |
| A pickup or a trigger that can't be reached | Warning |
| A pickup that gives nothing, a trigger with no rules | Information |
| A door that names a key but isn't locked; the only way somewhere is a secret door | Information |

## Stacked floors in 3D (spec §12)

In the 3D graybox, **Floors in 3D** (the toolbar) shows:

- **This floor**.
- **All floors**, as built.
- **Cutaway to this floor**: the floors up to the one picked in the floor list, with its ceiling off, so you look down into it. Pick another floor to go up or down the building.
- **Floors spread apart**: each floor lifted clear of the one below by the tallest floor's height, to see a whole building from the basements to the roof at once. The ground floor stays where it is. Items can't be dragged while the floors are spread (they aren't where they are).

On a structure, **Connections** draws the structure graph in the graybox:

- a line between the rooms each door, stairway, ladder or lift joins, at waist height;
- red where something keeps it shut;
- dashed between floors, dotted for a secret door;
- an arrow on a one-way door;
- a dot at each room, and out beyond each way in.

## Rough play through a structure (spec §12, §16)

Play Mode goes in and out of a structure as a player would:

- **In.** On the map a structure stands on, walk up to its mass and press Interact: **Enter Old Tomb**. You arrive just inside the way in nearest where you stood, facing in.
- **Through.** The floors, doors, stairs, lifts and door rules play as on any map.
- **Out.** Walk out of a way in and past the footprint. You are back on the map it stands on, outside the mass where you came out, facing away from it.
- **State kept.** Both maps remember the visit: doors as you left them, what you took, who is where. A structure's **Coming back in** rules say what of that it keeps.

## In the engines (spec §13, §14)

Each structure goes to the engines with a **structure manifest**:

- what it is: name, type, purpose, tags, author, traversal style, the scene it plays as, its mass on the parent map;
- its floors: key, code (B1, G, 2 … R), kind, elevation, height and footprint;
- its rooms and how they connect (the structure graph), the ways in, and each door's rules;
- its objectives, its completion condition and its effects on the story outside;
- its own states with their start values, its puzzles, and what it remembers between visits;
- the seed and generator version of its last accepted layout;
- the studio's walkthrough, to test against in the engine.

The manifest is in each engine's level data:

- **Godot**: `STRUCTURE` and `structure_data()` in the level's script.
- **Unity and Unreal**: `structure` in the level's JSON.
- **JSON**: `levels[].structure`.

The runtimes play what the studio's Play Mode plays:

- the door rules (breakable, one way, timed, secret);
- the objectives in order (`objective_changed`), and the completion with its effects (`structure_completed` / `StructureCompleted` / `OnStructureCompleted`);
- what a map remembers between visits. It is kept as each level leaves the scene tree (Godot), is destroyed (Unity) or ends play (Unreal), and comes back when the level loads again.

How a structure is loaded is up to its boundary, as with any child map: continuous and streamed children load into the parent; instanced and transition ones are loaded by your game when `level_requested` asks.

Each engine's check walks the same sample structure, the Old Tomb (`model/level/sample-structure.ts`):

- one door of each rule;
- the key;
- two objectives;
- leaving and coming back.

The walk is played on the studio's Play Mode first, and Godot 4.3, Unity (C# against stubs) and Unreal (the C++ core) must match it step for step: every offer, every door, the objectives, the completion, and the story state.

**Re-export by id (spec §14).** Every item keeps its GUID. The structure manifest has a revision of its own, so the handoff lists exactly what changed since the last export, for example a door rule changed: that door and "Old Tomb (its structure manifest)". Files edited in the engine since are reviewed before they are written over, as with every export.

## Validation (spec §8, §15)

The panel lists these. Preflight lists the errors and warnings too:

- floors whose heights overlap (an error);
- a room that goes outside its floor's footprint;
- stairs, a ramp or a ladder that reaches no floor (its height doesn't line up with the floor above), or comes up outside every room;
- no way in: no door in an outside wall, no portal and no player start;
- a room no one can reach, with the traversal style in force;
- for information: a door that opens onto unplanned space inside the footprint, and a structure with no footprint.

## The structure's settings (spec §5, §13)

With nothing selected, the inspector's **Structure** section has:

- the structure type;
- its purpose;
- how its floors are reached;
- the scene it plays as;
- tags and author;
- the generator's seed: the same seed gives the same layout.

A plain building map can be made a structure from here.

## In the code

- `apps/studio/src/renderer/model/level/structure.ts` holds:
  - the presets and footprint shapes;
  - floor kinds and codes, basements and the roof;
  - `createStructure`;
  - the structure graph (`structureGraph`) and validation (`structureIssues`).
- `apps/studio/src/renderer/model/level/doors.ts` reads a door's rules (`doorRules`) for Play Mode, the graph and the walkthrough.
- `apps/studio/src/renderer/model/level/walkthrough.ts` holds the solvability check and the walkthrough (`walkStructure`).
- `apps/studio/src/renderer/model/level/place-in-room.ts` puts catalog items and characters into a room (`placeInRoom`).
- `apps/studio/src/renderer/model/level/stack.ts` stacks the floors in 3D (`stackMeshes`, `floorLift`) and draws the graph there (`graphLines`).
- `apps/studio/src/renderer/model/handoff/structures.ts` builds the structure manifest (`structureManifest`); `levelRevisions` in `handoff/levels.ts` gives re-export its revisions.
- `apps/studio/src/renderer/model/level/sample-structure.ts` is the Old Tomb and its walk (`withTomb`, `tombWalk`), for the tests and the engine checks (`scripts/godot-check/check_structure.gd`, `scripts/unity-structure-check/`, `scripts/unreal-check/structure_check.cpp`).
- Play Mode (`model/level/play.ts`) plays the door rules, the objectives and completion, and what a structure remembers (`leaveLevel`, `PlaceMemory` in the play world's `places`).
- `apps/studio/src/renderer/model/level/generate.ts` holds the generator: `proposeLayout`, `acceptLayout`, `proposeDressing` (dress rooms only), floor by floor (`guidedOrder`, `entranceAt`, `stairsAt`, `laidOut`; the structure's `entrance` and `stairs`), the rule presets and each structure type's room names.
- `apps/studio/src/renderer/model/level/cad.ts` holds CAD plan import: `parseDxf`, `parseSvg`, `guessRole`, `guessUnits`, `readPlan` and `importPlan`. The dialog is `components/level/ImportPlanDialog.tsx`.
- `apps/studio/src/renderer/model/level/prefabs.ts` holds prefabs and catalogs: `makePrefab`, `makeStructurePrefab`, `placePrefab`, `readPrefab`, `starterPrefabs`, `readCatalog`, `fetchCatalog` and `fetchListed`. `insertItems` in `level.ts` puts copies down with new GUIDs. The panel is `components/level/PrefabsPanel.tsx`.
- `apps/studio/src/renderer/model/level/coop.ts` holds cooperative editing: `claim`, `release`, `handOut`, `mergePlan` and `applyMerge`. A level's `claim` and a set's `working` (the base) are in `model/level/types.ts`. The dialog is `components/level/TeamDialog.tsx`.
- `apps/studio/src/renderer/model/level/themes.ts` holds the procedural themes: `THEMES`, `defaultTheme`, `dressRooms` and `undress`.
- Changes elsewhere:
  - `Level.structure` and `Floor.kind` are in `model/level/types.ts`;
  - the footprint asset is in `model/level/library.ts`;
  - `syncBuildings` (in `model/level/hierarchy.ts`) leaves basements and the roof out of a mass's count;
  - preflight takes the structure's issues (`model/level/validate.ts`).
- The UI is in `apps/studio/src/renderer/components/level/`: `NewStructureDialog.tsx`, `StructurePanel.tsx` (the graph and the walkthrough), `GeneratePanel.tsx` (the generator), `StructureSection.tsx` (the inspector's Structure and As a scene sections) and `PlaceInRoom.tsx`.
- Tests: `model/__tests__/structure.test.ts`, `model/__tests__/structure-generate.test.ts`, `model/__tests__/structure-guided.test.ts`, `__tests__/structure-guided.test.tsx`, `model/__tests__/structure-themes.test.ts`, `model/__tests__/structure-cad.test.ts`, `model/__tests__/structure-prefabs.test.ts`, `__tests__/level-prefabs.test.tsx`, `model/__tests__/structure-coop.test.ts`, `__tests__/level-team.test.tsx`, `model/__tests__/structure-library.test.ts`, `model/__tests__/structure-gameplay.test.ts`, `model/__tests__/structure-handoff.test.ts` and `__tests__/structure-creator.test.tsx`.
