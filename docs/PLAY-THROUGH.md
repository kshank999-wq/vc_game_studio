# Play-through

**View › Play-through** (F5, or ▶ in the top bar) plays the story inside the
studio the way the generated engine code will: from the Beginning along the
spine, through each scene's timeline, choices and free play, to the ending it
reaches. **Play from here** (Shift+F5, or right-click a node) starts at the
selected scene with a fresh world. It can have a window of its own
(Window › Open in a new window › Play-through), so the story plays on one
monitor while you fix it on another.

- **Lines, actions and cinematics** wait for Continue (Enter). *To the next
  decision* runs on to the next choice or free play.
- **Choices** list every option. One whose conditions fail is shown greyed with
  what it needs; press 1–9 to pick.
- **Free play** lists the scene's objects and the verbs that work right now
  (a verb that doesn't says why). It ends by itself when its end rule holds;
  *Skip ahead* leaves it early.
- **Triggers fire and puzzles solve themselves** when their conditions come
  true, after every change, as in the engine runtime. Routes out of a scene
  are taken in order: the first whose conditions hold, else on along the spine.
- **Quests** start by their *Starts when* rule (at once when it's empty) and
  complete when their *Complete when* rule holds, paying their *Reward*
  effects. Both show in the transcript, and the world panel lists each quest
  as not started, under way or done (change it to try a path). A quest with no
  *Complete when* rule stays under way. Set these in the quest's Game Bible
  entry.
- **Lore** is discovered, and a **mechanic** becomes available, once its rule
  holds (*Discovered when*, *Available when*; at once when it's empty). Both
  show in the transcript, and the world panel lists them to switch by hand.
  Any rule can ask about them, and about quests: *Quest › is done / is not
  done / is under way / has not started*, *Lore › is known / is not known*,
  *Mechanic › is available / is not available*. Effects can *Start quest*
  (one under way or done stays as it is), *Complete quest* (done at once,
  paying its reward once), *Reveal lore* and *Make mechanic available*.
- **Encounters** go on a scene's timeline (**+ Event › Encounter**, new or one
  from the Bible). The preview offers **Win**, only when the encounter's *Can be
  won when* rule holds (otherwise it says what it needs), and **Lose**. A win
  does its *On a win* effects and carries on. A loss does its *On a loss*
  effects, then tries again, ends the game, or carries on, as its *If the
  player loses* says. Edit them in the timeline inspector or the Game Bible.
- **Skipped events** (their conditions failed) appear in the transcript with
  what they needed, so a path that can never be reached shows up here.
- **The world** panel shows every state, what is carried, object states, arcs,
  quests, mechanics, lore, choices made, puzzles solved, encounters won, triggers fired and
  scenes visited. Change any of it to try another path. **Step back**
  (Backspace) undoes one step.
- The story stops with a reason when it reaches an ending or game over, a node
  with nothing after it, or a loop that never stops for the player.

The engine is `apps/studio/src/renderer/model/play.ts`: pure functions over
the project, tested in `model/__tests__/play.test.ts`.

## Deleting

Deleting anything that other parts of the project depend on says so first:
the scenes that use it, the lines a character speaks, an arc lane tied to
them, scenes set in a location, timeline events, story connections, subplots
that start or end on it, and every condition or effect that names it
(`model/impact.ts`). Taking an element out of the only scene that uses it
deletes it, and warns the same way. The Game Bible has a Delete button on
each element.
