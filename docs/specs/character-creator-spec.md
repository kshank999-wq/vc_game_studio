# VC Game Studio — Character Creator: development specification

_Version 1.0 · 13 October 2026 · coding-agent handoff. Text of character-creator-spec.docx._

Purpose: Create playable character, interactive NPC, enemy, ally, and population-group definitions in VC Game Studio; visualize them as 2D map markers and functioning 3D graybox stand-ins; preserve behavior and data for export into Unity, Unreal, or Godot.
1. Product Scope and Principles
One canonical character registry feeds VC Writer dialogue, VC Game Studio scene authoring, the spine, 2D mapping, 3D graybox testing, inventory, AI, and export.
Characters are data-first; final meshes, rigs, animations, audio, and materials can be attached later without losing IDs or logic.
Distinguish actor definitions (templates), instances (placed in scenes), and groups (population spawn recipes). Changes to shared templates should propagate unless an instance overrides them.
Initial scope: profiles, skills/powers, inventory, NPC dialogue links, enemy AI/progression, group populations, placeholders, engine handoff.
2. Primary Character Creator Screen
Region
Functions
Top toolbar
New, Duplicate, Save, Import, Export, Role selector: Player / Enemy NPC / Interactive NPC / Ally / Ambient Extra; search and validation state.
Left artwork pane
Reference images, concept art, portrait, optional 3D asset thumbnail; drag/drop import; select placeholder avatar or bound finished artwork.
Center: identity + abilities
Name, unique ID, archetype/species, gender/presentation where applicable, appearance notes, categories; Skills & Powers cards with + Add, library browse, custom definition.
Adjacent: inventory
Starting loadout, capacity model (unlimited or limited), quantity and item limits, equipment slots, item cards and prefab links.
Right: contextual properties
Properties of selected power/item/AI behavior/group; numeric inputs, range/units, conditions, effects, priority; defaults plus overrides.
Lower tabs
Dialogue & knowledge; AI & detection; progression variants; scene placements; relationships; 2D/3D preview; export diagnostics.
Provide a simple creation wizard for role → baseline archetype → abilities → inventory → role-specific settings → save to registry.
Always display unsaved changes, broken references, placeholder asset state, and preview compatibility.
3. Shared Character Data
Stable UUID, display name, internal slug, role(s), archetype/faction, race/species, sex/gender/presentation if relevant to the project, tags, creator notes, image/media references, visual placeholder preset.
Core locomotion and physical parameters: speed, jump, turn, collision radius/height, health/resource pools, movement mode, interaction radius; engine-independent units and ranges.
Default relationships/faction attitude, scene eligibility and spawn constraints, enabled status, revision and provenance.
Do not hard-code sex or species to behavior. Presets are customizable defaults, not restrictions.
4. Skills, Powers, and Ability Library
Cards show name, type, icon, rank, active/passive, current availability, and associated effect graph; add, duplicate, reorder, disable, override, or remove.
Library taxonomy: Movement (running, sprinting, jumping, flying, teleport); Combat (melee, ranged, block); Magic (fireball, healing, illusion, elemental); Utility (stealth, perception, lockpicking); Social/Interaction (persuasion, trade); Status/Defense (resistance, shields).
Ability detail editor: description, level/unlock conditions, costs, cooldown, range, target type, damage/effect magnitude, duration, animation cue, VFX/SFX placeholder, events, failure behavior, AI use conditions.
Custom power builder must use typed, validated composable actions (target, condition, effect, timing, event) rather than arbitrary untrusted code; advanced code hook explicitly marked as engine-specific.
Each standard library ability ships with an executable graybox implementation or clearly labeled stub; do not imply unimplemented powers will work after export.
5. Inventory and Equipment
Modes: unlimited; slot-count limit; stack count; weight/volume capacity; hybrid. Define starting items and quantities, pickup/drop/use rules, persistence across scenes, and overflow behavior.
Inventory item definitions are references to the shared items library; supports weapons, armor, consumables, keys, quest objects, artifacts, currency and lore.
Equipment slots (hand, off-hand, armor, accessory) with compatibility rules; item may grant skills or modify stats; placeholder sword/shield/staff should visually attach to graybox skeleton or hand socket.
Support default inventory per archetype, overrides per character/variant/instance, and export-safe persistence IDs.
6. Role-Specific Configuration
6.1 Player / Main Character
Starting abilities, skill upgrade rules, initial equipment, capacity, controller mappings, progression branches, persistence, respawn and failure handling.
6.2 Enemy NPC / Enemy Generator
AI skill setting is a profile, not a single magic intelligence number: perception, reaction time, pursuit, navigation, coordination, tactics, accuracy, ability selection, and disengagement.
Define detection modes independently: vision field/angle, line-of-sight, hearing, proximity attack radius; chase distance/time, last-known-position search and reset-to-post conditions.
Starter state machine: Idle → Patrol → Alert → Investigate → Chase → Attack → Search → Return; stunned/flee/dead/disabled as optional states; designer chooses triggers and overrides.
Generate escalating enemy variants by level or encounter tier: increase HP, speed, damage, inventory/weapons, power ranks, perception, decision rules, teamwork, and encounter density while preserving base archetype.
Variant chain example: Orc / Orc Guard / Orc Elite. Each variant lists inherited values, explicit differences, difficulty budget and level eligibility; permit hand tuning and preview.
AI variants must include guardrails on stat growth, max simultaneous attacks, patrol area, spawn budget and performance.
6.3 Interactive NPC
Record identity, role, species, traits, availability, knowledge/topics, quest flags, dialogue entrances, branching responses and conditions; attach dialogue line/scene IDs.
Creating or renaming an NPC immediately updates the shared VC Writer screenplay-style speaker autocomplete/drop-down; preserve ID-based dialogue links on rename.
Character may act as vendor, quest giver, information source, or talk-only ambient actor; interaction radius, prompt and response behavior are configurable.
6.4 Allies / Companions
Faction, trust/recruitment conditions, follow distance, support behavior, inventory sharing, combat rules, dialogue availability, dismissal and persistence.
6.5 Ambient Extras
Can use lightweight walk, idle, talk, work and flee loops without full interactive dialogue or expensive combat logic; promote any extra into a full NPC without losing placement.
7. Character Groups and Population Generator
Groups are reusable named recipes (Village Market, Orc Patrol, Temple Priests), each containing one or more entries: character archetype/variant, count or count range, weight, formation and local activity.
Group editor sets spawn shape (point/rectangle/polygon/path), density, placement spacing, movement routes, wander radius, idle/interaction patterns, schedules, encounter triggers, faction and persistence.
Examples: 20 male village placeholders + 15 female village placeholders + 3 priests; another group of 6 sword-carrying orc sentries.
Drag a group from library onto a designated 2D world/region/room polygon; display 2D icons, bounding area, counts, and preview path/behavior markers.
Opening that map in 3D graybox instantiates the specified moving placeholder characters with simple geometry, props, locomotion, collision and configured behavioral reactions.
Support random seed for reproducible results, density caps, navmesh-aware spawning, collision rejection, and optimization (LOD, pooled spawns, far-distance simplification).
8. Placeholder Character and Behavior Library
Starter dummy forms with customizable simple silhouette, size, tint, label, species-inspired proportions; gender-themed colors optional only, never required for identity.
Low-poly/primitive sword, shield, bow, staff and equipment proxies with attachment points and corresponding hit or interaction placeholders.
Packaged working samples: strolling villager, talking NPC, patrol guard, proximity-aggro orc, sight-aggro orc, companion follower.
In 2D show sprite/icon with facing direction, detection range/radius and patrol line overlays; in 3D spawn equivalent graybox actor and visualize fields on demand.
Character art swap must retain collider/controller logic and equip socket bindings; report rig mismatch and missing animation events instead of silently failing.
9. Scene, Story and Level Designer Integration
Character creation triggers registry event; VC Writer character list and dialogue speaker autocomplete update without manual sync.
Scene editor references character IDs, scene-specific roles, speaking lines, entry/exit conditions, dialogue triggers, equipment and spawn points.
2D placement generates instance ID, transform, map/room ID, inherited template ref and explicit overrides; double-click opens character profile or local instance settings.
Scene-to-3D preview loads navigation, AI, skills, pickups and reactions; handoff from scene to game engine retains stable identifier links.
Groups can cross map hierarchy World → Region/City → Building → Room with spawn scope; avoid spawning the same group twice when navigating views.
10. Engine-Neutral Runtime and Export Contract
Store canonical content in versioned JSON or relational records with typed schema; use an adapter/generator for Unity C#, Unreal Blueprint/C++ scaffolds, and Godot GDScript/C# as configured.
Produce per-character, variant, group, skill and inventory manifests, scene placement manifests, event/behavior graph mappings, asset placeholders, export report and stable ID mapping.
Shared runtime concepts: ActorController, AbilityComponent, InventoryComponent, EquipmentComponent, PerceptionComponent, BehaviorController, DialogueComponent and SpawnGroupController.
Generate baseline scripts/prefabs/scenes and mock assets where supported; imported final artwork is later mapped through asset bindings without replacing gameplay state.
Engine differences (navigation, animation, physics, save system, visual scripting) require explicit adapters and capability checks; unsupported features produce actionable warnings and TODO stubs, not false assurances of fully working game code.
11. Proposed Core Data Model
Entity
Representative fields / relationships
CharacterDefinition
id, name, role[], archetypeId, tags, artRef, defaultStats, abilityRefs[], inventoryProfileId, dialogueProfileId, aiProfileId
AbilityDefinition
id, category, kind, effects[], costs, cooldown, unlockConditions, signals, engineBindings
InventoryProfile
id, capacityMode, limit, startingItems[], equipmentSlots[], overflowPolicy
AIProfile
id, stateGraph, visionAngle, viewDistance, hearingRadius, aggroRadius, disengageDistance, chaseTimeout, tactics
EnemyVariant
id, parentCharacterId, tier, levelRange, statsOverrides, abilityOverrides, loadoutOverrides, aiOverrides
DialogueProfile
id, characterId, topicRefs[], sceneLineRefs[], conditions
CharacterGroup
id, entries[{characterId, count, variantId}], spawnShape, behaviors, placementRules, seed
CharacterInstance
id, characterId, sceneId, mapId, transform, instanceOverrides, groupInstanceId
AssetBinding
ownerId, previewProxy, finalModel, rig, animations, sockets, audioBindings
12. Engineering Requirements and UX Safeguards
Undo/redo, autosave, keyboard accessibility, search/filter by type and tag, duplicate variants, validation errors, bulk group edits, and conflict-aware edits.
Data migrations and versioning; referential integrity when deleting an NPC referenced in dialogue or group placements; show impact and replace/retire options.
Never execute arbitrary library-authored scripts at design time; sandbox preview and validate custom actions. Keep authored logic serializable, deterministic where possible, and unit-tested.
Preview diagnostics: show which conditions led to attack, why actor disengaged, current AI state, ability cooldown and inventory capacity. Provide pause/step/speed controls.
Performance targets to be measured in test scenes; scalable simulation tiers for large crowds. Load-test at least 100 ambient placeholder actors with profile enabled on representative hardware.
13. Workflow: From Character to Playable Graybox
Select Create Character and choose role (player, enemy, interactive NPC, ally or ambient).
Add reference artwork or choose customizable dummy proxy; enter identity, species and baseline stats.
Choose skills/powers from categorized library or define a validated custom ability.
Configure inventory limits, starting items, equipment and visible placeholder props.
Configure AI or dialogue as required by role; create progression variants if enemy.
Save character to shared registry; verify VC Writer speaker list is immediately updated.
Optional: create character group and specify population counts and behaviors.
Drag character or group onto 2D map; set placement and patrol/detection overlays.
Open 3D graybox and play-test navigation, interaction, perception, inventory and ability effects.
Run export validator, choose target engine, generate scaffolding and asset mapping report.
Replace proxy art with final rigged assets in engine and verify sockets, animation and behaviors.
14. Acceptance Criteria for Coding Agent
☐ Character creation produces persistent unique ID and searchable registry entry.
☐ NPC name is available by autocomplete in VC Writer dialogue immediately; name changes do not sever links.
☐ A sample Orc with placeholder sword patrols, detects a player by configured sight/proximity, attacks, and disengages at configured limit in graybox preview.
☐ Enemy level-1 and level-5 variants inherit the same archetype but show distinct loadouts and AI/perception behavior.
☐ Group of 20 villagers can be dropped into a 2D region and displays as 20 navigable moving graybox actors in 3D.
☐ Inventory unlimited/limited modes and starting gear work; unsupported combinations yield clear validation feedback.
☐ Unity, Unreal and Godot exports each generate schema-valid manifests and engine-appropriate starter components, with unsupported mappings reported.
☐ Swapping character artwork does not alter character ID, inventory, dialogue or encounter logic.
15. Implementation Phases
Phase
Deliverables
1 — Foundations
Character registry, CRUD, media pane, role selector, schema, ability cards, inventory and template versioning.
2 — Interactive authoring
Dialogue registry integration, NPC profiles, enemy AI configuration, variant generation and validation.
3 — Scene visualization
2D group placement, 2D overlays, dummy characters and working 3D graybox behaviors.
4 — Handoff
Engine adapters, generated scaffolds, asset binding, tests, documentation and preview diagnostics.
Definition of done: Every supported action is testable in a sample scene; every export retains IDs and semantic behavior mapping; anything not natively implemented is visibly labeled as a stub or required engine-side integration.
