# VC Game Studio — Note Sorter
Development Specification • Fresh Regenerated Copy
# 1. Purpose and Product Goal
The VC Game Studio Note Sorter uses the same shared non-destructive sorting engine as VC Writer but adds game-development destinations. Its purpose is to take large brainstorming sessions, design documents, dictated ideas, lore notes, gameplay concepts, and narrative material and rapidly convert them into functional game-development structure.
# 2. Core Workflow
The game workflow is Raw Notes → Extract → Categorize → Refine → Map to Game Objects → Build Game Flow. Sorted material should move naturally into the Game Bible, Spine, Player Lane, scenes, levels, cinematics, dialogue, mechanics, inventory, encounters, and other Game Studio systems.
# 3. Shared Note Sorter Engine
VC Writer and VC Game Studio should use one underlying Note Sorter architecture: immutable source documents, source-linked extracted notes, nested categories, drag-and-drop sorting, processed states, search, filters, Undo, and destination references. Game Studio extends the destination schema rather than creating a separate incompatible note system.
# 4. Main UI
Use the same two-panel interaction: Raw Notes on the left and Sorting Workspace on the right. A third optional destination/flow view may open when the designer begins converting organized notes into game objects. The designer should be able to work rapidly without opening complex property dialogs for every excerpt.
# 5. Game-Specific Category Templates
The designer may create any categories manually, but Game Studio can offer optional starting templates such as Lore, Eras, Characters, NPCs, Relationships, Factions, Locations, Levels, Scenes, Objectives, Obstacles, Choices, Dialogue, Cinematics, Mechanics, Combat, Powers, Weapons, Inventory, Economy, Puzzles, Smart Objects, Encounters, Enemies, Companions, Quests, State Variables, Gates, Triggers, Audio, Environment, and Player Progression.
# 6. Extracting Game Ideas
The designer highlights any portion of the source notes and drags it to a category. Game Studio creates a source-linked Note Card. The original passage becomes processed and can be grayed or hidden. Nothing is physically removed from the source document.
# 7. Convert Note to Game Object
A sorted card can remain a note or be converted into a native Game Studio object. Examples include Character/NPC, Location, Scene, Level, Cinematic, Dialogue block, Mechanic, Weapon, Item, Puzzle, Objective, Encounter, Choice, State Gate, Trigger, Quest, Lore entry, or Spine/Player Lane beat. Conversion preserves the original source reference.
# 8. Build Game Flow Workspace
After sorting, the designer can enter Build Game Flow. Organized cards appear as a staging library and can be dragged into the existing game architecture. Cards may be placed on the central Spine, Player Lane, obstacle structure, levels, scenes, branches, or Game Bible. This turns brainstorming into an actionable game flow rather than a static categorized document.
# 9. Spine and Player Lane Integration
A note describing a major plot event can become a Spine bone or attach to an existing bone. A progression idea can become a Player Lane beat. Obstacles, prerequisites, positive/negative outcomes, and branch/rejoin paths can be created from sorted cards while retaining the originating note.
# 10. Scene Integration
A note assigned to a scene may be converted or attached to the appropriate scene layer. Narrative material can populate narrative metadata. NPC behavior and blocking can populate the behavioral layer. variables, gates, mutations, and triggers can populate the systemic layer. Dialogue, audio, cinematics, camera/framing, atmospheric sound, and presentation notes can populate the presentation layer.
# 11. Level and Gameplay Integration
Sorted notes can feed the Level Designer and gameplay systems. A note about a room or environment may become a level-design note or object. A mechanic can become a mechanic definition. A weapon, pickup, talisman, power-up, quest item, currency item, or consumable can become an inventory/economy object. Puzzle and environmental-interaction ideas can become smart-object or puzzle definitions.
# 12. Cinematics and Dialogue
Cinematic ideas can be grouped, ordered, and converted into Cinematic objects linked to the appropriate scene or Spine point. Dialogue excerpts can become dialogue blocks associated with the correct speaker, scene, choice, or encounter. Source lineage remains available for later reference.
# 13. Relationships and Dependencies
Note Cards may reference one another before or after conversion. The designer can establish relationships such as requires, unlocks, blocks, causes, modifies, rewards, precedes, follows, appears in, belongs to, or conflicts with. These relationships can later become functional game logic where appropriate.
# 14. Choice and State Logic
Notes describing choices may be converted into Choice objects and linked to persistent or single-use behavior. Notes about consequences can be attached as state mutations, relationship changes, inventory changes, quest changes, or future gates. This supports the existing branching narrative system.
# 15. Progress and Unresolved Material
The system tracks sorted, unsorted, partially sorted, converted, and unconverted material. Designers can filter for notes that have been categorized but not yet assigned to the game flow, helping prevent useful ideas from disappearing inside a large brainstorming document.
# 16. AI Assistance
Optional AI can suggest game-specific categories, detect possible characters/locations/mechanics, recommend destinations, and identify related or potentially duplicate ideas. AI recommendations require designer approval and should never silently create or alter game logic.
# 17. Example — Large Game Brainstorm
A long brainstorming session may contain lore about the jinn, historical eras, powers, talismans, demons, human relationships, captivity mechanics, revenge sequences, forgiveness choices, cinematics, encounters, level ideas, and final-battle concepts all mixed together. The designer imports the notes, creates or accepts useful categories, and rapidly drags each passage into place. Once sorted, lore goes to the Game Bible, era notes help structure levels, character material populates characters and relationships, mechanics become gameplay definitions, cinematic notes attach to scenes, and plot/progression beats are placed on the Spine and Player Lane.
# 18. Data Model
Game Studio extends the shared Extracted Note model with game destination type, destination object ID, conversion state, dependency references, and game-flow placement metadata. A single source note may reference multiple game objects when appropriate without duplicating the original source.
# 19. MVP Requirements
The MVP includes the shared Writer Note Sorter functionality plus game-specific categories, conversion to common Game Studio object types, Build Game Flow staging, Spine/Player Lane placement, scene attachment, Game Bible placement, source lineage, game-specific filtering, and tracking of categorized-but-unplaced notes.
# 20. Future Expansion
Future versions can add bulk conversion, AI extraction of candidate game objects, automatic relationship suggestions, mechanic dependency visualization, missing-content detection, and synchronization between source notes and downstream design objects while protecting deliberate edits.
# 21. Acceptance Principle
A designer should be able to import a day's worth of chaotic game brainstorming and rapidly transform it into organized lore, characters, mechanics, cinematics, scenes, levels, objectives, and functional game-flow components without manually copying and pasting the same material throughout Game Studio.