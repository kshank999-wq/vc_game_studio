# Puzzle Creator

Narrative-first puzzle authoring (spec:
[`specs/puzzle-creator-spec.md`](specs/puzzle-creator-spec.md)). Describe a
puzzle in plain words before building it, then turn it into steps that decide
when it is solved, and bind those steps to the level. Open it with
**PUZZLES** in the top bar or **Window › Puzzle Creator**; the Level
Designer's and the Bible's **Open in the Puzzle Creator** go straight to a
puzzle.

A puzzle is a story element like any other (a Bible entry of type Puzzle).
Its design lives in it: the written definition as plain fields, its steps as
a tree. The steps compile into its **Solved when** rule, so the play-through,
Play Mode and every engine solve it exactly as they always have: the logic is
written once, here, and level items and other rules point at it.

## The screen (spec §14)

- **Left:** the puzzle library (find, and **+ Puzzle** with a name and a scale), and the open puzzle's steps as a tree.
- **Centre:** **Writing** (the puzzle in words and its definition), **Steps** (the hierarchy, to build), **Graph** (the same steps as a dependency graph), **Elements** (what it is made of), **Clues** (each clue and what it is for, and the staged hints) **Screen** (the screen-puzzle canvas: design one and play it) or **Test** (can the player solve it, and test mode).
- **Above:** where it is, when it is in a level: Project › World › Level › Room › the item › the puzzle; the room and the item open the Level Designer on them.
- **Left, under New puzzle:** **From a template…** (built in, or yours) and **+ From template**.
- **Right:** what is selected: a step, or (nothing selected) the puzzle: when it is solved, when it can begin, what solving it does, where it is in the levels.
- **Below:** what stops it being solved, each a click away from its step.

## Writing first (spec §2, §4)

- **Scale (§3):** Area / room (an escape-room sequence), Object (a locked safe), Screen (a dial, a symbol grid), Multi-area (pieces from several rooms).
- **The puzzle in plain words**, **the player's objective**, **why it is here**, **what the player knows and can reach at the start**, **the intended solution**, **difficulty** (1–5), **expected minutes**, **what a failure does**, **resets** (never, on a failure, when the player leaves, only by an effect) and **tries**.
- **Discoveries, clues, objects and actions:** one per line. **Turn into steps ▸** makes each new line a step: a line starting with a verb (inspect, read, pull, enter, rotate…) an interaction, others a requirement; a line ending in a colon starts a sub-goal for the lines after it, until a blank line. Lines already a step are left alone, so it can be run again as the writing grows.

## Steps (spec §5, §6)

- The puzzle's own goal is the root. Under it go **sub-goals** (unlock the cabinet, restore power), **requirements** (an item held, a clue known, a switch on) and **interactions** (inspect the painting, rotate the dial).
- A sub-goal is done when **all** of its steps are (AND), or **any one** of them is (OR: alternate paths). A requirement or interaction is done when its **Done when** condition holds: any condition the rules know (an item carried, a state, an object's state, lore known, a scene visited, a skill, a stat…).
- **Make it into** gives a step the element it is about in one click: an item to carry, a clue to learn (lore, known only once something reveals it) or a state set to yes, named after the step and put in the Bible.
- Steps can be **optional** (a reward, a shortcut, an extra clue: never needed to solve), **hidden** until reached, **grouped** and noted. Add them under the selected sub-goal, move them up and down, into the sub-goal above (→) and out (←), or to any sub-goal (**Part of**); deleting one takes what is under it.
- **Its steps decide** (on by default once it has steps): the tree writes the puzzle's **Solved when**. Off, the puzzle keeps a rule of its own, edited here or in the Bible. While the steps decide, the Bible shows the rule read-only with a way here.
- A step with nothing that marks it done, or a sub-goal with no required steps, can't be done: the puzzle can't be solved until it is fixed, and the panel below says so.

### Gates (spec §6)

- **Sequence:** a sub-goal done when all its steps are, **in order**: a step waits until the one before it is done. The graph numbers them.
- **State, inventory, knowledge:** a step's **Done when**: a state or an object's state, an item carried or equipped, lore known (also a place visited, a skill, a stat). The tree and the graph mark each STATE, ITEM, KNOW, PLACE or SKILL.
- **Needs first:** a step can need any other step done first (not one it is part of, and never round in a circle). Drag from a step's ● to the step that needs it in the graph, or pick it in the inspector; click an arrow to select it, then **Remove link** (or Delete).
- **Timed:** a sub-goal can be done **within** so many seconds. Its clock starts when its first step is done; run out and what was done under it is undone, to be done again. Play Mode runs the clock; the story play-through has none, so time limits don't apply there.
- **Optional branches:** an optional step can be a reward, a shortcut, an extra clue or an alternate way. It never holds the puzzle up; doing it does what it does.
- **When done:** effects a step does the first time it is done (a reward, a clue revealed, a state set).
- **A wrong move:** a condition that is the player getting it wrong at a step, and what it does. It counts once when it happens, not while it lasts. **Fail-forward** counts it as the step done (the story goes on, worse off); otherwise it is a failure, and a puzzle that **resets on a failure** starts over (a step undone that still holds must stop holding and hold again before it counts).
- The play-through and Play Mode keep each puzzle's progress (what is done, in what order, when a timed sub-goal began, the wrong moves). A puzzle of plain all / any steps is solved by its rule alone, as before.
- **Validation** adds: links to missing steps or round in a circle, a time limit of zero or less, a sequence with optional steps in it, a wrong move that isn't fail-forward in a puzzle that never resets (it can't be put right).
- **In the engines (for now):** the engines get the condition the steps come to: a sequence as all of its steps, links as both holding, fail-forward as either; time limits, rewards and wrong moves aren't there yet. The panel below says so for a puzzle that uses them. The puzzle engine phase brings the progress itself to Godot, Unity and Unreal.

## Elements (spec §9, §11)

- **The library:** clue, key, code, note, symbol, lock, container, switch, lever, dial, button, pressure plate, movable object, collectible piece, power source, socket, sequence trigger, timer, door, reward, custom. Each has an icon, the story element it is (an object with states, an item, lore, a trigger), its states and verbs, and its own properties (a code's true code, a key's door, a timer's seconds, how many pieces).
- **Add** one (named, or named after its kind) and it is in the Bible like any other element, and part of this puzzle. **+ one already in the Bible** adds an existing element. Elements a step names join the puzzle by themselves.
- **States and interactions (§11):** an object's named states (Locked, Unlocked, Closed, Open, Powered, Broken, Solved, Empty, Full, Hidden, Revealed are offered, any name will do) and its interactions: a verb (inspect, use, combine, enter code, rotate, push, pull, place, remove, activate are offered), the state it needs, the state it leaves, a state it sets, a trigger it fires, what else it needs and what else it does. They are the Bible's own states and interactions, so the play-through, Play Mode and every engine play them already. A dial turns round through its positions.
- **+ Step: (a state)** (an object) or **+ Step that needs it** (an item, a clue, a state) makes a step done when the element is so. The inspector lists the steps that use it and the level items that stand for it; an element can also stay a piece of logic with nothing placed.

## Clues (spec §10)

- A **clue** is lore, known once something reveals it, with its **form** (text, visual, audio, environmental), **what it is**, **where**, **how it is found** (inspect, read, hear, find, overhear, combine, be told), **what it tells the player**, its **hint strength** (subtle, moderate, explicit), whether it is **needed** or an optional extra, and the steps it **helps with**.
- **Clues** lists them all with what each is for. A clue no step needs and that helps no step is marked **unused**; a needed clue nothing reveals (no interaction, trigger, level clue or other effect) says so.
- **Staged hints:** each given once, after so many wrong moves, once its condition holds, or both, while the puzzle is under way (its entry rule holds). The play-through shows them; Play Mode shows them on screen.

## What solving it plays (spec §11)

- **When solved, it plays:** animations, audio, VFX, a message on screen, a dialogue, a cinematic. The play-through lists them; Play Mode plays the cinematic and shows the message. Doors and travel links it opens are bound in the Level Designer; items and state changes are **When solved**.

## Templates (spec §9, §15)

- **Save as a template** (with nothing selected, the puzzle's inspector) keeps its definition, steps, elements (with their states, interactions and clue fields), hints and cues on this computer, for any project. Anything outside the puzzle (a scene, a character) is left out, and counted.
- **From a template…** makes a new puzzle with fresh elements in the Bible and fresh steps. Built in: **Safe code** (spec §7: a safe whose code is entered once two clues are found, a painting and a drawer that reveal them, an optional third clue, two staged hints), **Lever and door**, **Plates in order**. Forget one of yours with ×; puzzles made from it stay.

## Screen puzzles (spec §8)

- A puzzle that takes over the screen belongs to an object (the safe's keypad is the safe's). In **Screen**, pick the object and a kind: **keypad**, **combination dial**, **sliding tiles**, **symbol sequence**, **rotating rings**, **circuit routing**, **object assembly**, **matching**, **ordering**, **lever / switch logic** or **custom**.
- Each has its parts and answer: the keypad's code (its own, or a code element's true code) and keys; the dial's numbers and combination; the board size and how shuffled; the symbols and their order; how many rings and segments, where each starts, linked or not; the circuit's board (each cell's piece and solved turn, the source and the sink); the parts and the slot each goes in; the pairs; the items in order; the switches, which others each flips, how they start and how they must end; or a typed answer.
- Every kind has what the player is told, **when right** and **when wrong** feedback, a number of **tries** before it jams (0: any), what a wrong answer also does, and the art and audio that replace the proxy later.
- **Opens on:** one of the object's interactions. Solved, the screen does what that interaction does (the safe becomes Open, its output fires), so the rest of the game sees an ordinary interaction. A wrong answer is a wrong move for the puzzle's staged hints.
- **Preview:** the screen plays beside its design, as the player will see it, with the same rules as the game. Dials, keypads, symbols, assembly, matching, ordering and custom answers are checked when given; tiles, rings, circuits and switches the moment they are right.
- **In play:** in the play-through's free play, the interaction opens the screen; in Play Mode, using the item that stands for the object brings it up (the level waits while it is up), and **Leave** closes it with nothing done.
- **Checks:** a keypad with no code or a code using keys it hasn't got, a combination off the dial, an answer with a symbol not on it, a circuit that doesn't join even solved, switches that can never all be set right, linked rings that can never line up, an assembly slot with no part, a screen with no interaction to open it.
- The built-in **Safe code** template's safe has its keypad: four digits from the Safe code element, three tries.

## Testing it (spec §13)

- **Can the player solve this?** searches what the player can do, through the same rules as the play-through: the interactions of the objects that matter (a screen puzzle's counted as solvable when nothing is wrong with it), the pickups and clues in the levels that give or reveal what it needs, the scenes its steps name. It follows back from what the steps need to what changes it, so it looks only at what can matter. It answers with the shortest way it found, in order, or says what stops it: steps that can never be done, needed clues that can never be found. It also says when a step is done before the player does anything (it can be skipped), and when the puzzle can be solved without a required step (a bypass, as when a puzzle's own rule asks for less than its steps). **From this test's state** asks again from wherever the test has got to.
- **Test mode:** mark items carried, clues known, states and object states set, scenes reached; see what the player can do now (only what changes something), do it, and watch each step: done, can be done, or waiting. The test log says what was marked and done, and what that did.
- **Checks** (below, all the time) add: elements nothing connects (no step needs them and they change nothing a step does), and circular links, which are errors unless the puzzle says **Circular links are intentional**, when they are warnings.

## In the Level Designer (spec §12)

- **🧩 New puzzle from this** (an item's Puzzles section): a room or area becomes where an area puzzle is played (its entry); anything else (a door, a safe, a terminal, an altar, a machine) becomes what an object puzzle is about: its element (the story element it stands for, or a new one of the kind its name suggests, linked to it) and its first step. The Puzzle Creator opens on it.
- **Badges:** every item that is part of a puzzle, or stands for one of its elements, carries a 🧩 badge on the map and a marker over it in the 3D graybox; hover the badge for which puzzles.
- **Locate:** a step's **In the levels** lists the items that stand for it; each opens the Level Designer with the item selected.
- **Open the puzzle:** an item's Puzzles section has ↗ by each part it plays, and lists the puzzles whose element it stands for.
- The logic stays in the Puzzle Creator; level items point at it.

## In the engines

Elements are objects, items, lore, states and triggers, so they go to Godot, Unity and Unreal as they always have: their states, interactions, and (as fields) their kind, properties and clue fields. Staged hints, what solving it plays and screen puzzles wait for the puzzle engine phase (until then the interaction a screen opens on works as it is there); the panel below says so for a puzzle that has them.

## The sample

The Vault Door is written (its objective, concept, purpose, what the player
knows) and built: **Drain the seam** (all of: *Pull the Rusted Lever*, the
lever up; *The seam drains*, door_solved yes), and the optional *Hear Mara at
the door*. It solves as it did before. The Rusted Lever is a lever element; solving it plays the water draining and a line on screen.

## Status against the spec

| Spec | Status |
| --- | --- |
| §2 Writing first | Done: plain words, objective, purpose, knowledge, discoveries turned into steps. |
| §3 Scales | Done as the puzzle's scale; screen-level authoring comes with §8. |
| §4 Definition | Done: id and title, purpose, objective, solution, difficulty, minutes, entry rule, success (its steps or a rule), failure, reset and tries, outputs (When solved). Location: the levels it is bound in (Level Designer V2 §14). |
| §5 Hierarchy | Done: sub-goals, requirements, interactions, nested, ordered, optional, hidden, grouped, alternate paths (any), and the dependency graph (part of, needs first, drag to link). |
| §6 Gates | Done in the studio: AND, OR, sequence, state, inventory, knowledge, needs first, timed, optional branches, rewards on done, wrong moves and fail-forward, with progress in the play-through and Play Mode. Engines: an approximation until the engine phase. |
| §7 Example | Done as the built-in Safe code template, with its keypad. |
| §8 Screen-level puzzles | Done: every template type, components, states, input, constraints, validation, feedback, completion (the interaction it opens on), art and audio placeholders, a preview that plays it. |
| §9 Element library | Done: every kind, icons, properties, logic-only or linked to level items, personal templates. |
| §10 Clue system | Done: form, content, location, discovery, knowledge, requirements supported, needed or optional, hint strength, used / unused, staged hints. |
| §11 States and interactions | Done (the Bible's states and interactions, with the named states and verbs offered); what solving it plays. |
| §12 Level Designer | Done: a puzzle from a room or an object, badges in 2D and 3D, locate a step's items, open an item's puzzles, breadcrumbs, logic kept in the Puzzle Creator. |
| §13 Validation and testing | Done: missing prerequisites, unconnected elements, circular links (unless intended), needed clues that can't be found, steps that can be skipped or bypassed, "Can the player solve this?", test mode with a log. |
| §14 Layout | Done: library and tree left; writing, steps, graph, elements, clues, screen and test centre; inspector right; validation below; breadcrumbs above. |
| Engines | The puzzle's compiled rule goes to every engine as before (sequence, links and fail-forward folded into it); the step progress, time limits, rewards and wrong moves come with the engine phase. |
