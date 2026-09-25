# VC Game Studio

A standalone desktop app for building game narratives visually: an infinite
story spine track, subplot and character lanes, scenes that open, explode into
a node map and play as a timeline, a Game Bible behind every view, and a
handoff that generates engine code for Unity, Unreal, Godot or a custom engine.

> **Direction, 25 September 2026.** VC Game Studio is its own program, not a
> mode inside VC Writer. VC Writer carries only a teaser link that opens the
> full app in a mode that cannot save; from there the user reaches the home
> page to buy or subscribe. The UI is defined by
> [`docs/ui/HANDOFF.md`](docs/ui/HANDOFF.md), the UI spec and the mockups in
> [`docs/ui/`](docs/ui/README.md). The `@vc/core` package below is the earlier
> engine prototype.

- UI design package: [`docs/ui/`](docs/ui/README.md)
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
