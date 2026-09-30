# Note Sorter

The Note Sorter takes raw notes, such as brainstorms, design docs, voice-memo
transcripts and lore drafts, and turns them into the game. It is built from
[`specs/note-sorter-spec.md`](specs/note-sorter-spec.md) and its UI handoff
[`specs/note-sorter-handoff.md`](specs/note-sorter-handoff.md). Where the two
differ, the handoff wins.

To open it:

- **NOTES** in the top bar
- **View › Note Sorter**

Everything it does is committed to the project, so the studio's **Undo**
(Ctrl+Z) covers every sort, conversion and placement.

## Four steps

The spec's pipeline (Raw Notes → Extract → Categorize → Refine → Map → Build) is
folded into four tabs. They are views, not a wizard: you can open any of them at
any time.

| Step | What you do |
| --- | --- |
| **1 Sort** | **Import** `.txt`, `.md` or `.docx` files, or paste text. Each non-empty line is a passage. To sort one, drag it onto a category bin, click its grip ⠿ and pick a category, or select part of the text and pick one. The sorted words grey out in place and get a margin tag. The source text itself never changes. Categories can come from a template (Action-adventure, Narrative, Systems, or everything in spec §5), be nested as subcategory chips, be renamed with a double-click, and be searched. |
| **2 Convert** | Pick a card and choose **What is it?** There are 18 kinds across Story, World and Systems. The card's category suggests one, and so do words in the note. **Convert** makes a real studio object that keeps a link back to the source words. A note can become more than one object. Cards can also be edited or renamed, connected with the spec §13 verbs (requires, unlocks, …), compared with a likely duplicate, merged, set aside, or unsorted. |
| **3 Build flow** | Converted cards wait in **Ready to place**. Drag one, or click it to pick it up, then drop it where it belongs: a **+** on the Spine or the Player Lane, a scene's Narrative / Behavior / Systemic / Presentation layer, a level, a Game Bible section, or a gameplay system. A placed card stays in the library under **Placed**. Selecting a node shows the notes it was built from. |
| **4 Review** | See where every note stands (unsorted, sorted, converted, placed, set aside) and how far each source has got. The list defaults to *converted but not placed*, the ideas most likely to get lost. It can be filtered by type or source, and each row has its next action. |

## Status markers

- **Unsorted:** grey dot
- **Sorted, still a note:** gold ring
- **Converted:** the object's own symbol
- **Placed:** green
- **Set aside:** dashed ring

Status is always worked out from the project, never stored. If an object is
deleted elsewhere, its note goes back to *converted* or *sorted*. The note
itself is never deleted.

## Where placements go

| Target | What happens |
| --- | --- |
| Spine | The object goes onto the main lane after the node you chose. |
| Player Lane | A lane for the player's progression is created the first time a beat is dropped (a subplot lane, colour `#E8E0C8`). The beat goes on it. |
| Scene layer | Narrative, behavior and systemic notes are used in the scene. A dialogue block becomes a line in the scene with its speaker. |
| Level | The note is appended to the level's notes, and scenes and plot points are linked to the level. |
| Game Bible / system | The placement is recorded, and the object appears in its Bible view. The new types are lore, quests, mechanics, encounters and skills (Progression, Skills, Upgrades and Abilities notes become skills). Every engine gets them as data; see [ENGINE-ADAPTERS.md](ENGINE-ADAPTERS.md#design-definitions). |

## Suggestions

The Review tab has a suggestions panel. It suggests:

- possible duplicates
- new categories that untouched passages mention
- where a card might go, from scene and level names in its text
- names in the raw notes that haven't been sorted yet

Suggestions are **simple rules run on this machine**. No AI model is involved,
and nothing reaches the network. None of them change the game until you approve
one, and the whole panel can be switched off.

## Try it

On an empty Note Sorter, **Try a sample brainstorm** loads three documents for
The Sunken Vault with the Action-adventure categories.

## Not yet

- The raw notes panel shows plain text. Formatting in a `.docx` is not kept.
