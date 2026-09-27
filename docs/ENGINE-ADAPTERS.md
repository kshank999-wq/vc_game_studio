# Engine adapters

VC Game Studio hands a project to a game engine through an **adapter**. Godot 4
is the first; Unity 6, Unreal Engine 5 and a custom JSON engine are registered
and shown as "coming later" on the handoff screen.

Code is generated from the story and is never the source of truth (HANDOFF):
every export rewrites the generated folder, and nobody edits it by hand.

## How it fits together

```
Project (story model)
   │  buildIR()                apps/studio/src/renderer/model/handoff/ir.ts
   ▼
HandoffIR (engine-neutral: scenes + timelines, characters, objects with
   │       states and interactions, flags, triggers, gates, choices,
   │       dialogue, story graph, arcs; stable snake_case / PascalCase names)
   │  adapter.generate(ir, outputPath)
   ▼
EngineOutput { files, elements }   one row per element: what it generates,
                                   its files, and a fingerprint
```

- `handoff/engines.ts`: the `EngineAdapter` interface and `fingerprint()`.
- `handoff/index.ts`: the registry (`ENGINES`), the target (`EngineTarget`),
  `planHandoff()` (statuses: Ready / Changed / Issue against the last export)
  and `recordExport()`.
- `handoff/godot.ts`: the Godot 4 adapter.
- `handoff/zip.ts`: the browser download.
- `src/main/handoff.ts`: the desktop app's folder picker and file writer (it
  refuses any path outside the chosen folder).

## Adding an engine

1. Write `handoff/<engine>.ts` exporting an `EngineAdapter` with `available:
   true` and a `generate(ir, outputPath)` that returns files and one
   `ElementOutput` per element. Fingerprint each element from the IR data it
   uses, prefixed with an adapter version, so a change in the generator marks
   everything Changed.
2. Replace its placeholder in `ENGINES` (`handoff/index.ts`).
3. Add tests like `model/__tests__/handoff.test.ts`, and a real-engine check
   like `scripts/check-godot.sh` if the engine can run headless.

Nothing in the story model, the Bible or the handoff screen changes.

## The Godot 4 adapter

- **Runtime** (`addons/vcgs_runtime/`, the same for every project):
  `game_state.gd` (the GameState autoload), `scene_flow.gd` (plays a scene's
  timeline and emits a signal for each event), `interactable.gd`,
  `rule_engine.gd` (conditions and effects), and
  Resource classes for characters, items, locations, cinematics and puzzles.
- **Generated** (`res://vcgs/generated/` by default): a flow controller per
  scene, a `.tres` per character / item / location / cinematic / puzzle, an
  interactable script per object, `logic/rules.gd` (flags, triggers, gates),
  a script per choice, the dialogue table, the story graph, a VO cue list
  (under a `.gdignore`), a README and a manifest.
- **Conditions and effects** are structured rules in VC Game Studio, never
  code. The IR carries them as plain data with engine keys:
  `{ "match": "all", "items": [{ "kind": "flag", "ref": "door_solved", "op": "is", "value": "yes" }] }`
  and effects such as `{ "kind": "take", "ref": "vault_key" }`. Condition
  kinds are flag, item, object, choice, arc, puzzle and visited; effect kinds
  are setFlag, give, take, setObject, arc, solve and fire. An adapter only
  has to read them: in Godot, `rule_engine.gd` checks and applies them;
  triggers fire and puzzles solve themselves after each GameState change;
  events whose `when` fails are skipped; a free play ends when its `ends`
  rule holds; choices and scene exits offer only what their conditions allow.
  The words a writer typed beside a rule travel too, as documentation.
- **Placeholder scenes** (on by default; *Placeholder scenes* on the handoff
  screen): a `scenes/<scene>.tscn` per story scene holding its flow
  controller, a labelled stand-in for the location, characters, objects
  (each wired to its interactable script), items, cinematics, puzzles and
  logic, and a plain on-screen player (`debug_player.gd`). Open one and press
  F6 to play it; `play_story.tscn` plays the story from its Beginning, scene
  after scene, choices on the graph included. They are rewritten on each
  export: build the real scene as an inherited scene saved elsewhere.

  ![The Vault Door's placeholder scene, playing in Godot 4.3](godot-placeholder-scene.png)
- **Checked against Godot 4.3**: `GODOT=/path/to/godot apps/studio/scripts/check-godot.sh`
  exports the sample project and has Godot load every script and resource,
  pull the lever (which fires the trigger, which solves the door, which ends
  the free play) and play the Vault Door scene through its branch; it loads
  every generated .tscn and plays the Vault Door's through its on-screen
  player to the ending. CI runs it.
