# Comments, tasks and history

Spec §16 (Collaboration and Versioning): comments and tasks can go on
anything in the project, and everything keeps its own edit history.

## Who you are

**Preferences › You**: your **name** and **role** (writer, narrative designer,
level designer, gameplay programmer, cinematic designer, audio, reviewer).
Both go on your comments and on every change you make. They are kept on this
computer, not in the project. Without a name, you are "You".

## Comments and tasks

Every detail panel and inspector has a **Comments and history** part:
- **Elements:** scenes, characters, items, objects, lore and every other
  Bible entry (the element's detail, on the graph, in a scene or in the Bible).
- **Branches and connections:** right-click a branch › *Conditions & effects…*.
- **Levels and level items:** the Level Designer's inspector.
- **Generated files:** under the code in **Engine handoff**, *Comments on …*.

There are two kinds:
- A **comment** takes replies and is **resolved** when settled.
- A **task** is for a role, or for anyone, and is ticked **done** by whoever
  does it.

Done tasks and resolved comments are hidden until you ask for them.

The speech-bubble button in the top bar (or **View › Comments and changes**)
opens the project's list. It shows every open comment and task, with your
role's tasks first (tasks for other roles are filtered out until you pick
*Every role*). Each entry opens the thing it is about.

## History

Every change is recorded against what it changed, with who made it and when:
- story elements
- connections
- levels
- level items
- a scene's script and timeline, which count as changes to the scene

Changes by the same person to the same thing within five minutes are one
entry. Each thing keeps its last 40 entries.

- **History** (beside Comments) lists the thing's changes, newest first: what
  changed ("Changed name, summary", "Created", "Deleted"), by whom, and when.
  *Last changed by* at the top says who owns the latest version.
- **Restore before this** puts the thing back as it was just before that
  change. A deleted connection, level or level item comes back with
  **Restore**. Restoring is a change too: it is recorded, and Undo takes it
  back. A scene's script and timeline are not part of the scene element, so
  restoring the scene leaves them as they are.
- **Changes after implementation.** Once the story has been sent to an
  engine, anything changed since says so ("after the last export to godot:
  the engine's copy is behind"). *Comments and changes › Changes* lists
  everything that has changed since the last export, and the latest changes
  across the project.

The history and comments are saved in the project file (`comments`,
`revisions`). Undo and redo take them back and forth with the rest.

## In the engines

Open comments and tasks go to the engine with the story, for the team there
(the IR's `notes`). Each engine gets them as follows:

| Engine | TASKS.md | Beside what it is about |
| --- | --- | --- |
| Godot | `TASKS.md` in the output folder | `# TODO(VCGS)` lines at the top of a level's script, for the level and each item (by export name) |
| Unity | `TASKS.md` | `// TODO(VCGS)` above the element's constant in `StoryKeys.cs` |
| Unreal | `TASKS.md` | `// TODO(VCGS)` above the element's constant in `VcgsStoryKeys.h` |
| JSON | `TASKS.md` | `notes[]` in `story.json`, described in the schema |

A comment on a generated file goes at the top of that file as TODO lines. In
Godot resources and scenes, it goes after the header line.

TASKS.md names each thing as the engine knows it: a key constant, a level
item's export name and GUID, or a file's path. Replies are listed under their
comment. Tasks are answered and ticked off in VC Game Studio: the next export
rewrites TASKS.md and the TODO lines.

Comments change only TASKS.md and the TODO lines, never what the handoff says
has changed in the story. The sample has three: a task for audio on the Vault
Key, a comment with a reply on the *Pocket it* branch, and a task for the
gameplay programmer on Mara. Each engine's check finds them.
