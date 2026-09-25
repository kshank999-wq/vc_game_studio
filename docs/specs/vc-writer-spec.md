# VC Writer

_Interactive Game-Writing & Narrative Authoring Module for VC Writer and VC Game Studio_

Development Specification • Version 1.0 • September 22, 2026

> Converted from `vc-writer-spec.docx` (the original is kept alongside). The docx is the source of truth.

## 1. Product Definition

VC Writer is the writing and story-development system for the VC ecosystem. This specification focuses on its interactive game-writing mode: writers and narrative designers can create the Game Bible, narrative spine, scenes, beats, dialogue, branching choices, character and relationship logic, inventory requirements, puzzles, environmental interactions, and cinematics without implementing engine-level code. The same VC Writer project data is available inside VC Game Studio, where the authored intent and structured logic can be bound to levels, gameplay systems, assets, triggers, cinematics, and generated code.

- Standalone value: VC Writer users can design game narratives, scenes, branching choices, characters, dialogue, inventory logic, puzzles, gates, and cinematics.
- Embedded value: VC Game Studio includes the VC Writer functionality directly, using the same project data and interface concepts.
- Separation of responsibility: VC Writer defines intent and logic; VC Game Studio implements physical gameplay, level construction, simulation, engine systems, and code generation.
- Non-destructive workflow: narrative revisions must preserve IDs and references so downstream Game Studio implementation does not break.

## 2. Core Project Structure

| Object | Purpose |
| --- | --- |
| Game Project | Top-level project containing Bible, narrative spine, levels/chapters, scenes, systems, and export metadata. |
| Game Bible | Canonical definitions for characters, factions, locations, items, inventory, powers, weapons, resources, themes, world rules, and progression. |
| Narrative Spine | Mandatory story progression and major milestones from beginning through resolution. |
| Level / Chapter | Narrative container representing a major playable segment. |
| Scene | Primary authoring unit where narrative, behavior, systemic logic, presentation, choices, interactions, and completion conditions are defined. |
| Beat | Atomic narrative/gameplay moment within a scene or player lane. |
| Branch | Conditional path created by a player decision, state, relationship, inventory item, or outcome. |
| Resolution / Merge | Point where branches reconnect to a required narrative or gameplay milestone. |

## 3. Game Setup Wizard

- Select game/story type: linear, branching narrative, RPG, action/adventure, first-person shooter, puzzle, survival, hybrid, or custom.
- Define central premise, player fantasy, protagonist/player role, world, tone, themes, intended ending structure, and major gameplay/narrative loop.
- Define the central spine before optional branches are added.
- Declare progression model: levels, chapters, missions, quests, open-world regions, acts, or custom containers.
- Predefine recurring resources such as weapons, ammunition, health, powers, currency, keys, quest items, crafting items, and collectibles.
- Allow custom schemas so designers are never locked to predefined genres.

## 4. Game Bible

- Characters: player characters, NPCs, companions, antagonists, factions, relationships, traits, goals, secrets, dialogue voice, arc, and state changes.
- Player progression: skills, abilities, attributes, reputation, morality/alignment if used, relationship values, unlocks, and level-dependent capability.
- Inventory: item definition, category, quantity rules, stackability, persistence, equip state, consumable state, prerequisites, acquisition/loss points, and downstream dependencies.
- Weapons/resources: weapon properties, ammunition/resource type, upgrade path, availability, depletion, and narrative dependencies.
- Power-ups and abilities: temporary/permanent state changes, duration, prerequisites, cooldown concepts, and narrative consequences.
- Locations: world/region/level/scene relationships plus environmental properties and reusable interactive objects.
- Themes, motifs, objects, lore, factions, quests, puzzles, setups/payoffs, and dependencies.
- Every Bible entity receives a persistent unique ID and a Used / Unused indicator.

## 5. Narrative Spine and Player Lane

The timeline view must show the required narrative spine and a dedicated Player Lane beneath it. The Player Lane describes what the player must do, learn, acquire, overcome, or decide to advance.

- Create beats for player objectives, discoveries, interactions, puzzles, combat/gameplay transitions, acquisitions, failures, and successes.
- Permit positive/negative or custom outcome branches that split temporarily and later merge into a required resolution.
- Support optional branches that may remain open across multiple scenes or levels.
- Show prerequisites and downstream consequences visually.
- Allow choices to remain available, become unavailable, or disappear after selection according to designer-defined rules.
- Track unresolved branches, orphaned outcomes, unreachable states, and required merge points.

## 6. Scene Authoring Model

Each scene uses four coordinated layers, visible individually or together.

| Layer | Contents |
| --- | --- |
| Layer 1 — Narrative / Context | Scene purpose, narrative metadata, location, time, participants, objectives, story state, prerequisites, expected outcome, links to spine. |
| Layer 2 — Behavioral | Player actions, NPC/companion behavior, dialogue interactions, reactions, movement intentions, encounter behavior, and conditional behavior. |
| Layer 3 — Systemic | State gates, variables, state mutations, inventory checks, relationship changes, quest flags, gameplay triggers, puzzle state, success/failure conditions. |
| Layer 4 — Presentation | Dialogue/text, voice/audio notes, music, ambience, environmental sound, camera/framing, cinematic instructions, visual atmosphere, and presentation cues. |

## 7. Scene Element Graph

- Represent scene entities as selectable nodes/cards: player, NPC, companion, object, item, smart object, puzzle element, trigger, gate, cinematic, dialogue block, exit, objective, and environmental interaction.
- Selecting an NPC/character can open attached dialogue branches and behavioral notes.
- Selecting an item exposes acquisition rules, inventory mutation, use cases, and dependencies.
- Selecting an interactive object exposes interaction verbs, required conditions, result states, animation/audio/cinematic notes, and connected triggers.
- Use prerequisite/gate nodes for actions that must occur before progression.
- Allow designers to create custom node types and custom properties.

## 8. Choice, State, and Consequence System

- Choice IDs must be persistent and referenceable across the project.
- Choice availability can depend on variables, inventory, relationships, prior choices, quest state, player capability, location state, or custom expressions.
- Choice results may set/unset flags, mutate numeric/string/enumerated variables, alter relationships, add/remove inventory, unlock/lock content, trigger cinematics, or redirect flow.
- Support one-time, repeatable, timed, mutually exclusive, hidden, revealed, and persistent choices.
- Provide dependency visualization: choice → mutation → affected scenes/choices/outcomes.
- Provide validation for circular dependencies, impossible gates, contradictory states, and branches with no resolution.

## 9. Inventory, Items, Puzzles, and Interactive Environment

- Inventory is authored in the Bible and referenced in scenes through acquire/use/drop/equip/consume/check operations.
- Puzzle definitions include objective, components, states, required sequence or flexible solution logic, hints, failure/reset behavior, rewards, and downstream state changes.
- Environmental interactive points ('smart objects') include interaction type, state, prerequisites, actions, feedback, and result.
- Scene completion may require one or more mandatory objectives, puzzle states, interactions, inventory conditions, dialogue outcomes, or custom conditions.
- Support cave/level environmental mechanics as authored logic: darkness, traversal constraints, climbing/crawling/swimming, hazards, visibility, echo/audio cues, collapses, water, environmental puzzles, resource constraints, and other designer-defined mechanics. VC Writer stores the intent and parameters; Game Studio implements the physical mechanics.

## 10. Cinematics

- Any scene or beat can create/select a Cinematic block.
- Define trigger, participants, staging intent, dialogue, camera/framing notes, animation beats, audio/music, skippable state, branching/interactive moments, and exit state.
- Cinematics may be fully authored, partially interactive, or transition into/out of physical gameplay.
- All cinematic instructions are structured so Game Studio can translate them into sequencer/timeline implementation.

## 11. Validation and Simulation

- Narrative simulator lets the author walk through choices without launching a game engine.
- State inspector shows current flags, variables, inventory, relationships, objectives, and available choices at every step.
- Detect unreachable scenes, dead ends, missing prerequisites, unconsumed setup/payoff links, impossible inventory requirements, and unmerged mandatory branches.
- Provide a path explorer to compare alternative playthroughs and identify where state diverges.

## 12. Data Model and Persistence

- Use stable UUIDs for every project entity.
- Store narrative content separately from engine-specific implementation metadata.
- Recommended canonical representation: normalized database records with versioned JSON serialization for interchange/export.
- All references use IDs rather than display names.
- Maintain revision history and schema versioning; migrations must preserve old projects.
- Support project-local custom variables, enums, tags, node types, and validation rules.

## 13. VC Game Studio Handoff Contract

- VC Writer exports/streams the complete structured narrative graph, not flattened prose.
- Handoff includes scenes, beats, entities, dialogue, choices, variables, gates, mutations, objectives, inventory operations, puzzle logic, triggers, cinematic metadata, presentation notes, and dependency links.
- Game Studio adds implementation bindings such as engine object IDs, level actors, Blueprints/scripts, animations, audio assets, camera rigs, collision volumes, AI behavior, and generated code.
- Round-trip updates must preserve authoring data and flag implementation conflicts instead of silently overwriting them.

## 14. Minimum Viable Release

1. Game setup wizard and Bible.
2. Narrative spine, levels, scenes, beats, and Player Lane.
3. Four-layer scene editor.
4. Choice/state/variable/gate/mutation system.
5. Inventory and interactive-object definitions.
6. Dialogue and cinematic blocks.
7. Branch/merge visualization and validation.
8. Narrative simulation and state inspector.
9. Versioned VC Writer project format and VC Game Studio handoff API.

## 15. Acceptance Criteria

- A writer can author a complete branching game narrative without engine scripting.
- Every meaningful decision and scene requirement can be expressed as structured logic.
- The same project opens inside VC Game Studio with no re-entry of narrative data.
- Game Studio can identify all authored hooks required for implementation.
- Changing display names does not break references.
- Validation identifies unreachable or contradictory narrative states before implementation.
