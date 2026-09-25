# VC Game Studio

Home of **VC Writer**, an interactive game-writing and narrative-authoring
tool, and **VC Game Studio**, the full game-creation platform that embeds VC
Writer and turns authored stories into engine code for Godot, Unity and
Unreal Engine, with placeholders standing in for art, environments and
characters.

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
npm run vcw -- validate examples/sunken-vault.vcw.json # static checks
npm run vcw -- explore  examples/sunken-vault.vcw.json # every playthrough
npm run vcw -- play     examples/sunken-vault.vcw.json # play it as text
```

`examples/sunken-vault.vcw.json` is a small cave adventure. It exercises
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
