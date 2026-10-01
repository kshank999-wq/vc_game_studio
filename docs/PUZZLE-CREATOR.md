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
- **Centre:** **Writing** (the puzzle in words and its definition), **Steps** (the hierarchy, to build) or **Graph** (the same steps as a dependency graph).
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

## The sample

The Vault Door is written (its objective, concept, purpose, what the player
knows) and built: **Drain the seam** (all of: *Pull the Rusted Lever*, the
lever up; *The seam drains*, door_solved yes), and the optional *Hear Mara at
the door*. It solves as it did before.

## Status against the spec

| Spec | Status |
| --- | --- |
| §2 Writing first | Done: plain words, objective, purpose, knowledge, discoveries turned into steps. |
| §3 Scales | Done as the puzzle's scale; screen-level authoring comes with §8. |
| §4 Definition | Done: id and title, purpose, objective, solution, difficulty, minutes, entry rule, success (its steps or a rule), failure, reset and tries, outputs (When solved). Location: the levels it is bound in (Level Designer V2 §14). |
| §5 Hierarchy | Done: sub-goals, requirements, interactions, nested, ordered, optional, hidden, grouped, alternate paths (any), and the dependency graph (part of, needs first, drag to link). |
| §6 Gates | Done in the studio: AND, OR, sequence, state, inventory, knowledge, needs first, timed, optional branches, rewards on done, wrong moves and fail-forward, with progress in the play-through and Play Mode. Engines: an approximation until the engine phase. |
| §7–§11 | Next: clues, the element library, object states, screen-level puzzles. |
| §12–§13 | Partly (the Level Designer's puzzle overlay and binding, basic validation); the full solvability pass, test mode and badges come later. |
| Engines | The puzzle's compiled rule goes to every engine as before (sequence, links and fail-forward folded into it); the step progress, time limits, rewards and wrong moves come with the engine phase. |
