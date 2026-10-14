# Windows and monitors

The main window keeps the story graph: the spine stays in the middle.
**Window › Open in a new window** opens the Game Bible, the engine handoff,
the open scene or another graph in a window of its own; **Move this view to
another monitor** sends the current view there and brings the main window
back to the graph.

- **Placement (desktop).** The main window fills the middle monitor (the
  middle of three or more, else the primary). The Bible opens on the monitor
  to its left, other views to its right, and several on one side share that
  monitor in columns. With one monitor they open beside the main window.
  **Arrange across N monitors** puts everything back; where each window was
  is remembered (`window-layout.json` in the app's data folder) and reused
  while that monitor is plugged in. A window left on an unplugged monitor
  comes back to the primary. Geometry: `apps/studio/src/main/placement.ts`.
- **Placement (browser).** New windows go on the neighbouring monitor when the
  browser offers the Window Management API (it asks once), else beside this
  window.
- **One project.** The main window owns the project, its undo history and its
  file. Other windows show its project and send every edit, undo and file
  command to it; it sends the result to all of them (`src/renderer/windows.ts`).
  Messages go through the host process on the desktop and a
  `BroadcastChannel` in a browser. Saving, New and Open run in the main
  window; closing it closes the others (in a browser they say so).
- **Links between windows.** Anything that points at the story graph from
  another window (a search result, a Bible "where used" link) is shown on the
  main window's graph.
- Preferences change in every window at once.

## Levels panels in their own windows

In the Levels tab, the 2D map / 3D graybox, the library, the inspector, the structure graph, the generator and prefabs each have ⧉ to open them in a window of their own, to drag onto another monitor.

The map's window:

- has its own **2D map / 3D graybox** switch and **Frame**;
- is where Play Mode plays while it is out, with the keys, the mouse look and the frame rate of that window;
- leaves a note here (**Show it**, **Put it back here**), and the panels take the room.

These are not separate copies of the studio. The panel keeps running in the main window, with the same project and the same undo, and is only drawn in the other window. So it is live both ways: select on the map and the inspector window shows it; place from the library window and it lands on the map.

The window takes the studio's look and theme. Shortcuts pressed in any of these windows (Delete, undo, the tools) work as if pressed in the main one, and a question the studio asks ("Delete this room?") brings the main window forward. **Put it back**, closing the window, or closing the studio docks the panel again.

In the desktop app:

- only these panel windows may open (any other link still goes to your browser);
- each window, the map's included, comes back where you last put it and at the size you left it.

In a browser, each window (the map's too) also reopens where you last put it and at its last size, remembered on this computer. Allow pop-ups for the studio; if a window is blocked, the studio says so and the panel stays where it was.

**Dragging between windows.** Drag an asset from the library, or a prefab from Prefabs, onto the 2D map or the 3D graybox in any window, and it is placed where you drop it. It works from the library window onto the map window on another screen, and the other way round. This uses the system's own drag and drop, so the dragged tile follows the pointer across the screens. Clicking an asset and then clicking on the map still works too. Anything else dropped on the map (a file, a link) is ignored.

