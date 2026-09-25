<!-- Text copy of VC_Game_Studio_UI_Spec.docx, for search and diffs. Where HANDOFF.md says "iteration 2", HANDOFF.md wins. -->

# VC GAME STUDIO
UI Designer + Coding Agent Development Specification  
Spine-Based Interactive Narrative • Scene Node Graph • Game Bible  
Fresh regenerated handoff copy • September 2026  

## 1. Product Intent
VC Game Studio is a visual game-narrative construction environment. The primary workspace stays intentionally clean: a persistent story spine carries the major plot while scenes, choices, subplots, character arcs and related elements connect to it. Detailed complexity lives inside scenes and appears only when opened or expanded.
Core hierarchy: MAIN GRAPH → SCENE → SCENE DETAIL / TIMELINE → ELEMENT DETAIL. The Game Bible is the persistent project catalog and production database behind all views.

## 2. Non-Negotiable UI Principles
- Keep the main viewport clean; do not expose every NPC, prop, dialogue line, trigger or environment detail on the master graph.
- The central spine is the dominant narrative orientation device.
- Color and shape are semantic and remain consistent everywhere.
- Major elements use colorized cards/nodes; small sub-elements use compact symbols/badges.
- Complexity is progressive: collapsed by default, expandable by category, and fully explodable into a node/mind-map view.
- Every authored element is a reusable data object referenced by scenes, timelines, arcs and the Game Bible.
- The visual language should feel like a professional game/VFX node editor while scene writing remains familiar and screenplay-oriented.

## 3. Main Application Shell
- Top command bar: project name, breadcrumb/current view, persistent GAME BIBLE command, view controls, undo/redo, search, zoom-to-fit and save status.
- Left side: persistent LEGEND + DRAG PALETTE, not a conventional navigation menu.
- Center: large blank pannable/zoomable workspace with the story spine as the visual anchor.
- Connections use clean routed lines. Ports remain unobtrusive until hover, selection or connection mode.

## 4. Left Legend / Drag Palette
- Organize into Major Elements, Lanes, Scene Elements and Logic/Interaction Elements.
- Each entry displays its symbol/color, name and tooltip.
- Elements can be dragged onto valid targets or clicked to enter placement mode.
- Palette groups collapse independently; frequent tools may be pinned.
- Symbols must remain identifiable without relying on color alone.

## 5. Main Story Spine
- A new project starts with BEGINNING, one middle PLOT POINT and ENDING.
- Plot points are the 'bones' attached directly to the central spine.
- Beginning and Ending are structurally protected while their content remains editable.
- Additional plot points can be inserted and reordered along the spine.
- Choices are inserted between/around plot points and route toward scenes or alternate paths.
- The spine remains readable even when surrounding material is expanded.

## 6. Subplot Lanes
- A subplot lane is a partial secondary spine that can begin and end anywhere.
- The user drags it onto the canvas and resizes its start/end extent.
- It accepts plot points, choices and scene connections.
- It can reconnect to the main spine or another valid narrative point.

## 7. Character Arc Lanes
- A character arc is a persistent full-story lane with its own consistent color.
- It tracks growth, setbacks, state changes and positive/negative choices.
- Arc events reference existing plot points, choices and scenes rather than duplicating them.
- Multiple character lanes can be shown or hidden.

## 8. Visual Element Language
- Scene: major rounded colorized card/node; opens Scene Workspace.
- Cinematic: major colorized card; opens cinematic detail/timeline.
- Dialogue: dedicated colorized dialogue card inside scenes.
- Choice: YELLOW CIRCLE; opens options, conditions and outcomes.
- Character/NPC: TRIANGLE with a dedicated character color; references the canonical Bible character.
- Interactive Object: BLUE SQUARE/BOX; opens interaction and state detail.
- Environment: compact environment badge with dedicated color.
- Trigger/Gate: compact logic symbol.
- Inventory/Pickup/Power-up: compact item symbol.
- Puzzle/Smart Object: compact puzzle/interactivity symbol.
- Final production colors may be refined, but once approved the mapping is fixed throughout the application.

## 9. Scene Node on Main Graph
- Collapsed state is a compact scene card with scene name/ID, short descriptor and minimal status.
- Selection reveals connection handles and essential quick actions.
- Opening enters the Scene Workspace.
- Optional quick preview shows only summary/environment/key flags.
- Scenes can connect to plot points, choices, subplots and character arcs.

## 10. Scene Workspace
Opening a scene focuses the interface on a large central scene authoring box. Detailed scene categories remain collapsed as labeled nodes around the perimeter until requested.

### 10.1 Central Scene Box
- Scene title/ID plus optional INT/EXT, location and time metadata.
- Large VC Writer-style beat/script area for setting, general environment and what happens.
- The author writes in familiar screenplay-like form instead of raw node properties.
- Scene summary, purpose and notes remain accessible without crowding the writing surface.

### 10.2 Perimeter Element Nodes
- Characters, Dialogue, Environment, Objects, Interactions, Cinematics, Triggers/Logic, Inventory, Puzzles and other categories sit as compact labeled nodes around the scene edge.
- Each category may display a count and compact status.
- Clicking expands only that category.
- Expand All transforms the scene into a complete mind-map/node graph.
- Collapse restores the clean scene view without changing data or relationships.

## 11. Expanded Scene / Mind-Map Mode
- The central Scene remains the root.
- Contained elements radiate outward by category.
- Characters can expose dialogue, behavior, inventory relationships and interactions.
- Objects can expose pickup/use requirements, states and downstream effects.
- Choices expose outcomes and downstream scene links.
- The user can expand one branch, a category or the complete scene.
- Collapse Scene returns to the compact perimeter representation.

## 12. Dialogue Authoring
- Dialogue is stored with the scene while referencing canonical characters from the Bible.
- Character selector/dropdown draws from project characters and can support adding a new character.
- Script flow: character → dialogue → optional direction/action → next speaker.
- Dialogue can be linear or attached to a choice/condition.
- Each dialogue block retains speaker, text, order, conditions, VO/audio status and notes.
- Dialogue appears on the Scene Timeline as individual events or grouped exchanges.
- The Bible can generate dialogue/VO reports by character and by scene.

## 13. Scene Timeline — Playable Movie View
- Every scene can open a visual timeline showing how it plays from entry to exit.
- Events include opening/closing cinematics, dialogue turns, actions, scripted interactions, triggers, choices and free-play segments.
- Events can be reordered when logic permits.
- Free-flowing gameplay is represented as a span/segment rather than a fake fixed duration.
- Branching choices visibly split the sequence and may reconnect.
- Selecting a timeline event highlights the same underlying object in the scene graph.
- The timeline is collapsible.

## 14. Choices
- Primary visual symbol is a yellow circle.
- Choice detail contains label, player-facing prompt where applicable, internal notes, options, conditions, consequences and destination.
- Choice notes are automatically cataloged in the Bible.
- A choice may alter variables, inventory, relationships, character arc state or future availability.
- Options may remain persistent or disappear after selection.
- Detailed outcome logic remains collapsed on the master graph.

## 15. Characters and NPCs
- Characters/NPCs are canonical Bible objects referenced inside scenes.
- Scene-specific information can include presence, behavior, dialogue, relationship state, equipment, objective and entry/exit.
- Opening a character from a scene shows scene-specific information first, with access to the complete Bible record.
- Do not create disconnected duplicates when a character appears in multiple scenes.

## 16. Environment, Objects and Interaction
- Environment summary lives in the central scene; expanded data includes location, appearance, lighting/weather, ambient audio, traversable areas, obstacles and environmental interactions.
- Interactive Object convention begins with a blue square/box.
- Object detail includes name, type, asset notes, location, availability condition, interactions, states, inventory behavior and downstream effects.
- Inventory items may persist across scenes; local scene props may remain scene-specific.
- Power-ups and collectibles use the same object framework with specialized properties.

## 17. Cinematics
- Cinematics are major colorized elements and can occur at scene entry, exit or within the timeline.
- Detail supports description, characters, dialogue references, camera/framing notes, environment, audio, required assets and transition back to gameplay.
- A cinematic can open in its own focused authoring panel.

## 18. Logic — Triggers, Gates, State and Dependencies
- Triggers cause gameplay, dialogue, cinematic or state transitions.
- Gates define prerequisites before an action, choice, scene or progression point becomes available.
- State mutations record what changes after an event.
- Dependencies can reference prior choices, inventory, relationship/arc state, puzzle completion and other project variables.
- Logic uses compact symbols in normal view and expands into readable rule cards only when inspected.

## 19. Game Bible — Full Window
The Bible is both creative reference and production breakdown. It mirrors the same underlying objects used by the graph and scenes; it is not a separate copy of project data.
- Views: All Elements; Characters/NPCs; Scenes; Plot Points/Subplots; Character Arcs; Choices/Outcomes; Dialogue/Voice Recording; Locations/Environments; Objects/Inventory; Cinematics; Puzzles; Triggers/Gates/State; Production Requirements.
- Support list, grouped and detail views with filtering and search.
- Clicking an item opens its complete information and shows where it is used.
- Edits update every reference because all views point to the same underlying object.
- Cross-links navigate back to the relevant scene, timeline, plot point or arc.
- Print/export creates organized production-facing reports rather than screenshots.

## 20. Bible Production Outputs
- Character list and character detail sheets.
- Dialogue/VO report by character and by scene.
- Scene breakdowns.
- Location/environment list.
- Props, interactive objects, pickups and inventory requirements.
- Cinematics and camera/presentation notes.
- Art/VFX/audio/animation requirements where tagged.
- Puzzle, trigger and gameplay interaction requirements.
- Choice/dependency documentation and character-arc summaries.

## 21. Smallest Reusable UI Components
- Symbol Badge: default, hover, selected, warning and disabled states.
- Major Node Card: collapsed, selected, preview and open states.
- Connection Port: hidden, hover, active, valid-target and invalid-target states.
- Connector: normal, selected, conditional and broken states.
- Perimeter Category Node: collapsed, expanded, empty and warning states; includes label + count.
- Lane: normal, selected and filtered/hidden-content states.
- Timeline Event: normal, selected, conditional and branch states.
- Detail Panel: view, edit and validation-error states.
- Breadcrumb: graph → scene → subview → element.
- Status Chip: normal, warning and complete states.

## 22. Core User Flow
1. Drag an element from the Legend onto the canvas or a valid target.
1. Create/reference the underlying object and assign its stable project ID.
1. Connect it to the spine, plot point, scene or contained element.
1. Open a Scene.
1. Write the scene in the central authoring box.
1. Add contents through perimeter nodes, contextual add controls or drag/drop.
1. Expand categories or explode the scene into a full node graph.
1. Open Timeline to arrange playable events and branches.
1. Open Bible to inspect, edit, search, report or print the project catalog.
1. Return to Main Graph with detailed complexity collapsed.

## 23. Coding and State Requirements
- All UI views reference normalized project objects rather than storing separate copies.
- Every object has stable ID, type, name, notes, created/modified metadata and relationships.
- Connections are first-class relationships with source ID, target ID, relationship type, optional conditions and display-routing metadata.
- Scene-specific data can extend canonical objects without duplicating them.
- Expanded/collapsed state, node position, zoom and lane visibility are presentation state and never alter narrative logic.
- Deleting an object with references requires a dependency warning and resolution workflow.
- Autosave preserves edits while undo/redo operates at the user-interaction level.

## 24. Navigation and Persistence
- Returning from a scene restores prior main-graph zoom, pan and selection.
- Returning from the Bible restores the originating context when possible.
- Scene expansion state and timeline visibility persist appropriately.
- Provide Zoom to Selection, Zoom to Spine and Zoom to Fit.
- Search results can focus the graph on the selected Bible object.

## 25. Validation
- Broken/missing connection.
- Choice with no valid outcome.
- Required gate references missing object/state.
- Orphaned or incomplete scene.
- Dialogue speaker missing/deleted.
- Character/object used in scene but missing canonical data.
- Timeline branch that cannot resolve/reconnect where required.
- Warnings appear as compact indicators until the user requests details.

## 26. UI Designer Deliverables
- Master desktop application shell.
- Main graph: empty/new project and populated project.
- Legend/palette expanded and collapsed states.
- Spine with Beginning, Plot Points, Choices, Scenes and Ending.
- Subplot lane and multiple character-arc lane examples.
- Scene node states.
- Scene Workspace with collapsed perimeter nodes.
- Partially expanded scene and fully exploded mind-map scene.
- Dialogue authoring view.
- Scene Timeline with cinematic, dialogue, action, free-play and branching choice examples.
- Bible list/group/detail views, usage references and production report/print preview.
- Component library showing every symbol, node, port, connector, lane, chip and state.
- Interaction annotations for drag/drop, connect, expand/collapse, open/close, selection and validation.

## 27. Acceptance Criteria
- A first-time user can identify scene, choice, character and interactive-object types from the legend and graph.
- A complex scene can collapse to a single clean scene node on the main graph.
- Opening a scene exposes its writing surface and contained categories without unrelated clutter.
- The same scene can expand into a readable mind map of all contained elements.
- Dialogue can be written in script form using project characters and remains associated with the scene.
- The timeline communicates the playable order of cinematics, dialogue, actions, free-play and branches.
- Subplots can occupy only part of the narrative while character arcs can span the complete story.
- Any object edited in the Bible or scene is reflected everywhere it is referenced.
- The Bible can produce printable production breakdowns.
- The master viewport remains visually clean at normal working zoom.

## 28. Recommended First Interactive Prototype
1. Build Main Shell + left Legend.
1. Build central Spine with Beginning, Plot Point and Ending.
1. Drag in another Plot Point, yellow Choice and Scene.
1. Open the Scene.
1. Show central scene writing box with Characters, Dialogue, Environment, Objects and Cinematics around its perimeter.
1. Expand Characters and Dialogue; then use Expand All to produce the scene mind map.
1. Open Scene Timeline and arrange an opening cinematic, two dialogue turns, an action, a free-play segment and a choice.
1. Open Bible and show the same character, choice, scene and dialogue records.
1. Collapse back to the clean Main Graph.
END OF SPECIFICATION