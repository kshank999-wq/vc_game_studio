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
