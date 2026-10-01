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
- **Centre:** **Writing** (the puzzle in words and its definition) or **Steps** (the hierarchy, to build).
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
| §5 Hierarchy | Done: sub-goals, requirements, interactions, nested, ordered, optional, hidden, grouped, alternate paths (any). The graph view comes next. |
| §6 Gates | AND and OR now; sequence, state, inventory, knowledge, timed, optional branches and fail-forward with the graph. |
| §7–§11 | Next: clues, the element library, object states, screen-level puzzles. |
| §12–§13 | Partly (the Level Designer's puzzle overlay and binding, basic validation); the full solvability pass, test mode and badges come later. |
| Engines | The puzzle's compiled rule goes to every engine as before; the design itself comes with the engine phase. |
