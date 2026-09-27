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
- **Skipped events** (their conditions failed) appear in the transcript with
  what they needed, so a path that can never be reached shows up here.
- **The world** panel shows every state, what is carried, object states, arcs,
  choices made, puzzles solved, triggers fired and scenes visited. Change any
  of it to try another path. **Step back** (Backspace) undoes one step.
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
