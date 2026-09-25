# VC Game Studio

Home of **VC Writer**, an interactive game-writing and narrative-authoring
tool, and **VC Game Studio**, the full game-creation platform that embeds VC
Writer and turns authored stories into engine code for Godot, Unity and
Unreal Engine, with placeholders standing in for art, environments and
characters.

> **Where the work is now.** Game *writing* (planning the story, the Bible,
> choices, state, objectives, puzzles, the Story Map) is being built inside
> **VC Writer**, in the [VCWriter repo](https://github.com/kshank999-wq/VCWriter)
> on branch `claude/game-writing`. The plan is
> [addendum 25](https://github.com/kshank999-wq/VCWriter/blob/claude/game-writing/docs/spec/addendum-25-game-writing.md).
> VC Writer plans everything; **this repo becomes VC Game Studio**, which
> implements: engine code for Godot, Unity and Unreal, asset import, and
> placeholders for art. The `@vc/core` package here was the first prototype of
> the shared model; its ideas are being ported into VC Writer's domain package
> stage by stage, and Game Studio will read VC Writer's `.vcw` files directly.

- Specs: [`docs/specs/vc-writer-spec.md`](docs/specs/vc-writer-spec.md),
  [`docs/specs/vc-game-studio-spec.md`](docs/specs/vc-game-studio-spec.md)
- Plan and status: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Packages

| Package | What it is |
| --- | --- |
| [`packages/core`](packages/core) (`@vc/core`) | Engine-neutral project model shared by both products: schema, expression language, runtime state, validator, simulator/path explorer, file format, Game Studio handoff contract. |
| [`packages/cli`](packages/cli) (`vcw`) | Command line for validating, exploring and playing VC Writer projects. |

## Getting started

Requires Node.js 22+.

```bash
npm install
npm test                                              # run the test suite
npm run vcw -- validate examples/sunken-vault.game.json # static checks
npm run vcw -- explore  examples/sunken-vault.game.json # every playthrough
npm run vcw -- play     examples/sunken-vault.game.json # play it as text
```

`examples/sunken-vault.game.json` is a small cave adventure. It exercises
choices, inventory, relationships, a smart object, a puzzle, a trigger and a
cinematic.

## Writing conditions

Gates, choice availability and transitions use a small expression language:

```
has(itm_lantern) and var_lantern_oil > 0
rel(rel_mara) >= 1 or chose(cho_show_key)
state(obj_lever) == "up"
objective(objv_open_vault) == "done"
```

Bare names are variable ids. Built-ins: `has`, `count` (items), `rel`
(relationships), `chose` (choices), `visited` (scenes/beats), `objective`,
`solved` (puzzles), `state` (smart objects). `and`/`or`/`not` work as well as
`&&`/`||`/`!`.
