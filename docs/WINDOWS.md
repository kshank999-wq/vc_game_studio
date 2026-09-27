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
