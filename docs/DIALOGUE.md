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

### Recorded takes

When the audio comes back, upload it and the line is marked **recorded**.

- **One line:** in a beat card (**🎙 Add take**), in the timeline's inspector,
  or in the line's detail in the Game Bible, choose **Upload take…** or drop
  an audio file on it (WAV, MP3, OGG, FLAC, M4A, AIFF…). ▶ plays it back;
  **Replace** swaps in another take; **×** takes it off and the line goes
  back to *to record*.
- **A whole session:** **Takes…** in the Dialogue tab (or **File → Export →
  Recorded takes**) lists every line to record. **Upload takes…** (or drop the
  files on the list) sends each file to the line it's named for — the file
  names the recording script gives, `sc_03_line_02.wav`; anything after the
  name is ignored (`sc_03_line_02_take3.wav`). Files that match no line are
  listed so you can rename them.
- **Download takes (.zip)** gives every take named for its line as the
  engines play it, under `audio/vo/` — drop the folder into your game.

**In the play-through** the takes play as their lines come up: one after
another when a step brings several, both voices together for dual dialogue,
cut off when you go on (as a game does when the player skips). The line
speaking is marked 🔊; ▶ beside a line plays it again. **🔊 Voices** in the
play-through's bar turns them off (remembered). Lines without a take are
read, not heard.

While a take plays, its **subtitle** shows over the foot of the transcript,
centred, white on a dark band: who says it, then the line ("Mara: Lit. You go
first."; a voiceover reads "Radio (V.O.): …"), a row a voice, so a
dual-dialogue pair gets two. It goes when the take ends, or when you go on.
**CC Subtitles** beside **🔊 Voices** turns them off (remembered); with the
voices off there are no takes playing, so no subtitles either.

**In a level's 3D Play Mode**, talking to someone linked to a scene plays
the scene's lines on its card, one beat at a time, as the world stands: lines
whose conditions don't hold are left out, a dual speech is heard with the one
beside it. Each beat's take plays; **E** (Interact) goes to the next line and,
after the last, carries on. **▶ Again** replays the line, **Skip the scene**
leaves it, and **🔊 Voices** turns the takes off (the same setting as the
play-through's). Lines on a choice's branch play in the story's play-through,
where the choice is made.
While a beat's take plays, its subtitle shows at the foot of the 3D view,
as a game shows them: a row a voice, two for a dual speech, gone when the take
ends or you go on. **CC Subtitles** on the card turns them off (the same
setting as the play-through's).
**The sample's lines come recorded**: each has a placeholder take
(synthesized with Piper's LibriTTS voice, CC BY 4.0; see
`apps/studio/src/renderer/assets/sample-takes/NOTICE.md`), so the
play-through and Play Mode can be heard from the first run. Their audio ships
with the app, so it plays on any computer; replace a take the usual way.

In the sample, Mara at the cave mouth is linked to **SC-01 The Cave Mouth**:
talk to her in the level's Play Mode and she says its three lines (and tops
up your lantern).

The audio is kept on this computer, in the app's own storage; the project
file keeps which take each line has (its name, size and length). Open the
project on another computer and the lines still read *recorded*, with
"audio not on this computer": upload it there again, or keep the takes zip
with the project.

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

### Recorded takes

The engine handoff takes each line's recorded take with it, named for the
line (`sc_03_line_02`), and every engine's line data says where it is. They
show on the handoff screen as **Recorded takes (N)**, and go with every send:
to the project folder, a folder the browser may write to, or in the download.

| Engine | Where the takes go | How a line's is played |
|---|---|---|
| Godot | `vcgs/generated/vo/<line>.mp3` (Godot imports them) | `play_story.tscn` plays them; `VCGSDialogue.audio(line_id)` gives an `AudioStream` |
| Unity | `Assets/VCGS/Generated/Resources/VCGS/vo/` | the debug player (`VcgsDebugPlayer`) plays them; `StoryWalker.Voice(game, lineId)` gives the `AudioClip` |
| Unreal | `VCGS/SourceAudio/vo/<line>.wav` (converted to WAV) | run `import_vo.py` once per export: sound waves in `/Game/VCGS/VO`; the debug HUD (`AVcgsDebugHUD`) and the scene flow component play them (`bPlayVoices`), `GetLineAudio` names one |
| JSON | `vcgs/vo/<line>.<ext>` | each line's `audio`, relative to `story.json` |

A take whose audio isn't on this computer is left out, and the studio says
so; the line still names where it would go.

**Try it in the engine** before your game has its own screens, as Godot's
`play_story.tscn` does. Each player shows the scene one beat at a time in a
box (a line, an action, a cinematic, with Continue; a choice's options; an
encounter's Win and Lose) and carries on into the next scene. Each line's take
plays as it comes up, and a dual-dialogue pair's two takes play together.

**Subtitles** show what each voice says while its take plays, centred just
above the box, white on a dark band: who says it, then the line ("Mara: Water's
holding it shut."; a voiceover reads "Radio (V.O.): …"), a row a voice, so a
dual-dialogue pair gets two. They stay up as long as the longer take; a line
without a take (or with voices off) keeps its subtitle up long enough to read,
a second and a twentieth of one a letter, two at the least. Each player has a
switch to turn them off: Godot `show_subtitles`, Unity **Show Subtitles**,
Unreal `bShowSubtitles`. For your own screens: Godot `subtitles()` and
`subtitle_seconds()`, Unity `DebugStory.Subtitles` and `SubtitleSeconds`,
Unreal `GetSubtitles()` (or `vcgs::DebugStory::Subtitles`).

- **Unity:** add **VcgsDebugPlayer** next to VcgsGame, set its scene (as in
  `StoryKeys.Scenes`) and press Play. Enter or Space carries on; 1–9 pick an
  option. The takes play on AudioSources it adds; untick **Play Voices** for
  quiet. The same story without the screen is `DebugStory` (plain C#).
- **Unreal:** run `import_vo.py`, set **AVcgsDebugHUD** as the game mode's HUD
  class, set its `SceneKey` (`VcgsKeys::Scenes`) and press Play. Space or
  Enter does the first option; 1–9 pick one. C still opens the codex, as in
  `AVcgsCodexHUD`. Turn `bPlayVoices` off for quiet. The same story without
  the screen is `vcgs::DebugStory` in `VcgsCore.h`.
