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
  *Only by an effect* (in the Game Bible) makes a quest's start, a lore entry
  or a mechanic wait for one of those effects instead of a rule. In the sample,
  lighting the lantern at the cave mouth makes Lantern oil available, finding
  the key starts *Open the vault* and its seal reveals *The Drowned Order* (the
  vault door reveals it otherwise), and turning the key completes the quest.
- **Skills, abilities and upgrades** (spec §8) are Game Bible entries, in
  unlock trees. Each is learned a rank at a time up to its **Ranks**, after the
  skills it lists under **Learn first**, when its *Can be learned when* rule
  holds, for what **Each rank costs** (so many of an inventory item: skill
  points, salvage, coins). *Learning it* is what each rank does. The world
  panel's **Skills** lists each tree with every rank learned and **Learn**,
  or what is in the way: fully learned, a skill first, its rule, or its cost
  and what is carried. A learned rank shows in the transcript and is a
  decision on the path, replayed when a path is checked. Rules can ask
  *Skill › is at rank at least / is below rank* (1 is learned), and the effect
  *Give a skill rank* gives one free, up to its ranks. In the sample, the
  *Diving* tree: *Deep Breath* (two free ranks) and the *Lantern Hood* upgrade,
  which needs Deep Breath and the lantern's oil and costs the two salvage
  that beating the eels leaves.
- **Weapons and equipment** (spec §8): an inventory item's Game Bible entry
  can make it **equipment**: its **Slot** (Hand, Head, Light: any name; one
  item a slot), its **Stats** (names and numbers, such as Damage 2; the
  equipped items' add up), what **Each use spends** (so many of another item:
  ammunition) and how many **Uses before it breaks** (0: never). The world
  panel's **Equipment** shows what is in each slot and the stats they add up
  to, and each item of equipment carried with **Equip**, **Use** and **Put
  away** (or why not: not carried, out of ammunition). Equipping puts back
  what was in the slot; a worn-out item breaks and one is gone; an item no
  longer carried comes out of its slot. Each is a decision on the path,
  replayed when a path is checked. Rules can ask *Equipment › is equipped / is
  not equipped* and *Stat › is at least / is below* a number (what the
  equipped items add up to for that stat, 0 with none; the name is chosen
  from the stats your equipment has, in any case), and the effects *Equip
  item* and *Put item away* do it from the story. A trigger, puzzle or quest
  waiting on a stat happens as soon as the gear that meets it is equipped. In the sample, the Diving Knife (Damage 2, three uses) comes with
  lighting the lantern, and the eels leave a Flare Pistol (Damage 1, Light 3,
  a flare a shot) and two flares. Equip the pistol once you have been in the
  vault chamber and the trigger *Flare on the door* (The Vault Door visited
  and Light is at least 3) fires: its light shows the pry marks round the
  lock, and The Last Expedition is found without forcing the door.
- **Crafting** (spec §8): an inventory item's Game Bible entry can give it a
  **recipe**: what it **Takes** (so many of each ingredient), how many **One
  craft makes**, and *Can be crafted when* (a rule; empty: any time). The
  world panel's **Crafting** lists each recipe ("1 × Salvage → 2 × Flare")
  with **Craft**, or what is in the way: its rule, or the first ingredient
  short, with how many are carried. Crafting uses up the ingredients and gives
  what it makes; it is a decision on the path, replayed when a path is
  checked. In the sample, with the Flare Pistol carried, a Salvage makes two
  Flares.
- **Encounters** go on a scene's timeline (**+ Event › Encounter**, new or one
  from the Bible). The preview offers **Win**, only when the encounter's *Can be
  won when* rule holds (otherwise it says what it needs), and **Lose**. A win
  does its *On a win* effects and carries on. A loss does its *On a loss*
  effects, then tries again, ends the game, or carries on, as its *If the
  player loses* says. Edit them in the timeline inspector or the Game Bible.
- **The codex** (the Codex button, or C) shows what the player has found, as
  the engines' codex screens do: the quest log (quests under way with their
  goals, then those done), the characters met (anyone with a *Codex entry* in
  the Bible, once they speak a line; a character without one stays out of it),
  the locations visited (the same, once a scene set there plays), the items
  found (the same, once held; marked while carried, and equipped with its
  slot, "(carried, equipped · Hand)", and kept once used up), the objects used (the same, once used in free play, with how they
  stand now),
  the mechanics available (with their controls and
  description), the skills learned (in the order first learned, with the rank
  of those with more than one, their kind and tree, what they do and their
  description; each rank learned counts as new), the encounters met (their enemies and weakness, and whether
  they were won; one lost still shows, so its weakness is there to read) and
  the lore found, in the order found, with its text.
  The button counts what's new since it was last opened; Escape closes it.
  **Search** it with the box at the top (or press /): only the entries that
  have what you type, ignoring case, stay, in the sections that have any; the
  headings still count everything. Escape clears the search, then leaves the
  box. **Filter** it by section with the row of buttons under the search
  (All, Quests, Characters…, only those the story has): one section alone,
  with the search inside it if there is one ("Nothing matches … in Lore").
  **Sort** each section with the Sort menu: in the order found (the default),
  newest first, or A–Z by name (ignoring case); quests under way still come
  before those done. **Bookmark** an entry with its star (☆): it is marked ★,
  and **★ Bookmarks** among the section buttons shows only the bookmarked
  entries, from every section (searched and sorted as usual). The bookmarks
  last the whole play-through, stepping back or not. **Notes**: the pencil (✎)
  opens a box for the player's own note on an entry (Enter keeps it); it shows
  under the entry as "Note: …", and a search finds it. An empty note is none.
  **Export notes** (in the codex's header) saves them all as a text file: each
  entry with a note, section by section in the codex's order, under
  "SECTION · the entry's first line". **Import notes** reads such a file back
  (from the studio or any engine): each note goes to the entry of that section
  and name, whatever state it is in now ("(won)", "(carried)", a quest's goal
  aside), replacing the note it had; the others stay. Notes for entries not in
  the codex yet are listed, not lost silently. **Share notes** hands the same
  text to the system's share sheet where there is one (a phone, say), and
  copies it otherwise, to paste into a message; **Paste notes** takes in notes
  someone shared, the same way Import notes does. **Email notes** opens your
  mail app with a mail of them ("The Sunken Vault codex notes", the same
  text); when they are too long for a mail link, they go on the clipboard to
  paste into the mail instead. **Text** opens your messages app with a text
  of them (an `sms:` link: phones, and computers with a messages app), for
  you to pick who to send it to; too long for a link, the same way as email.
  The notes buttons sit together under **Notes** (Export, Import, Share,
  Email, Text, Print, Paste). **Print notes** lays them
  out as a page (the story's name, then each section's notes, entry by entry)
  and opens the print dialog; where the page may not print (an embedded page,
  say) it saves that page as an .html file to open and print instead. The
  notes **sync** across
  the studio's windows in this browser, and are there again next time: each
  keeps when it was last changed, and the newer one wins (a note taken off
  stays off). The engines sync the same way through a file. The engines' codex
  screens search, filter, sort and bookmark the same way.
- **Skipped events** (their conditions failed) appear in the transcript with
  what they needed, so a path that can never be reached shows up here.
- **The world** panel shows every state, what is carried, object states, arcs,
  quests, equipment, skills, mechanics, lore, choices made, puzzles solved, encounters won, triggers fired and
  scenes visited. Change any of it to try another path. **Step back**
  (Backspace) undoes one step.
- **Paths** (spec §15) are expected ways through the story, kept in the
  project: play the way the story should go and **Save this run** (at the
  end, or partway). Each path is its decisions (options chosen, encounters won
  or lost, objects used, free plays left), the scenes and plot points it goes
  through, and how it ends. Every path is checked against the story as it is
  now, like tests: played again from its start with the same decisions, it
  passes while it still goes that way, and otherwise says where it first
  differs and why: an option no longer on offer and what it needs, an option
  gone, a choice the story no longer reaches, a scene missed or new, another
  ending. The Paths button counts the paths that break. **Show** takes the
  play-through to where one breaks; **Use this run** makes the run in view a
  path's expected way, after a change made on purpose. The sample comes with
  two: straight on to Shared Light, and through the squeeze with the ring
  pocketed, to Heavy Pockets.
- **Saves** keeps the play-through: three slots in this browser, and a file
  to keep or pass on (Save to a file, Load a file). A save is the whole of
  it, the world, where the player is and the transcript, so loading carries on
  from the very line it was saved at; Step back undoes a load. A save loads
  only in its own project, and not once the part of the story it was saved in
  has been deleted. (The engines save the same story state in their own
  shared format; see ENGINE-ADAPTERS.md.)
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
