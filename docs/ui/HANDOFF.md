# VC Game Studio — UI handoff for the coding agent

Source spec: *VC Game Studio UI Designer + Coding Agent Development Specification* (fresh copy, Sept 2026 — included as `spec/VC_Game_Studio_UI_Spec.docx`), plus Ken's iteration-2 direction (Sept 25, 2026).
Mockups: `mockups/png/` (images) and `mockups/html/` (the same screens as HTML; open in a browser, the links between screens work).

VC Game Studio is a **standalone desktop app**. VC Writer only shows a preview of it; do not build it as a mode inside VC Writer. Visually it uses dark charcoal and gold, node cards with gold port rings, curved connectors with choice-label pills, and a minimap. Structurally it uses the spine, lanes and scene model below.

## Iteration 2 changes (these override the spec where they differ)
- **The spine is a track.** It is a horizontal band bounded by a line on top and a line on bottom, like a track in a video editor.
  - It never ends. It scrolls infinitely left and right, and it stays locked in place.
  - Nodes (Begin, plot points, choices, scenes, cinematics, End) are placed *inside* the band.
  - Branches and alternate routes float in open canvas above it and connect node-to-node.
- **Lanes are tracks too.** Subplot and character lanes stack below the spine as full-width bands.
  - Each lane has a sticky header on the left with its name, a subtitle, and visibility/lock controls.
  - A **bottom menu bar** has "+ Add subplot lane" and "+ Add character lane", lane visibility chips and zoom.
  - A subplot lane's *active span* is a highlighted region with drag handles that set where the subplot starts and stops.
  - Lane nodes tie to spine nodes with dotted connectors in the lane's color.
- **The legend is made of node buttons.** Each palette item is a small node card with a symbol, a name and a gold port ring, dragged onto the spine or a lane. The groups are Story, Scene elements and Logic.
- **Exploded scene view:**
  - The scene box is bigger (560×400). Each category has **its own colored port** on the scene edge, in the category's color:
    - Characters, Dialogue and Environment on the left.
    - Objects, Choices and Puzzles on the right.
    - Cinematics and Inventory on top.
    - Logic on the bottom.
  - Dropping an element onto the scene snaps it to its category's port. The target port glows during the drag.
  - Element boxes are near-square (130×110). **Double-clicking a box opens its detail** (states, interactions, effects, asset notes, links to the Bible and to its code).
  - Double-clicking the central scene opens its **timeline**. There is also a Timeline button in the scene box and in the header.
- **Scene timeline:**
  - Event tracks (main track and branch track) run across the top.
  - Bottom-left is a **zoomable exploded-scene panel** (zoom −/+, Fit, and Full view). It stays linked to the timeline: the selected event lights up its element there, and any element can be selected and edited in the panel.
  - The inspector sits bottom-right.
- **Engine handoff screen:**
  - The user picks the **engine they're working in**: Unity 6 (C#), Unreal Engine 5 (C++/Blueprints), Godot 4 (GDScript) or a custom engine (JSON + schema). The output folder, runtime package and "export on save" setting sit below the picker.
  - The center of the screen lists what each element generates in that engine, with its status (Ready, Changed or Issue).
  - Generated code is **secondary**: a read-only side panel you can hide. You never edit the code; you change the story graph and the code regenerates.
  - Validation issues show before "Send to [engine]".

## Screens (mockups/)
1. **01 Story graph, new project.** Spine track with Begin, PP1 and End. A choice is being dropped onto the spine. A new subplot lane has just been added from the bottom menu.
2. **02 Story graph, populated** ("The Sunken Vault" sample). It shows:
   - the spine track with its nodes, and branches above it with choice pills;
   - a subplot lane with its active span, and the Mara and Explorer arc lanes with +/− events tied to spine nodes;
   - a minimap, the bottom lane menu, and a selected scene with Open / Explode / Timeline actions.
3. **03 Scene Workspace.** A writing box with collapsed perimeter categories and dialogue authoring.
4. **04 Exploded scene.** One port per category, square element boxes, a drag-in in progress, and a double-clicked detail panel.
5. **05 Scene timeline.** Event tracks, the linked zoomable exploded panel and the inspector.
6. **06 Game Bible.** Views, grouped list, detail with where-used, and the export reports menu.
7. **07 Component library.** Symbols and states (iteration 1; lane and node-button states still to be added).
8. **08 Engine handoff.**

## Fixed semantic mapping (color + shape; never color alone)
| Element | Color | Shape |
|---|---|---|
| Spine track / plot point | #C9A45C (track lines #8A6F2F) | band with top and bottom lines; plot-point node |
| Beginning / End | #C9A45C gradient | locked pill (protected) |
| Scene | #4FA39A | node card |
| Cinematic | #9A7FC0 | node card with film notches |
| Dialogue | #E08A5A | speech card |
| Choice | #F2C230 | circle |
| Character / NPC | per-character color (Mara #D9607A, Explorer #E8E0C8) | triangle |
| Interactive object | #4A86D8 | square |
| Environment | #6FAE5E | hexagon |
| Inventory / pickup | #6CC4D6 | star |
| Puzzle / smart object | #E07BB0 | puzzle piece |
| Trigger / Gate / State | #C8BFAE | outline diamond · outline circle |
| Subplot lane | #8FA8C4 | lane band + dashed span |
| Validation error | #E5484D | red "!" badge (never yellow, which belongs to Choice) |

Ground and chrome:

| Token | Value |
|---|---|
| App ground | #0B0A07 |
| Dot grid | #1C1910 every 24px |
| Panels | #12100B |
| Nodes | #1A170E |
| Borders | #332B17 |
| Gold | #C9A45C / #E8C872 / #8A6F2F |
| Text | #F1E7CF |
| Muted text | #9C8F6D |

Type:
- **Josefin Sans** 700 tracked .16–.24em for labels, lanes and the brand.
- **IBM Plex Sans** for the UI.
- **IBM Plex Mono** for IDs.
- **Courier Prime** for screenplay text.

## Data model (spec §23)
- **Object** `{id, type, name, notes, created, modified, data}`
- **Lane** `{id, kind: spine|subplot|character, name, color, order, span?: {startRef, endRef}, visible, locked}`. The spine has no span; it is infinite.
- **Connection** `{id, sourceId, targetId, kind, conditions?, routing?}`
  - kinds: spine, branch, contains, references, arcEvent, laneTie, gate
- **ScenePort** is derived from the category. Every contained element connects to its category's port.
- **SceneUse** extends a canonical object for one scene without copying it.
- **DialogueLine** `{id, sceneId, speakerId, text, direction, order, conditions?, choiceId?, vo, notes}`
- **EngineTarget** `{engine: unity|unreal|godot|custom, outputPath, runtime, exportOnSave}`
- **Generated** `{objectId, files[], hash, status}`
  - Code is generated from objects and is never the source of truth.
- **ViewState** holds zoom, pan, selection, expanded, lane visibility, timeline open, panel zoom and returnTo. It is presentation only.

## Open question for Ken
- Can a subplot lane run past the spine's End (an epilogue thread), or must it rejoin before End? The mockups currently rejoin before End.

## Build order
1. Shell, and the legend as node buttons.
2. The infinite spine track.
3. The bottom menu, and adding subplot and character lanes.
4. Drag in a plot point, a choice and a scene; connect lanes.
5. Open or explode a scene, with ports per category.
6. Element detail on double-click.
7. The timeline with the linked exploded panel.
8. The Bible.
9. Engine handoff with generated code.
