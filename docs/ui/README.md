# VC Game Studio — UI design package

VC Game Studio is a **standalone desktop app**. VC Writer only links to it: the link opens the full app in a mode that cannot save, and from there the user reaches the home page to buy or subscribe.

Start with **[HANDOFF.md](HANDOFF.md)**. It has the design decisions, the colour and shape tokens, the data model and the build order. Where it says "iteration 2", it overrides the spec.

| File | What it is |
|---|---|
| `HANDOFF.md` | Design decisions, tokens, data model, build order (authoritative) |
| `VC_Game_Studio_UI_Spec.docx` | The original UI spec (HANDOFF calls it `spec/VC_Game_Studio_UI_Spec.docx`) |
| `UI-SPEC.md` | Text copy of the spec, for search and diffs |
| `mockups/html/` | The 8 screens as static HTML. Open `02-story-graph-spine-and-lanes.html`; the links between screens work. Fonts load from Google Fonts. |
| `mockups/png/` | The same screens rendered at 2880×1800 (the component library is taller) |

The mockups are static comps, not app code.

## Screens

| # | Screen |
|---|---|
| 01 | Story graph, new project |
| 02 | Story graph, populated ("The Sunken Vault") |
| 03 | Scene Workspace |
| 04 | Exploded scene |
| 05 | Scene timeline |
| 06 | Game Bible |
| 07 | Component library |
| 08 | Engine handoff |

To re-render the PNGs after editing the HTML, screenshot each page at a 1440×900 viewport with a device scale factor of 2 and a full-page capture.
