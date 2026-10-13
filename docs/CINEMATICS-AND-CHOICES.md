# Cinematics and choice options

## Shot lists

Every cinematic has its own authoring panel (spec §17): open it from the
cinematic's detail ("Open the shot list" / "Break it into shots…"), from its
timeline event, or by right-clicking it on the story graph.

- **The strip** along the top is a sequencer: each shot in order, as wide as
  it holds, with non-cut transitions marked.
- **The storyboard** shows each shot as a card: a framing thumbnail (how big
  the subject sits in the frame), framing · move · lens, what we see, and the
  line spoken over it. Reorder with ← →, duplicate, delete; "+ Shot" adds after
  the selected shot and carries its framing, lens and cast on.
- **A shot** has framing, camera move, lens / field of view, who is in frame,
  what we see, a script line from the cinematic's scenes spoken over it,
  audio / music, VFX / lighting, how long it holds, the transition into the
  next shot, and notes. With no shot selected the panel shows the cinematic's
  own record (camera notes, audio, back to gameplay, skippable).
- Once a cinematic has shots, its running time and shot count on the
  timeline come from them. The Cinematics report prints the shot list as a
  table, the play-through lists each shot, and the Godot export writes it to
  the cinematic's resource (`shot_list`, `seconds`, `skippable`).

## The Opening

Every game starts with an **Opening**, the very first box on the spine,
before Beginning: the game's opening cinematic and its credits. It is a
cinematic like any other, with its own shot list, but it is locked in place:
it can't be moved or deleted, and nothing goes before it or between it and
Beginning.

- **Double-click it** (or any cinematic) to open its shot list and design it
  shot by shot.
- **Opening credits** sit under its shots: a role and a name for each card,
  in the order they roll. It starts with placeholders (A game by, Directed
  by, Written by, Music by, Starring). Leave a name empty to keep it as a
  placeholder; it shows as `[name]`. Add, reorder and remove cards as you
  like.
- In the **play-through** the Opening plays first, its shots and credits
  shown, and the story carries straight on into what follows it.
- The **engines** start the story there: its graph node is marked `start`,
  and it has the fields `opening: yes` and `credits`: one card a line, as
  `Directed by — Ken` or `Directed by — [name]` while it is a placeholder.

Projects made before the Opening existed are given one the first time they
open, in front of Beginning; nothing else on the spine moves.

## Plot points you write in

Double-click a plot point (Beginning and Ending too) to open it in the same
writing box as a scene: Script, Summary, Purpose and Notes, with the scene
elements around it. Its script plays in the play-through when the story
reaches it, and its lines go to the engines with the rest. Ending's script
plays and then the story ends.

## Endings

A new project's spine runs from the Opening and Beginning through its plot
points and stays **open**: there is no Ending on it until you put one there.
Its endings wait in the **Endings rail**, the panel down the right of the
story graph, which stays put whatever the pan and zoom: **Ending 1** to start
with, and **+ Ending** adds **Ending 2**, **Ending 3** and so on, top to
bottom. (The Game Setup Wizard starts a game with several or branching
endings with three.) Drag an ending up or down the rail to reorder it;
double-click it to write it.

Tie the story into them: drag from a plot point's, scene's or choice's gold
ring to an ending. A plot point or scene with routes out takes the first
whose **conditions** hold (right-click the route, **Conditions & effects…**, to set them: items carried,
choices made, puzzles solved, places visited, stats), so one way of playing
reaches Ending 1 and another Ending 2; with none holding it goes on along
the spine. The play-through stops at the ending reached, and says so when
the spine runs out with no ending tied in yet. An ending nothing leads to
gets a "!" until something does. The engines get every route with its
conditions, as for any branch.

## Options that go, lock or hide

Every option of a choice (a branch in a scene's timeline, the option that
carries on along the main track, or a route out of a choice on the story
graph) has two settings under *Conditions & effects*:

- **After it's picked**: *stays on offer* (the default), *disappears*, or
  *stays, but can't be picked again* (shown greyed, "already chosen").
- **Hidden until its conditions are met**, instead of shown greyed with what
  it needs.

The timeline marks a branch "· once" or "· locks", and a graph route's pill
says "once" or "locks". A choice whose options have all gone stops the
play-through with "Stuck at …: no option is left to pick".

Other kinds of choice from the spec are built from conditions: a **one-time**
choice is "Available when: this choice was not answered"; **mutually
exclusive** options each need "the other was not chosen"; a **revealed**
option is a hidden one whose condition later comes true.

In the engine: GameState remembers picks by option key (`picked`), the scene
flow offers only what can be picked and lists everything with its state in
`options_detail`, and each choice script has `offered(game)` and
`listed(game)`.
