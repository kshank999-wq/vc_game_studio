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
```

## Editions

- **Full** (desktop, and `out/web`): everything, with autosave.
- **Preview** (`out/preview`): the whole app with saving switched off and a
  link to buy or subscribe. This is what VC Writer links to.

## Where things are

| Path | What it is |
| --- | --- |
| `src/renderer/model/` | The project model (HANDOFF §23) and every operation on it. Pure functions, unit tested. |
| `src/renderer/components/StoryCanvas.tsx` | The story graph: the endless spine track, lane tracks, spans, nodes, minimap. |
| `src/renderer/components/Palette.tsx` | The legend as node buttons. |
| `src/renderer/components/BottomBar.tsx` | Add lanes, lane visibility, zoom. |
| `src/renderer/tokens.css` | Colour and type tokens from HANDOFF. |

## Build order (HANDOFF)

1. ✅ Shell, and the legend as node buttons
2. ✅ The infinite spine track
3. ✅ The bottom menu, and adding subplot and character lanes
4. Drag in a plot point, a choice and a scene; connect lanes (branches, lane ties, arc events)
5. Open or explode a scene, with ports per category
6. Element detail on double-click
7. The timeline with the linked exploded panel
8. The Bible
9. Engine handoff with generated code
