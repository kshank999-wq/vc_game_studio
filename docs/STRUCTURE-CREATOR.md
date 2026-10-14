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
| MVP 3: Gameplay | Door rules (one-way, timed, secret, breakable), the structure as a scene with entry and exit conditions and state that stays on re-entry, puzzles, items and characters placed in rooms, solvability (the key before its door, softlocks) | Next |
| MVP 4: Graybox and handoff | Stacked floors and cutaways in 3D, rough play through a structure, a structure manifest for Godot, Unity and Unreal, re-export by id | Planned |

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
- **Dead ends and secret branches.** These go off chambers along the way. A secret branch is behind a door named **Secret door** and tagged `secret`. For now that is all a secret door is; MVP 3 gives it its rules.
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
- **How lines are drawn.** Lines between floors are dashed gold. A door with a key, a condition or a puzzle gate is red. That door counts as open for now: MVP 3 checks the key can be reached first.
- **Unreachable rooms.** A room no one can get to from an entrance (or from the player start, with no entrance) is ringed in red.
- **The issues list.** It is on the right. Click an issue or a room to go to it, on its floor.

**Between floors** decides which connections count:

- **Stairs:** stairs, ramps and lifts.
- **Ladders and stairs:** ladders as well.
- **Anything climbable:** traversal links as well.
- **Step-free:** lifts and ramps only. This is a design option; it doesn't mean building-code compliance (spec §15).

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
- `apps/studio/src/renderer/model/level/generate.ts` holds the generator: `proposeLayout`, `acceptLayout`, the rule presets and each structure type's room names.
- Changes elsewhere:
  - `Level.structure` and `Floor.kind` are in `model/level/types.ts`;
  - the footprint asset is in `model/level/library.ts`;
  - `syncBuildings` (in `model/level/hierarchy.ts`) leaves basements and the roof out of a mass's count;
  - preflight takes the structure's issues (`model/level/validate.ts`).
- The UI is in `apps/studio/src/renderer/components/level/`: `NewStructureDialog.tsx`, `StructurePanel.tsx` (the graph), `GeneratePanel.tsx` (the generator) and `StructureSection.tsx` (the inspector).
- Tests: `model/__tests__/structure.test.ts`, `model/__tests__/structure-generate.test.ts` and `__tests__/structure-creator.test.tsx`.
