# Dialogue and voiceover

Dialogue is always somebody's. Every line of dialogue is one of two things:

- **A character's line.** It belongs to the character who says it and sits in
  their dialogue box in the scene.
- **Voiceover.** It plays from a **cinematic** or an **object**: a radio, a TV,
  a loudspeaker, a tape — something the player overhears. Items carry voiceover
  too (a walkie-talkie in the inventory). A voiceover can also say whose voice
  it is (Mara, over the radio), but it doesn't have to.

There is no third kind: a line that is neither is flagged until it is fixed.

## Writing a line

In a scene, click a character in the side panel and choose **+ Dialogue**. A
new line goes in their dialogue box and the script opens on it, ready to type.

For voiceover, click a cinematic or an object in the scene (open **Objects**,
**Cinematics** or **Inventory** in the side panel) and choose **+ Voiceover**.
The line is marked **(V.O.)** and listed under what it plays from, in a
**Voiceover** box like a character's dialogue box.

The other ways in keep to the same rule:

- **In the script**, a cue names a character (an unknown name becomes a new
  character, who joins the scene). A cue that names a cinematic or an object
  instead — `RADIO (V.O.)` — makes the line voiceover from it; the cue list
  offers the scene's cinematics and objects after its characters.
- **The timeline's inspector** has **Said by**: a character, or, under
  *Voiceover from*, any cinematic or object (the scene's own first). With
  voiceover chosen, **Whose voice** can name a character.
- **Dragging Dialogue** from the palette, or **+ Event → Dialogue line** on
  the timeline, gives the line to the scene's first character. With nobody in
  the scene yet, nothing is added and the studio says how to start one.

## How it reads

| Line | Cue |
|---|---|
| A character's | `MARA` |
| Voiceover from the radio | `RADIO (V.O.)` |
| Mara's voice over the radio | `MARA (V.O., RADIO)` |

The script, the timeline, the shot list and the play-through all show the cue
this way.

## Checks

The preflight flags a dialogue line that isn't tied to anyone ("give it a
character, or make it voiceover from a cinematic or an object"), and a
voiceover whose cinematic or object was deleted. Taking a character out of a
scene leaves their lines without a speaker; taking out an object leaves its
voiceover without a source — both are then flagged.

## The scene as a script

A scene reads like a page of a screenplay. Its **heading** is its first line —
`INT. HOTEL — DAY`: inside or outside, the place, the time — set in the
scene's Dialogue tab (type it, or pick from the three menus above). Under it
you write the scene as you would any screenplay: **action** saying what
happens, then each character's cue and what they say, parentheticals,
transitions. Everything said belongs to a character, or is voiceover from
something in the scene (above).

### Beats: putting it in order

The Dialogue tab has two views, **Script** and **Beats**. Beats shows the
scene one card per beat: a line of action, a speech (its cue, its
parenthetical, and a speech spoken at the same time beside it), or a
transition. When the dialogue isn't in the right order:

- **drag** a card to where it belongs, or
- use its **↑ ↓** arrows, or select it and press **Alt+↑ / Alt+↓**.

The script, the timeline, the play-through and the engines all follow the new
order. Dialogue you placed on the timeline by hand keeps its places, filled in
the new order. Each dialogue card shows its line number in the recording
script. Double-click a card (or press Enter) to write it in the script.

### Exporting the script

**Export script…** (in the Dialogue tab, or **File → Export → Script**) gives
the screenplay, this scene or every scene in story order (left to right along
the story graph; scenes with nothing written are left out):

- **Download .fountain** — Fountain, the plain-text screenplay format that
  Final Draft, Highland, WriterSolo and VC Writer open. Scene numbers are the
  scene codes; dual dialogue, emphasis, (V.O.) and (CONT’D) come through.
- **Download page (.html)** or **Print…** — set in Courier 12 with the usual
  screenplay margins, a title page first.

### The recording script

**Recording script…** (in the Dialogue tab, or **File → Export → Recording
script for voice actors**) is how the script runs for the voice actors: each
scene's heading and what is going on, the action between lines for context,
and every line in the order it plays, numbered, with its cue, its direction,
whether it's recorded yet, and the **file name the engines play it by**
(`sc_03_line_02`), so the takes come back named to drop straight in.

- **Lines for: Everyone** — the whole session, with a table of lines and
  words per voice.
- **Lines for: one character** — their sides: only their lines, each with
  the line before it to come in on.

Download it as a page to print or send (.html), as a spreadsheet for the
studio (.csv: file, take, scene, cue, voice, direction, line, cue in,
status), or print it.

## In the engines

Each exported line carries `speaker` (the character, if any) and, for
voiceover, `from` (the key of the cinematic or object) and `from_name`.

- **Godot:** `VCGSDialogue.LINES` has `from` and `from_name`; the debug player
  prints `RADIO (V.O.)` or `MARA (V.O., RADIO)`.
- **Unity:** `StoryWalker.Line` returns the speaker as the cue reads.
- **Unreal:** `DT_Lines` has `From` and `FromName` columns; `GetLine` and
  `OnDialogue` give the speaker as the cue reads.

Play the voiceover from the object in your game (an audio source on the radio
prop) by its `from` key.
