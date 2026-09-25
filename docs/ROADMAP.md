# Roadmap

> **Superseded, 25 September 2026.** Ken's decision: game writing is part of
> VC Writer (one tool, VC Writer plans everything), and VC Game Studio is the
> implementation upgrade. The plan is now
> [VC Writer addendum 25](https://github.com/kshank999-wq/VCWriter/blob/claude/game-writing/docs/spec/addendum-25-game-writing.md).
> What follows is the original prototype plan, kept for reference.

VC Writer ships first as a standalone product. VC Game Studio embeds all of
it and adds implementation: levels, gameplay systems, engine adapters and
code generation. Both run on the same `@vc/core` project model, so a VC
Writer project opens in Game Studio with nothing re-entered.

## Architecture

```
┌──────────────────────── VC Game Studio ────────────────────────┐
│  World/Level · Gameplay · AI · Cinematics · Code generation    │
│  Engine adapters: Godot │ Unity │ Unreal                       │
│   ┌──────────────────── VC Writer ───────────────────────┐     │
│   │ Setup wizard · Bible · Spine/Player Lane · 4-layer   │     │
│   │ scene editor · Dialogue · Choices · Simulator        │     │
│   └──────────────────────────────────────────────────────┘     │
├────────────────────────────────────────────────────────────────┤
│  @vc/core  (engine-neutral, no UI, runs in browser or Node)    │
│  schema · expressions · runtime state · validator ·            │
│  simulator/path explorer · file format · handoff contract      │
└────────────────────────────────────────────────────────────────┘
```

Key decisions already made in `@vc/core`:

- **Stable ids everywhere.** Every entity has an opaque id; references never
  use display names, so renames are free.
- **Conditions are a small expression language** (`has(itm_key) and
  rel(rel_mara) >= 2`), parsed to an AST, never `eval`'d. Tools can explain
  failures ("why is this choice unavailable?") and code generators can
  translate the AST to GDScript, C# or Blueprint.
- **One state model** for narrative and gameplay: variables, inventory,
  relationships, objectives, puzzles, object states, choice/visit history.
  Mutations are atomic and logged with their source node.
- **Engine data stays out of the narrative.** Game Studio stores
  `ImplementationBinding`s beside the project. Each keeps a hash of the
  authored node, so later edits surface as *Needs Update*, and deletions as
  *Conflict*, instead of silently breaking.
- **Versioned file format** with forward-only migrations.

## VC Writer MVP (spec §14)

| # | Item | Status |
| - | ---- | ------ |
| 1 | Game setup wizard and Bible | Data model done (`Premise`, `Bible`). UI to do. |
| 2 | Spine, levels, scenes, beats, Player Lane | Data model done; milestone-bypass validation done. UI to do. |
| 3 | Four-layer scene editor | Data model done (`narrative`/`behavioral`/`systemic`/`presentation`). UI to do. |
| 4 | Choice / state / variable / gate / mutation system | **Done** in core, with tests. |
| 5 | Inventory and interactive-object definitions | **Done** in core (items, smart objects, verbs, puzzles). UI to do. |
| 6 | Dialogue and cinematic blocks | Data model done; simulator plays them. UI to do. |
| 7 | Branch/merge visualization and validation | Validation **done**; dependency graph data done. Visualization UI to do. |
| 8 | Narrative simulation and state inspector | Engine **done** (`Simulator`, `explorePaths`, CLI `play`). UI to do. |
| 9 | Versioned project format and Game Studio handoff API | **Done** (`format.ts`, `handoff.ts`). |

## Next steps

1. **VC Writer editor UI.** Proposed stack: React + TypeScript in the
   browser, packaged as a desktop app later (Tauri or Electron). Screens, in
   order: project wizard → Bible → spine/Player Lane timeline → scene editor
   (graph + layer panels) → simulator with state inspector → validation panel.
2. **Persistence beyond a single JSON file**: autosave, revision history per
   object, and later collaboration.
3. **Game Studio, phase 2**: the first engine adapter. Godot is the fastest
   to prove out because scenes and scripts are plain text. Generate a
   placeholder level per scene (grey-box geometry, labelled markers for
   NPCs, items and smart objects), a state singleton, and GDScript for gates,
   mutations, triggers and dialogue routing, with protected regions and
   source-id comments. Unity (C#) and Unreal (C++/Blueprint) follow on the
   same `EngineAdapter` interface.

## Open questions

- Desktop-first (spec §17) vs browser-first. The core works for both. The UI
  choice decides packaging.
- Which engine the first Game Studio adapter should target.
- Collaboration model (local files + git, or a hosted project database).
