# VC Game Studio — desktop app

The standalone app, built from `docs/ui/HANDOFF.md` and the mockups in
`docs/ui/mockups/`. Electron + React + TypeScript, the same stack as VC Writer's
desktop app.

```bash
npm run dev -w @vcgs/studio          # desktop app with hot reload
npm run dev:web -w @vcgs/studio      # the same app in a browser
npm run build:web -w @vcgs/studio    # browser build → out/web
VCGS_EDITION=preview npm run build:web -w @vcgs/studio   # the no-save teaser → out/preview
npm test -w @vcgs/studio
node apps/studio/scripts/check-bundle.mjs   # after the web builds: the first load stays small
```

## Editions

- **Full** (desktop, and `out/web`): everything, with autosave.
- **Preview** (`out/preview`): the whole app with saving switched off and a
  link to buy or subscribe. This is what VC Writer links to.

## Where things are

| Path | What it is |
| --- | --- |
| `src/renderer/model/` | The project model (HANDOFF §23) and every operation on it. Pure functions, unit tested. |
| `src/renderer/components/canvas/` | The story graph: the endless spine track, subplot bands, lanes, branches, connectors, minimap. |
| `src/renderer/model/scene.ts` | What a scene holds (by category), and its script. |
| `src/renderer/components/scene/` | The scene workspace (writing box and perimeter) and the exploded scene (ports and element boxes). |
| `src/renderer/model/timeline.ts` | A scene's timeline: events on the main track and on a choice's branches. |
| `src/renderer/model/details.ts` | Element detail: fields per type, states and interactions, scene use, where used. |
| `src/renderer/model/bible.ts`, `reports.ts` | The Game Bible's views and the production reports. |
| `src/renderer/components/detail/`, `components/bible/` | The detail editor (scene panel and Bible pane), the Bible, report preview. |
| `src/renderer/model/level/`, `components/level/` | The Level Designer (docs/LEVEL-DESIGNER.md): levels, the asset library, the 2D map, the 3D graybox (three.js, loaded on demand), the inspector, preflight. |
| `src/renderer/model/handoff/` | The engine handoff: the neutral model, adapters (Godot, Unity, Unreal, JSON), statuses, zip. |
| `src/renderer/views.ts`, `chunks.ts` | How the bundle splits: the Bible, shot list, play-through and handoff (with every engine's runtime source) load on first use and are fetched once the graph is idle; React sits in its own chunk. |
| `src/renderer/model/sample.ts` | “The Sunken Vault”, the mockups’ sample, built with the app’s own operations. |
| `scripts/check-godot.sh` | Runs the sample’s generated Godot code in a real Godot 4. |
| `src/renderer/model/validate.ts` | What needs a look (dead ends, choices without options, untied arc events). |
| `src/renderer/components/Palette.tsx` | The legend as node buttons. |
| `src/renderer/components/BottomBar.tsx` | Add lanes, lane visibility, zoom. |
| `src/renderer/tokens.css` | Colour and type tokens from HANDOFF. |

## Starting a game

File › New opens the **Game Setup Wizard** (Writer spec §3), four short
steps: the kind of game and its name; premise, player fantasy, who the
player is and the core loop; world, tone, themes and endings; how the game
divides (acts, chapters, levels, missions, quests, regions or your own word)
and the resources it keeps coming back to. Each kind of game starts with a
usual structure, and everything but the kind can be left blank.

The answers become the start of the project: the spine divided into the
chosen containers between Beginning and Ending, the premise written into the
Beginning, the Player Lane beneath the spine, and each resource as an
inventory entry in the Bible. They are kept with the project, shown in the
Bible when nothing is selected, and changed later under Project › Game setup
(which leaves what was already made alone). "Start blank instead" skips it.

## Keeping work safe (desktop)

- **Saves are atomic.** A project is written to a temporary file beside it
  and renamed into place, so a crash or power cut mid-save leaves the old
  file whole (`src/main/safe-write.ts`).
- **Backups.** Before a save replaces a file, the old version is copied to
  the backups folder, at most once every ten minutes per project, newest
  twenty kept. Help › Show project backups opens it.
- **The working copy.** The open project is also kept in the app's storage
  as you edit. After a crash it comes back on the next launch, and if it
  differs from the file it counts as unsaved, so autosave and the close
  prompt look after it.
- **File versions.** Projects carry a format version. Older ones are brought
  up to date on opening (`MIGRATIONS` in `model/storage.ts`); one from a
  newer app says to update rather than failing.
- **Crashes.** A broken screen shows a Reload button and a download of the
  working copy instead of a blank window; a crashed window is offered back;
  main-process errors go to the log (Help › Show logs).
- **One copy at a time.** A project double-clicked while the app is open
  opens in the running copy.
- **Updates.** Once a day a packaged copy asks vc-gamestudio.com which
  version is out and offers the download page when there is a newer one.

## Build order (HANDOFF)

1. ✅ Shell, and the legend as node buttons
2. ✅ The infinite spine track
3. ✅ The bottom menu, and adding subplot and character lanes
4. ✅ Drag in a plot point, a choice and a scene; connect lanes (branches, lane ties, arc events)
5. ✅ Open or explode a scene, with ports per category
6. ✅ Element detail on double-click
7. ✅ The timeline with the linked exploded panel
8. ✅ The Bible
9. ✅ Engine handoff with generated code (Godot 4, Unity 6, Unreal Engine 5 and custom JSON — see docs/ENGINE-ADAPTERS.md)
