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
