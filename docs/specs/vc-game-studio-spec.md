# VC Game Studio

_Integrated Game Creation Environment with VC Rider Narrative Authoring_

Development Specification • Version 1.0 • September 22, 2026

> Converted from `vc-game-studio-spec.docx` (the original is kept alongside). The docx is the source of truth.
>
> Note: this spec calls the narrative module "VC Rider"; it is the same product as **VC Writer**.

## 1. Product Definition

VC Game Studio is the full game-development environment. It includes the complete VC Rider authoring system and extends it into level design, gameplay systems, engine implementation, asset binding, simulation, cinematics, AI behavior, and code generation. The product goal is a continuous pipeline from written intent to a playable implementation while keeping narrative logic and game-world implementation synchronized.

## 2. Product Architecture

| Module | Responsibility |
| --- | --- |
| VC Rider (embedded) | Narrative Bible, spine, scenes, dialogue, branching choices, state logic, inventory intent, puzzles, interactive points, cinematics, presentation metadata. |
| World / Level Studio | Physical spaces, level maps, terrain, rooms, caves, traversal, encounters, spawn points, volumes, lighting, environmental systems. |
| Gameplay Systems | Player controller, movement, combat, inventory runtime, weapons, resources, abilities, interaction framework, puzzles, progression. |
| AI / Character Systems | NPC/companion behavior, perception, navigation, combat behavior, schedules, reactions, relationship/state-driven behavior. |
| Cinematics / Presentation | Sequencing, cameras, animation, dialogue playback, audio, music, VFX, transitions, environmental presentation. |
| Logic / Code Generation | Transforms structured authoring logic into engine-ready graphs/scripts/code with traceable bindings. |
| Build / Validation | Playtest, state validation, dependency checks, profiling hooks, packaging/export adapters. |

## 3. Embedded VC Rider Requirements

VC Game Studio must contain the full VC Rider functionality rather than a reduced import viewer. Narrative designers can author or edit the Bible, spine, scenes, player lane, choices, state mutations, inventory, puzzles, environmental interactions, and cinematics directly inside Game Studio.

- Single canonical project model shared by VC Rider and Game Studio.
- Narrative-only users are not exposed to engine complexity unless they choose implementation views.
- Implementation status appears on Rider nodes: Unbound, Partially Bound, Implemented, Needs Update, Conflict.
- Changes propagate through stable IDs and dependency tracking.

## 4. Scene-to-Game Implementation Pipeline

1. Designer authors scene in VC Rider using the four-layer scene model.
2. Game Studio reads all scene entities, gates, mutations, objectives, triggers, dialogue, presentation notes, and required interactions.
3. Implementation planner creates an implementation checklist and identifies missing assets/systems.
4. Designer binds authored entities to level actors, prefabs/blueprints, AI agents, inventory items, animations, audio, cameras, and scripts.
5. Code/graph generator creates runtime logic for supported constructs.
6. Designer reviews generated logic before commit; generated elements retain a backlink to the Rider source node.
7. Playtest feeds runtime state and errors back into the scene graph.

## 5. World and Level Design

- Hierarchical world structure: world → region → level/map → sublevel/room/zone → scene/encounter.
- 2D planning view plus 3D implementation view.
- Place spawn points, objectives, NPCs, enemies, companions, pickups, smart objects, puzzles, triggers, doors, checkpoints, hazards, exits, and cinematic anchors.
- Link level elements directly to VC Rider scene nodes.
- Support streaming/sublevels and reusable prefabs/templates.
- Level validation checks required narrative entities against actual placed/bound objects.

## 6. Cave and Environmental Mechanics

Cave mechanics are a first-class environmental system in VC Game Studio. VC Rider defines narrative/gameplay intent; Game Studio supplies physical implementation.

- Traversal: narrow passages, crouch/crawl, climbing, ledges, drops, squeezes, ladders/ropes, swimming/wading, slippery surfaces, vertical shafts, and blocked passages.
- Visibility: darkness zones, player light sources, extinguishable lights, visibility ranges, fog/dust, adaptation, and reveal mechanics.
- Hazards: unstable rock, collapses, falling debris, water rise, gas/air-quality concepts, heat/cold, pits, moving surfaces, and designer-defined hazards.
- Navigation and spatial cues: branching tunnels, landmarks, map restrictions, echo/audio direction, breadcrumb systems, and discoverable shortcuts.
- Environmental puzzles: pressure mechanisms, movable objects, water routing, light/shadow, sound, sequence puzzles, keys, switches, and stateful cave objects.
- System hooks: stamina/resource drain, inventory requirements, companion constraints, AI navigation rules, trigger volumes, checkpoint logic, and scripted events.
- All mechanics must be data-driven so additional environment types can reuse the same framework.

## 7. Runtime State System

- Typed variables: Boolean, integer, float, string, enum, tag/set, object/entity reference, and custom structured values.
- Scopes: global, level, scene, quest, character, relationship, inventory, object, and temporary runtime.
- State gates evaluate expressions; state mutations execute atomic or grouped changes.
- Transaction/log system records why a state changed and which Rider/Game Studio node caused it.
- Save/load serializes all persistent state with schema/version migration.

## 8. Inventory, Weapons, Resources, and Progression

- Runtime implementation of Rider-defined inventory entities.
- Pickups, drops, equip/unequip, stack/quantity, consumables, durability if enabled, ammunition/resources, keys, quest items, crafting ingredients, and custom categories.
- Weapon and ability systems expose configurable stats and events without hard-coding a genre.
- Progression supports skills, abilities, upgrades, unlock trees, reputation/relationship progression, and custom progression tracks.
- All changes can trigger narrative conditions and are visible to the Rider state graph.

## 9. Interaction and Smart Object Framework

- Every interactive object exposes verbs/actions, eligibility conditions, prompts, animation hooks, audio/VFX hooks, state transitions, and outcomes.
- Interactions can be authored visually or generated from Rider definitions.
- Objects support reusable state machines such as closed/open/locked/broken/disabled/activated, with custom states.
- Triggers include proximity, overlap, line-of-sight, use/interact, timer, state change, dialogue result, inventory event, combat event, and custom events.

## 10. Puzzle System

- Graph-based puzzle editor maps components, states, conditions, allowed actions, reset rules, failure states, hints, rewards, and completion output.
- Support ordered sequences, unordered collections, logic combinations, spatial puzzles, inventory puzzles, dialogue puzzles, environmental puzzles, and custom logic.
- Puzzle completion writes state mutations back to the shared runtime state system.
- Debug mode visualizes current component state and why a condition is or is not satisfied.

## 11. NPC, Companion, and AI Systems

- Bind Rider characters to runtime actor definitions.
- Behavior layer supports patrol, idle, interaction, combat, follow, flee, search, assist, scripted movement, and custom states.
- AI behavior can react to world state, relationships, player choices, inventory, quest state, and scene progression.
- Dialogue and behavior share the same state source so an NPC cannot present narrative options inconsistent with gameplay state.
- Companion-specific systems include follow distance, contextual actions, restrictions, relationship effects, and scene-directed behavior.

## 12. Cinematics and Presentation

- Translate Rider cinematic blocks into a timeline/sequencer representation.
- Bind cameras, lenses/framing, actors, animation, dialogue, facial performance, audio, music, VFX, lighting, and environmental events.
- Support skippable/non-skippable, branching, interactive, interruptible, and gameplay-to-cinematic transitions.
- Allow a cinematic to mutate game state and return control at a defined spawn/state.

## 13. Code and Logic Generation

Game Studio should generate implementation scaffolding from structured VC Rider and Game Studio graphs while preserving designer control. Generated code must be inspectable, traceable, and regenerable without destroying hand-authored extensions.

- Generate state gates, mutations, objective checks, trigger handlers, inventory operations, dialogue routing, puzzle conditions, cinematic triggers, and scene completion logic.
- Use protected generated regions or partial-class/component patterns so custom code survives regeneration.
- Every generated block includes source IDs linking it to the authoring node.
- Provide diff/review before regeneration overwrites generated artifacts.
- Support engine adapters rather than baking one engine's API into the core data model.

## 14. Engine Adapter Layer

- Core VC Game Studio data remains engine-neutral.
- Adapters translate common systems into target-engine constructs: scenes/maps, actors/entities, components, prefabs/blueprints, scripts, animation timelines, audio, UI, navigation, and save systems.
- Adapter capability matrix reports what can be generated automatically, what requires binding, and what is unsupported.
- Initial architecture should allow Unreal, Unity, Godot, or future proprietary runtime targets without changing the narrative schema.

## 15. Debugging, Simulation, and Playtest

- Run narrative-only simulation, system simulation, or full playable test.
- Live state inspector shows variables, inventory, objectives, relationships, AI states, active triggers, and current narrative node.
- Trace view answers: 'Why is this choice/objective/door unavailable?' by displaying failed conditions.
- Record playthrough paths and compare them against expected narrative paths.
- Flag unreachable content, broken bindings, missing assets, unhandled states, orphaned triggers, and conflicting mutations.

## 16. Collaboration and Versioning

- Role-aware editing for writer/narrative designer, level designer, gameplay programmer, cinematic designer, audio, and reviewer.
- Object-level revision history and change ownership.
- Conflict detection when narrative logic changes after implementation.
- Comments/tasks can attach to any scene, node, entity, level object, binding, or generated-code unit.
- Project schema migrations are explicit and reversible where practical.

## 17. Suggested Technical Architecture

| Layer | Recommendation |
| --- | --- |
| Authoring UI | Desktop-first modular editor with graph, timeline/lane, outliner, property inspector, Bible, 2D level plan, 3D viewport integration. |
| Core Domain | Engine-neutral typed entity/component model with stable UUID references. |
| Persistence | Versioned project database plus JSON interchange/snapshots; asset files stored separately with content hashes. |
| Rules | Expression evaluator + event/action graph for gates, triggers, mutations, objectives, puzzles, and dialogue. |
| Runtime Bridge | Engine adapter interface and generated runtime support library. |
| Generation | Template/AST-based code generation with protected extension points and source mapping. |
| Validation | Static graph validator plus runtime telemetry and trace logs. |

## 18. Delivery Phases

| Phase | Scope |
| --- | --- |
| Phase 1 — Narrative Foundation | Embed VC Rider; Bible, spine, scene layers, choices, variables, inventory, dialogue, cinematics, simulation. |
| Phase 2 — Implementation Core | World/level hierarchy, object binding, smart objects, triggers, objectives, inventory runtime, code generation foundation. |
| Phase 3 — Gameplay Systems | Player systems, weapons/resources, progression, puzzle framework, AI/companions, environmental/cave mechanics. |
| Phase 4 — Presentation | Sequencer/cinematics, audio, camera, animation/VFX hooks, polished scene-to-game workflow. |
| Phase 5 — Engine/Build Expansion | Additional engine adapters, packaging, profiling, collaboration hardening, automated tests and validation. |

## 19. Acceptance Criteria

- A VC Rider project opens natively in VC Game Studio with all narrative data intact.
- A designer can bind a Rider scene to a physical level and implement required objects, NPCs, triggers, puzzles, inventory, and cinematics.
- Supported scene logic can generate runtime scaffolding/code with source traceability.
- Narrative and gameplay state use one coherent state model.
- A playtest can trace a runtime event back to the originating Rider/Game Studio node.
- Narrative changes after implementation produce actionable change/conflict indicators rather than silent breakage.
- The architecture supports multiple target engines through adapters.
