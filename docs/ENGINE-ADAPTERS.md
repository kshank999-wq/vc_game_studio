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
  timeline and emits a signal for each event), `interactable.gd`, and
  Resource classes for characters, items, locations, cinematics and puzzles.
- **Generated** (`res://vcgs/generated/` by default): a flow controller per
  scene, a `.tres` per character / item / location / cinematic / puzzle, an
  interactable script per object, `logic/rules.gd` (flags, triggers, gates),
  a script per choice, the dialogue table, the story graph, a VO cue list
  (under a `.gdignore`), a README and a manifest.
- **Conditions** (a trigger's "fires when", a gate's "needs") are plain words
  in VC Game Studio today. They are carried into the code as comments and the
  checks pass, until conditions become structured rules.
- **Checked against Godot 4.3**: `GODOT=/path/to/godot apps/studio/scripts/check-godot.sh`
  exports the sample project and has Godot load every script and resource,
  pull the lever and play the Vault Door scene through its branch. CI runs it.
