<!-- Converted from puzzle-creator-spec.docx. The .docx is the source. -->

# VC Game Studio - Puzzle Creator Development Spec

_Narrative-first, hierarchical puzzle authoring from room-scale puzzle flow to screen-level interactive puzzles_

## 1. Purpose
Puzzle Creator is a dedicated design system for describing a puzzle before implementing it, then progressively converting the written concept into dependencies, clues, objects, conditions, interactions, and playable puzzle mechanics.

## 2. Puzzle-First Writing Workflow

- Describe the puzzle in plain language.
- Define what the player is trying to accomplish.
- Define what the player initially knows and can access.
- List the discoveries, clues, objects, actions, and intermediate solutions.
- Arrange those elements into a dependency hierarchy or graph.
- Bind conceptual elements to actual level objects and locations.
- Define the final on-screen or physical interaction used to solve each puzzle component.
- Test the puzzle for solvability, missing dependencies, dead ends, and unintended sequence breaks.

## 3. Puzzle Scales

| Scale | Example | Authoring Focus |
| --- | --- | --- |
| Area / Room Puzzle | Escape-room sequence | Multiple clues and sub-puzzles distributed through a room or area. |
| Object Puzzle | Locked safe | One object with prerequisites, clues, states, and an unlock result. |
| Screen-Level Puzzle | Dial, symbol grid, circuit, lock mechanism | Direct player interaction with a dedicated puzzle UI. |
| Multi-Area Puzzle | Find pieces in several rooms to open a temple door | Dependencies spanning rooms, levels, or revisited locations. |


## 4. Core Puzzle Definition

- Puzzle ID and title.
- Narrative purpose: why the puzzle exists in the scene/world.
- Player-facing objective.
- Designer description / intended solution.
- Difficulty target and expected solve time.
- Location / linked Level Designer node.
- Entry state and prerequisites.
- Success condition.
- Failure behavior, reset behavior, and retry rules.
- Rewards and outputs: unlock, item, route, state mutation, cinematic, dialogue, progression, etc.

## 5. Hierarchical Puzzle Tree
The designer should be able to build an escape-room-style hierarchy showing exactly what must be discovered or solved before another step becomes available.

- Root Goal: Escape Room / Open Vault / Activate Machine.
- Sub-goals: unlock cabinet, obtain key, decipher clue, restore power.
- Requirements: item possessed, clue discovered, switch activated, code known, NPC information acquired.
- Leaf interactions: inspect painting, move book, pick up torn note, rotate dial, enter digits.
- Nodes can be reordered, nested, grouped, optional, mandatory, hidden, or alternate-path.
- Tree view and graph view should be interchangeable representations of the same puzzle logic.

## 6. Dependency Graph and Logic

- AND gate: all prerequisites required.
- OR gate: any valid prerequisite/path can satisfy the requirement.
- Sequence gate: steps must occur in a defined order.
- State gate: world/player variable must match a condition.
- Inventory gate: player must possess or use an item.
- Knowledge gate: clue or information must have been discovered.
- Timed gate: condition must be completed within a time window.
- Optional branch: provides reward, shortcut, extra clue, or alternate solution.
- Fail-forward branch: incorrect action changes the puzzle but does not necessarily stop progression.

## 7. Example: Safe-Code Puzzle

- Goal: Open the safe.
- Safe requires a four-digit code.
- Designer defines the true code in the Safe object logic.
- Clue A may reveal the first two digits.
- Clue B may reveal how to order the digits.
- Clue C may be optional and confirm the solution.
- Clues are bound to physical objects/locations in the room.
- Player inspects the safe and opens a dedicated safe interaction screen.
- Player enters the code.
- Correct code changes Safe state to Open and triggers its defined output; incorrect code follows retry/feedback rules.

## 8. Screen-Level Puzzle Designer

- Dedicated puzzle interaction canvas for puzzles that take over or focus the screen.
- Template types: keypad, combination dial, sliding tiles, symbol sequence, rotating rings, circuit routing, object assembly, matching, ordering, lever/switch logic, custom.
- Define interactive components, visual states, input methods, constraints, validation, feedback, and completion state.
- Allow custom art/meshes/audio to replace proxies later.
- Puzzle UI preview should simulate the player's interaction without requiring a full game build.

## 9. Puzzle Element Library

- Clue, key, code, note, symbol, lock, container, switch, lever, dial, button, pressure plate, movable object, collectible piece, power source, socket, sequence trigger, timer, door, reward, custom element.
- Each element has a default icon and configurable properties.
- Elements may exist only as logic nodes or may be linked to Level Designer objects.
- Personal puzzle templates can be saved to a reusable library.

## 10. Clue System

- Clue text / visual / audio / environmental clue.
- Location and discovery method.
- What knowledge it communicates.
- Which puzzle requirement(s) it supports.
- Mandatory vs optional.
- Hint strength: subtle, moderate, explicit.
- Used/unused indicator so every authored clue can be traced to a purpose.
- Optional staged hint system that reveals additional assistance after configured conditions.

## 11. Object States and Interactions

- Objects support named states such as Locked, Unlocked, Closed, Open, Powered, Broken, Solved, Empty, Full, Hidden, Revealed.
- Interactions define valid verbs/actions such as inspect, use, combine, enter code, rotate, push, pull, place, remove, activate.
- An interaction can read or mutate puzzle, inventory, player, scene, or world state.
- Puzzle completion can trigger animations, audio, VFX, dialogue, cinematics, doors, inventory changes, or travel links.

## 12. Level Designer Integration

- Create a puzzle from a selected room, object, door, safe, terminal, altar, machine, or other Level Designer element.
- Show puzzle-linked objects with a small visual badge in 2D and 3D editors.
- Selecting a puzzle node can locate/highlight the corresponding object in the level.
- Selecting an object can open its linked puzzle definition.
- Puzzle logic remains centralized in Puzzle Creator; level objects reference it.

## 13. Validation and Puzzle Testing

- Detect missing prerequisites and unconnected nodes.
- Detect circular dependencies that make a puzzle impossible unless intentionally allowed.
- Identify mandatory clues that cannot be reached.
- Identify solution steps that can be bypassed unexpectedly.
- Simulate player state through the dependency graph.
- Provide a 'Can the player solve this?' validation pass.
- Allow designer test mode to mark clues/items as found and observe which actions become available.

## 14. UI Layout

- Left: Puzzle library and hierarchy/tree.
- Center: writing/description view, dependency graph, or screen-puzzle canvas.
- Right: properties inspector for selected puzzle/node/element.
- Bottom or collapsible panel: validation, states, event outputs, and test log.
- Breadcrumbs show Project > World > Level > Room > Puzzle where linked to Level Designer.

## 15. Suggested Data Model

- Puzzle: id, title, description, objective, locationRef, entryConditions, successConditions, outputs.
- PuzzleNode: id, type, label, parent/group, mandatory, conditions, actions, state mutations.
- PuzzleEdge: source, target, dependency type, condition.
- Clue: content, discoveryMethod, hintStrength, linkedRequirements, worldObjectRef.
- InteractiveElement: templateType, states, inputs, validation rule, feedback, asset refs.
- PuzzleTemplate: reusable graph, elements, parameters, presentation placeholders.

## 16. Acceptance Criteria

- Designer can begin with a written puzzle concept without placing game objects.
- Designer can convert the concept into a hierarchical dependency tree/graph.
- Room-scale puzzles can contain multiple sub-puzzles and clues.
- Object-scale puzzles such as a safe can reference distributed clues.
- Screen-level puzzles can be authored and previewed as direct interactions.
- Puzzle nodes can bind to objects in Level Designer.
- The system can validate basic solvability and highlight missing/broken dependencies.
- Puzzle completion can output state changes and progression events for VC Game Studio.
