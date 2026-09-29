# VC Game Studio — Note Sorter: UI handoff for the coding agent

Source spec: `spec/VC_Game_Studio_Note_Sorter_Development_Spec.docx`. Where this file and the spec differ, this file wins; everything else in the spec still applies.

Mockups:
- `mockups/png/` has the screens as images.
- `mockups/html/` has the same screens as static HTML. Open them in a browser; the step tabs link between screens.

The Note Sorter uses the **same engine as VC Writer's Note Sorter** (spec §3). Source documents never change. Extracted notes are linked back to their source, categories can be nested, and the sorter supports drag-and-drop, search, filters and Undo. Game Studio only **extends the destination types**; it is not a separate note system.

## One idea runs through every screen
A passage becomes a **card**, and a card can become a **game object**. Every card and every object keeps a link back to the exact words it came from. Every card has one of four statuses, and the same marker is used on every screen:

| Status | Marker |
|---|---|
| Unsorted | grey dot (the passage is still plain text in the source) |
| Sorted | gold ring (a card in a category, still just a note) |
| Converted | the game object's own symbol (the shapes and colors from the Game Studio legend) |
| Placed | green (the object sits in the game: on the Spine, the Player Lane, a scene layer, a level, a system or the Game Bible) |

"Set aside" (dashed ring) removes a note from the counts without deleting it.

## The workflow is four steps, shown as tabs in the header
The spec's pipeline is Raw Notes → Extract → Categorize → Refine → Map → Build. The header folds it into **1 Sort · 2 Convert · 3 Build flow · 4 Review**. These are views, not a wizard: you can move between them freely. The header also shows overall progress ("18 of 31 sorted"), plus Undo and the Game Bible button.

### 1. Sort (`01-sort`)
- **Left, Raw notes:**
  - Source tabs, each with its own % sorted, plus "+ Import".
  - The document is shown read-only.
  - Sorted passages turn grey and get a margin tag naming their category. "Hide sorted" collapses them.
  - Highlight any passage and drag it onto a category.
- **Right, Categories:**
  - A grid of category bins. Each bin shows a count, subcategory chips, a preview of its cards and "+N more".
  - While dragging, the target bin highlights and shows a "Drop to add here" slot.
  - Empty bins say so.
  - "Template: Action-adventure ▾" loads a starter set from spec §5, or you can build your own with "+ Category".
- **AI suggestion strip:** a single line with Review and Dismiss. Nothing moves until the designer approves it (spec §16).
- **No dialogs while sorting.** Dropping a passage creates the card immediately (spec §4).

### 2. Convert (`02-convert`)
The screen has four columns, left to right:

1. **Category rail**, with counts and a status key.
2. **Card list** for the selected category. You can drag cards to reorder them or to merge them.
3. **Card editor:**
   - The note text is editable, but edits never touch the source.
   - A **source link** ("From Voice memo · Sep 22, ¶3").
   - A name field.
   - **Connected to:** links to other cards and objects using the spec §13 verbs (requires, unlocks, blocks, causes, modifies, rewards, precedes, follows, appears in, belongs to, conflicts with).
   - A duplicate warning with a Compare button.
4. **"What is it?"** type picker, grouped as:
   - **Story:** Spine beat, Player Lane beat, Scene, Cinematic, Dialogue block, Choice, Lore entry, Quest/Objective.
   - **World:** Character/NPC, Location/Level, Item/Weapon, Smart object, Puzzle, Encounter/Enemy.
   - **Systems:** Mechanic, State gate, Trigger, State change.
   - Plus "Keep it as a note for now".

The picker marks the suggested type, but the designer makes the choice. A note can be converted more than once; every resulting object points back to the same source (spec §18).

### 3. Build flow (`03-build-flow`)
- **Left, "Ready to place":** the staging library, filtered to Not placed / Placed / All and grouped into Story / World / Systems. Cards still sitting as plain notes are listed at the bottom, each with a Convert link.
- **Centre, the story graph:**
  - A mini version of the real Game Studio graph: the Spine track and the Player Lane.
  - Hovering a scene with a card opens its **four layer targets**: Narrative, Behavior, Systemic, Presentation (spec §10). The mockup shows a cinematic card going into Presentation.
  - Each node shows how many notes built it ("3 notes").
  - Selecting a node shows **"built from N notes"**, with the quoted source words and the layer each one went to.
- **Right, "Other places to drop":**
  - Game Bible sections (Lore, Characters & NPCs, Inventory & economy).
  - Levels, with "+ New level".
  - Gameplay systems: Mechanics, Encounters, Puzzles and smart objects, Gates/triggers/state.

### 4. Review (`04-review`)
- **Left:**
  - Status filters with counts: Unsorted, Sorted, Converted-not-placed, Placed, Set aside.
  - A **per-source progress bar** for each document (placed / converted / sorted / unsorted), which also shows documents that are only partly sorted.
- **Centre:** the filtered table. The default filter is **"Converted, not placed"**, the ideas most likely to get lost (spec §15). Each row shows the note, what it became and where it came from. Its **Place** button jumps to Build flow with the card already picked up.
- **Right, Suggestions:**
  - The suggestion types are possible duplicate (Merge / Keep both), new category (Add / Dismiss), where it might go (Place there / Not now) and possible characters found in raw notes (Show me / Dismiss).
  - A global on/off switch.
  - "Nothing here changes your game until you approve it."

## Visual tokens (shared with the rest of VC Game Studio)

| Token | Value |
|---|---|
| Ground | #0B0A07 |
| Panels | #12100B |
| Cards | #1A170E |
| Borders | #332B17 |
| Gold | #C9A45C / #E8C872 / #8A6F2F |
| Text | #F1E7CF |
| Muted | #9C8F6D |
| Placed | #4F9E5C |
| Sorted ring | #C9A45C |

Game object symbols and colors match the Game Studio legend:

| Object | Color | Shape |
|---|---|---|
| Spine beat | #C9A45C | bar |
| Scene | #4FA39A | rounded rect |
| Cinematic | #9A7FC0 | film card |
| Dialogue | #E08A5A | speech bubble |
| Choice | #F2C230 | circle |
| Character | #D9607A | triangle |
| Object | #4A86D8 | square |
| Environment / Level | #6FAE5E | hexagon |
| Inventory | #6CC4D6 | star |
| Puzzle | #E07BB0 | puzzle piece |
| Logic | #C8BFAE | outline diamond |
| Player Lane | #E8E0C8 | lane line |

Enemy / encounter uses a red #E5534B arrow, and Mechanic uses a green cross-hair.

Type:
- **Josefin Sans**: labels and the brand.
- **IBM Plex Sans**: the UI.
- **IBM Plex Mono**: source references such as "memo ¶3".
- **Source Serif 4**: the raw notes and note text.

## Decisions beyond the spec (Ken to confirm)
- The six pipeline stages are folded into **four tabs**: Sort, Convert, Build flow and Review. Extract and Categorize happen together in a single drag.
- Categories are shown as a **grid of bins** rather than a tree. Nesting appears as subcategory chips inside each bin; clicking a chip filters that bin.
- Conversion lives on its own screen, so sorting stays fast and never opens a dialog.
- Placing a card in Build flow does not remove it from the staging library. It moves under the "Placed" filter.
- The sample project "Brass & Smoke" is placeholder content based on the jinn example in spec §17.

## Data model (spec §18). Extend the shared Writer model; don't fork it.

| Entity | Fields |
|---|---|
| SourceDocument | id, name, importedAt, content (immutable), sortedRatio |
| ExtractedNote *(shared)* | id, sourceId, range{start, end} anchored to stable source offsets, text (editable copy), categoryId, status: unsorted \| sorted \| converted \| placed \| setAside, order |
| Category *(shared)* | id, name, parentId?, templateKey? |
| **Game extension on ExtractedNote** | destinations[{objectType, objectId}], conversionState, dependencies[{verb, targetId}], flowPlacements[{target: spine \| playerLane \| sceneLayer \| level \| bible \| system, targetId, layer?}] |
| Suggestion | id, kind: duplicate \| category \| destination \| entity, payload, state: pending \| accepted \| dismissed |

Rules:
- One note may point to several game objects without duplicating the source.
- An object deleted downstream reverts its note to "converted" or "sorted". The note itself is never deleted.
- Suggestions never write game data until they are accepted.

## Build order (spec §19 MVP)
1. Import, and the Raw notes panel.
2. Drag a passage onto a category to create a card; the source passage greys out.
3. Categories: templates, nesting, search, Undo.
4. Convert to the common object types, with source lineage.
5. Build flow: the staging library, Spine and Player Lane placement, scene layers, the Game Bible.
6. Review filters, especially categorized-but-unplaced.
7. AI suggestions, gated behind approval.
