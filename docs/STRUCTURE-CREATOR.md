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
| MVP 4: Graybox and handoff | Stacked floors and cutaways in 3D, rough play through a structure, a structure manifest for Godot, Unity and Unreal (with the door rules and the scene settings), re-export by id | Next |

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

**What to lay out:**

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

The door rules go to the engines with the door's other settings. Their
runtimes play them from MVP 4.

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
- Play Mode (`model/level/play.ts`) plays the door rules, the objectives and completion, and what a structure remembers (`leaveLevel`, `PlaceMemory` in the play world's `places`).
- `apps/studio/src/renderer/model/level/generate.ts` holds the generator: `proposeLayout`, `acceptLayout`, the rule presets and each structure type's room names.
- Changes elsewhere:
  - `Level.structure` and `Floor.kind` are in `model/level/types.ts`;
  - the footprint asset is in `model/level/library.ts`;
  - `syncBuildings` (in `model/level/hierarchy.ts`) leaves basements and the roof out of a mass's count;
  - preflight takes the structure's issues (`model/level/validate.ts`).
- The UI is in `apps/studio/src/renderer/components/level/`: `NewStructureDialog.tsx`, `StructurePanel.tsx` (the graph and the walkthrough), `GeneratePanel.tsx` (the generator), `StructureSection.tsx` (the inspector's Structure and As a scene sections) and `PlaceInRoom.tsx`.
- Tests: `model/__tests__/structure.test.ts`, `model/__tests__/structure-generate.test.ts`, `model/__tests__/structure-gameplay.test.ts` and `__tests__/structure-creator.test.tsx`.
