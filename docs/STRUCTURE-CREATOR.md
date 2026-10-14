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
| MVP 2: Generation | Seeded plan-first and path-first layouts, previews to accept or reject, locked rooms, regenerating part of a structure | Next |
| MVP 3: Gameplay | Door rules (one-way, timed, secret, breakable), the structure as a scene with entry and exit conditions and state that stays on re-entry, puzzles, items and characters placed in rooms, solvability (the key before its door, softlocks) | Planned |
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
- the generator's seed, used from MVP 2: the same seed gives the same layout.

A plain building map can be made a structure from here.

## In the code

- `apps/studio/src/renderer/model/level/structure.ts` holds:
  - the presets and footprint shapes;
  - floor kinds and codes, basements and the roof;
  - `createStructure`;
  - the structure graph (`structureGraph`) and validation (`structureIssues`).
- Changes elsewhere:
  - `Level.structure` and `Floor.kind` are in `model/level/types.ts`;
  - the footprint asset is in `model/level/library.ts`;
  - `syncBuildings` (in `model/level/hierarchy.ts`) leaves basements and the roof out of a mass's count;
  - preflight takes the structure's issues (`model/level/validate.ts`).
- The UI is in `apps/studio/src/renderer/components/level/`: `NewStructureDialog.tsx`, `StructurePanel.tsx` (the graph) and `StructureSection.tsx` (the inspector).
- Tests: `model/__tests__/structure.test.ts` and `__tests__/structure-creator.test.tsx`.
