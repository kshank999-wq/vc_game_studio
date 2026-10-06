import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BottomBar } from './components/BottomBar';
import { Palette } from './components/Palette';
import { StoryCanvas, type CanvasApi, type ConfirmRequest, type PaletteDrag } from './components/canvas/StoryCanvas';
import { Symbol } from './components/Symbol';
import { TopBar, type Crumb } from './components/TopBar';
import { ExplodedScene } from './components/scene/ExplodedScene';
import { SceneWorkspace, type SceneSurface } from './components/scene/SceneWorkspace';
import { SceneTimeline } from './components/scene/SceneTimeline';
import { desktop } from './desktop';
import type { Destination } from './model/details';
import { inScene, removeFromScene } from './model/scene';
import { laneRows, nodeBox } from './model/layout';
import { addLane, isProtected, removeConnection, removeObject, renameProject, spanDependents, updateLane } from './model/project';
import { findIssues } from './model/validate';
import { TYPE_LABEL } from './model/semantics';
import type { ObjectType } from './model/types';
import { useStudio, isBlank } from './use-studio';
import { deletionImpact, removalImpact } from './model/impact';
import type { Menu, MenuItem } from './components/menu/MenuBar';
import { AboutDialog, PreferencesDialog, PreviewSaveDialog, ShortcutsDialog } from './components/menu/Dialogs';
import { CommentsPanel } from './components/collab/lazy';
import type { Target } from './model/collab';
import { openProjectFile, openRecent, recentFiles, clearRecent, type Opened, type Recent } from './files';
import { createProject, ensurePlayerLane } from './model/project';
import { createFromSetup, updateSetup } from './model/setup';
import { SetupWizard } from './components/setup/lazy';
import { Guide, guideSeen, markGuideSeen } from './components/help/lazy';
import { KindsDialog } from './components/kinds/lazy';
import { REPORTS, type ReportKey } from './model/reports';
import { canExport, currentAccess, isPreview, PURCHASE_URL, useAccess } from './edition';
import { LicenseDialog } from './components/license/lazy';
import { setPreferences, usePreferences } from './preferences';
import { SearchPalette } from './components/search/SearchPalette';
import { EngineHandoff, GameBible, LevelDesigner, loadHandoff, loadSample, NoteSorter, PlayView, preloadViews, PuzzleCreator, ShotList } from './views';
import type { LevelMode } from './components/level/LevelDesigner';
import { NavContext } from './nav';
import type { SearchResult } from './model/search';
import { isMainClosed, isPanel, listen, openWindow, parseView, post, role, subscribeShared, type Command, type PanelView } from './windows';
import { fitView, spineView, zoomAt, type View } from './view';

const BOTTOM_BAR = 52;

/** Where the user is: the story graph, or inside one scene (written, or exploded). */
export type SceneMode = 'open' | 'exploded' | 'timeline';
type PlaceRoute = { view: 'graph' } | { view: 'scene'; sceneId: string; mode: SceneMode };
/** The Bible remembers where it was opened from, to go back there (spec §24). */
export type Route =
  | PlaceRoute
  | { view: 'bible'; focus?: string; report?: ReportKey; back: PlaceRoute }
  | { view: 'engine'; focus?: string; back: PlaceRoute }
  | { view: 'play'; from?: string; back: PlaceRoute }
  | { view: 'cinematic'; id: string; back: PlaceRoute }
  | { view: 'level'; focus?: string; mode?: LevelMode; back: PlaceRoute }
  | { view: 'notes'; back: PlaceRoute }
  | { view: 'puzzles'; focus?: string; back: PlaceRoute };

/** Views that stand aside from the graph and scenes, with a way back to where they were opened. */
const isAside = (r: Route): r is Extract<Route, { back: PlaceRoute }> => 'back' in r;

/** Where a window opens: the main window on the story graph, another on the view it was opened for. */
const routeFor = (view: PanelView): Route => {
  if (view.view === 'bible') return { view: 'bible', focus: view.focus, back: { view: 'graph' } };
  if (view.view === 'engine') return { view: 'engine', back: { view: 'graph' } };
  if (view.view === 'play') return { view: 'play', back: { view: 'graph' } };
  if (view.view === 'level') return { view: 'level', focus: view.focus, back: { view: 'graph' } };
  if (view.view === 'scene') return view;
  return { view: 'graph' };
};

const viewOf = (route: Route): PanelView =>
  route.view === 'bible' ? { view: 'bible', focus: route.focus } : route.view === 'engine' ? { view: 'engine' } : route.view === 'play' ? { view: 'play' } : route.view === 'level' ? { view: 'level', focus: route.focus } : route.view === 'scene' ? { view: 'scene', sceneId: route.sceneId, mode: route.mode } : { view: 'graph' };

const WINDOW_LABEL: Record<PanelView['view'], string> = { graph: 'Graph window', bible: 'Bible window', engine: 'Handoff window', scene: 'Scene window', play: 'Play window', level: 'Levels window' };

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const App = () => {
  const studio = useStudio();
  const { project, commit } = studio;
  const canvas = useRef<CanvasApi>(null);
  const surface = useRef<SceneSurface>(null);
  const [route, setRoute] = useState<Route>(() => (role.kind === 'panel' ? routeFor(role.start) : { view: 'graph' }));
  // The legend is a full palette on the graph and a rail inside a scene, until the user says otherwise.
  const [rail, setRail] = useState({ graph: false, scene: true });
  const inSceneView = route.view === 'scene';
  const [view, setViewState] = useState<View>({ zoom: 1, panX: 180, panY: 300 });
  const setView = useCallback((update: (view: View) => View) => setViewState(update), []);
  const [selection, setSelection] = useState<string | null>(null);
  const [drag, setDrag] = useState<PaletteDrag | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragRef = useRef<PaletteDrag | null>(null);
  dragRef.current = drag;
  const routeRef = useRef<Route>({ view: 'graph' });
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [dialog, setDialog] = useState<'preferences' | 'shortcuts' | 'about' | 'previewSave' | 'comments' | 'license' | 'newGame' | 'setup' | 'guide' | 'kinds' | null>(null);
  // Re-render when the license changes: an activation turns saving on, a lapse turns it off.
  useAccess();
  const [recent, setRecent] = useState<Recent[]>(() => recentFiles());
  const [renameRequest, setRenameRequest] = useState(0);
  const [searching, setSearching] = useState(false);
  const [lineFocus, setLineFocus] = useState<string | null>(null);
  const preferences = usePreferences();

  routeRef.current = route;
  const say = useCallback((message: string) => setToast(message), []);
  // The first time the studio opens (in its main window), the Getting started tour does too.
  useEffect(() => {
    if (role.kind !== 'panel' && import.meta.env.MODE !== 'test' && !guideSeen()) setDialog((d) => d ?? 'guide');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const canvasSize = () => canvas.current?.size() ?? { w: window.innerWidth - 264, h: window.innerHeight - 104 };
  const fit = () => setViewState(fitView(project, canvasSize().w, canvasSize().h));
  const toSpine = () => setViewState(spineView(project, canvasSize().w, canvasSize().h));
  const zoomBy = (factor: number) => setViewState((v) => zoomAt(v, factor, canvasSize().w / 2, canvasSize().h / 2));

  // The Bible, play-through and handoff load on first use; fetch them once the graph is up.
  useEffect(() => preloadViews(), []);

  // Open on the spine, the way a new project looks (mockup 01).
  useLayoutEffect(() => {
    toSpine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A selection that no longer exists (after undo, say) is dropped; so is a scene view whose scene went.
  useEffect(() => {
    if (selection && !project.objects[selection] && !project.connections.some((c) => c.id === selection)) setSelection(null);
    if (route.view === 'scene' && project.objects[route.sceneId]?.type !== 'scene') setRoute({ view: 'graph' });
  }, [project, selection, route]);

  /** Open a scene; the graph keeps its zoom, pan and selection for the way back (spec §24). */
  const openScene = (sceneId: string, mode: SceneMode) => {
    setRoute({ view: 'scene', sceneId, mode });
    setSceneSelection(null);
    setLineFocus(null);
  };
  const [sceneSelection, setSceneSelection] = useState<string | null>(null);
  const placeOf = (r: Route): PlaceRoute => (isAside(r) ? r.back : r);
  const openShots = (id: string) => setRoute((r) => ({ view: 'cinematic', id, back: placeOf(r) }));
  const openLevels = (focus?: string, mode?: LevelMode) => setRoute((r) => ({ view: 'level', focus, mode, back: placeOf(r) }));
  const openPuzzles = (focus?: string) => setRoute((r) => ({ view: 'puzzles', focus, back: placeOf(r) }));
  const nav = useMemo(() => ({ openShots, openLevels, openPuzzles }), []);
  const openPlay = (from?: string) => setRoute((r) => ({ view: 'play', from, back: placeOf(r) }));
  const openBible = (focus?: string, report?: ReportKey) => setRoute((r) => ({ view: 'bible', focus, report, back: placeOf(r) }));
  const openEngine = (focus?: string) => setRoute((r) => ({ view: 'engine', focus, back: placeOf(r) }));
  const openNotes = () => setRoute((r) => ({ view: 'notes', back: placeOf(r) }));

  // Desktop, first run or signed out: offer to sign in and activate before anything else.
  if (__LICENSING__) {
    // A build-time constant, so the hook is always or never called.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (!studio.isPanel && currentAccess().state === 'signed-out') setDialog('license');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  }

  // Export on save (desktop): once edits settle, send what changed to the engine project.
  useEffect(() => {
    const bridge = desktop();
    const target = project.handoff?.target;
    if (!bridge || !target?.exportOnSave || !target.projectFolder || !canExport()) return;
    let live = true;
    const timer = setTimeout(() => {
      void loadHandoff()
        .then(({ planHandoff, recordExport }) => {
          const plan = planHandoff(project);
          if (!live || !plan.output || plan.changed === 0 || plan.blocking.length) return;
          return bridge.writeFiles(target.projectFolder, plan.output.files).then(() => studio.replace(recordExport(project, plan)));
        })
        .catch((error: unknown) => say(error instanceof Error ? error.message : 'Export on save failed.'));
    }, 1200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  /** Go to a place a where-used link names: a scene view, or a node on the graph brought into view. */
  const navigate = (to: Destination) => {
    // Beside the main window, a node is shown on the main window's graph: the spine stays in the middle.
    if (isPanel && to.kind === 'graph' && routeRef.current.view !== 'graph') {
      post({ t: 'navigate', to });
      say('Shown on the story graph in the main window.');
      return;
    }
    if (to.kind === 'scene') {
      openScene(to.sceneId, to.mode);
      return;
    }
    setRoute({ view: 'graph' });
    setSelection(to.id);
    const box = nodeBox(project, to.id);
    if (!box) return;
    const { w, h } = canvasSize();
    setViewState((v) => ({ ...v, panX: (w + 130) / 2 - (box.x + box.w / 2) * v.zoom, panY: h / 2 - (box.y + box.h / 2) * v.zoom }));
  };

  /** Open what a comment or a change is about (spec §16). */
  const goToTarget = (target: Target) => {
    setDialog(null);
    if (target.kind === 'level' || target.kind === 'levelItem') return openLevels(target.id);
    if (target.kind === 'code') return openEngine();
    const id = target.kind === 'connection' ? project.connections.find((c) => c.id === target.id)?.sourceId : target.id;
    if (!id || !project.objects[id]) return;
    // A node on the graph is shown there; anything else opens in the Bible, where its comments are.
    if (project.placements[id]) navigate({ kind: 'graph', id });
    else openBible(id);
  };

  /** Frame a node: centred, and big enough to read (Zoom to selection). */
  const zoomTo = (id: string) => {
    const box = nodeBox(project, id);
    if (!box) return;
    const { w, h } = canvasSize();
    setViewState((v) => {
      const zoom = Math.min(1.5, Math.max(0.6, Math.min((w - 130) / (box.w * 4), h / (box.h * 5))));
      return { zoom, panX: (w + 130) / 2 - (box.x + box.w / 2) * zoom, panY: h / 2 - (box.y + box.h / 2) * zoom };
    });
  };

  /** Go to a search result: its node on the graph, the scene that holds it, or its line in the script. */
  const goToResult = (result: SearchResult) => {
    if (result.to.kind === 'graph' && isPanel && route.view !== 'graph') {
      navigate(result.to);
      return;
    }
    if (result.to.kind === 'graph') {
      setRoute({ view: 'graph' });
      setSelection(result.id);
      zoomTo(result.id);
      return;
    }
    openScene(result.to.sceneId, result.to.mode);
    if (result.kind === 'line') setLineFocus(result.id);
    else setSceneSelection(result.id);
  };

  const backToGraph = () => {
    const from = route.view === 'scene' ? route.sceneId : null;
    setRoute({ view: 'graph' });
    if (from) setSelection(from);
  };

  const issues = useMemo(() => findIssues(project), [project]);
  const issueMap = useMemo(() => new Map(issues.map((i) => [i.id, i.message])), [issues]);

  /** Step through what needs a look: select it, bring it into view and say what's wrong. */
  const showNextIssue = () => {
    if (issues.length === 0) return;
    const at = issues.findIndex((i) => i.id === selection);
    const issue = issues[(at + 1) % issues.length]!;
    setSelection(issue.id);
    say(issue.message);
    const box = nodeBox(project, issue.id);
    if (!box) {
      // Not on the graph: it lives inside a scene, so open that scene's mind map.
      const holder = project.connections.find((c) => c.kind === 'contains' && c.targetId === issue.id);
      if (holder) {
        openScene(holder.sourceId, 'exploded');
        setSceneSelection(issue.id);
      }
      return;
    }
    const { w, h } = canvasSize();
    setViewState((v) => ({ ...v, panX: (w + 130) / 2 - (box.x + box.w / 2) * v.zoom, panY: h / 2 - (box.y + box.h / 2) * v.zoom }));
  };

  // ------------------------------------------------------------ palette drag

  const startPaletteDrag = (type: ObjectType, e: React.PointerEvent) => {
    if (drag?.placing && drag.type === type) {
      setDrag(null);
      return;
    }
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDrag({ type, clientX: e.clientX, clientY: e.clientY, moved: false, placing: false });
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const far = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y) > 4;
      setDrag((d) => d && { ...d, clientX: e.clientX, clientY: e.clientY, moved: d.moved || far });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const at = { ...d, clientX: e.clientX, clientY: e.clientY };
      // A click without a drag picks the node up; the next click puts it down.
      if (!d.moved && !d.placing) {
        setDrag({ ...at, placing: true });
        return;
      }
      if (routeRef.current.view === 'graph') canvas.current?.drop(at);
      else surface.current?.drop(at);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging]);

  // ------------------------------------------------------------ commands

  const deleteItem = (id: string | null) => {
    if (!id) return;
    if (project.connections.some((c) => c.id === id)) {
      commit(removeConnection(project, id));
      setSelection(null);
      return;
    }
    if (!project.objects[id]) return;
    if (isProtected(project, id)) {
      say('Beginning and Ending are protected. You can rename them but not remove them.');
      return;
    }
    const remove = () => {
      commit(removeObject(project, id));
      setSelection(null);
      setSceneSelection(null);
    };
    const impact = deletionImpact(project, id);
    if (impact.length === 0) {
      remove();
      return;
    }
    setAsk({
      title: `Delete “${project.objects[id]!.name}”?`,
      message: 'This also changes other parts of the project:',
      details: impact,
      confirmLabel: 'Delete',
      onConfirm: remove,
    });
  };

  /** Take an element out of a scene, saying first if that deletes it or breaks something. */
  const removeFromSceneAsking = (sceneId: string, id: string) => {
    const { deletes, impact } = removalImpact(project, sceneId, id);
    const remove = () => {
      commit(removeFromScene(project, sceneId, id));
      setSceneSelection(null);
    };
    if (impact.length === 0) {
      remove();
      return;
    }
    const name = project.objects[id]?.name ?? '';
    setAsk({
      title: deletes ? `Delete “${name}”?` : `Take “${name}” out of the scene?`,
      message: deletes ? 'Only this scene uses it, so it leaves the project too. That also changes:' : 'This also changes:',
      details: impact,
      confirmLabel: deletes ? 'Delete' : 'Take it out',
      onConfirm: remove,
    });
  };

  const onAddLane = (kind: 'subplot' | 'character') => {
    const added = addLane(project, kind);
    commit(added.project);
    // Bring the new lane into view if it landed below the fold.
    const row = laneRows(added.project).find((r) => r.lane.id === added.laneId);
    if (!row) return;
    const { h } = canvasSize();
    setViewState((v) => {
      const bottom = (row.top + row.height) * v.zoom + v.panY;
      return bottom > h - 16 ? { ...v, panY: v.panY - (bottom - (h - 16)) } : v;
    });
  };

  const onToggleLane = (laneId: string) => {
    const lane = project.lanes.find((l) => l.id === laneId);
    if (lane) commit(updateLane(project, laneId, { visible: !lane.visible }));
  };

  // ------------------------------------------------------------ files

  /** Start on another project, back on the story graph at its spine. */
  const showProject = (next: Parameters<typeof studio.load>[0], file: Parameters<typeof studio.load>[1]) => {
    studio.load(next, file);
    setRoute({ view: 'graph' });
    setSelection(null);
    setSceneSelection(null);
    setRecent(recentFiles());
    const { w, h } = canvasSize();
    setViewState(spineView(next, w, h));
  };

  /** A window beside the main one hands file commands to it (it owns the file). */
  const toMain = (name: Command, arg?: string) => {
    studio.forward(name, arg);
    desktop()?.focusMain?.();
    if (!desktop()) say('Carry on in the main window.');
  };

  const save = async (as = false): Promise<boolean> => {
    if (studio.isPanel) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      await new Promise((r) => setTimeout(r, 0));
      studio.forward(as ? 'saveAs' : 'save');
      return true;
    }
    if (isPreview()) {
      setDialog(__LICENSING__ ? 'license' : 'previewSave');
      return false;
    }
    // A field being typed in saves when it loses focus: let it land first.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 0));
    const ok = await (as ? latest.current.saveAs() : latest.current.save());
    setRecent(recentFiles());
    if (ok) say(`Saved ${latest.current.file?.name ?? ''}`.trim());
    else if (latest.current.saveState === 'failed') say('That did not save. Try File › Save As.');
    return ok;
  };
  const latest = useRef(studio);
  latest.current = studio;

  /** Before leaving this project: offer to save what isn't in a file yet. */
  const leaveProject = (then: () => void) => {
    if (isPreview() && !isBlank(project)) {
      setAsk({ title: 'Leave this project?', message: 'The preview edition does not save, so this project will be cleared.', confirmLabel: 'Clear it', onConfirm: then });
      return;
    }
    if (!studio.unsaved) {
      then();
      return;
    }
    setAsk({
      title: `Save “${project.name}” first?`,
      message: studio.file ? `Your changes to ${studio.file.name} are not saved.` : 'This project is not in a file yet; it only lives in this window.',
      confirmLabel: 'Save',
      safe: true,
      onConfirm: () => void save().then((ok) => ok && then()),
      alternate: { label: 'Don’t save', onClick: then },
    });
  };

  const afterOpen = (result: Opened) => {
    if (!result) return;
    if ('error' in result) say(result.error);
    else showProject(result.project, result.file);
  };
  /** The sample, with its level, loads on demand (it is most of a project's worth of code to build). */
  const openSample = () =>
    void loadSample()
      .then(({ sunkenVault }) => showProject(sunkenVault(), null))
      .catch(() => say('The sample could not be loaded. Check the connection and try again.'));
  /** A new project starts with the Game Setup Wizard (which can start blank instead), or from the sample. */
  const newProject = (sample = false) =>
    studio.isPanel ? toMain(sample ? 'newSample' : 'new') : leaveProject(() => (sample ? openSample() : setDialog('newGame')));
  const open = () =>
    studio.isPanel ? toMain('open') : leaveProject(() => {
      openProjectFile()
        .then(afterOpen)
        .catch(() => say('That file could not be opened.'));
    });
  const reopen = (path: string) => (studio.isPanel ? toMain('openRecent', path) : leaveProject(() => void openRecent(path).then(afterOpen)));

  // The main window runs what other windows ask of it.
  const fromPanels = useRef<(m: Parameters<Parameters<typeof listen>[0]>[0]) => void>(() => {});
  fromPanels.current = (m) => {
    if (m.t === 'navigate') navigate(m.to);
    if (m.t !== 'command') return;
    if (m.name === 'save') void save();
    if (m.name === 'saveAs') void save(true);
    if (m.name === 'new') newProject();
    if (m.name === 'newSample') newProject(true);
    if (m.name === 'open') open();
    if (m.name === 'openRecent' && m.arg) reopen(m.arg);
    if (m.name === 'preferences') setDialog('preferences');
  };
  useEffect(() => (isPanel ? undefined : listen((m) => fromPanels.current(m))), []);

  const mainClosed = useSyncExternalStore(subscribeShared, isMainClosed, isMainClosed);

  /** Open a view in a window of its own, on the monitor beside this one. */
  const popOut = (view: PanelView, moveHere = false) => {
    void openWindow(view).catch(() => say('The browser blocked the new window. Allow pop-ups for the studio.'));
    // The main window keeps the spine; the view it sent away comes back to the graph.
    if (moveHere && route.view !== 'graph') setRoute(route.view === 'scene' ? { view: 'graph' } : route.back);
  };
  const [displays, setDisplays] = useState(1);
  useEffect(() => {
    void desktop()?.displayCount?.().then(setDisplays);
  }, []);

  // Commands from the desktop's native menu and its close dialog.
  useEffect(() => {
    const bridge = desktop();
    if (__LICENSING__ && !isPanel) void bridge?.takeOpenFile?.().then((path) => path && fromPanels.current({ t: 'command', name: 'openRecent', arg: path }));
    return bridge?.onCommand?.((command) => {
      if (command === 'preferences') setDialog('preferences');
      if (command === 'about') setDialog('about');
      if (command === 'save-then-close') void save().then((ok) => ok && bridge.close?.());
      if (command.startsWith('route:')) setRoute(routeFor(parseView(new URLSearchParams(command.slice(6)))));
      // A .vcgs file opened from the system (double-clicked, or dropped on the app).
      if (__LICENSING__ && command.startsWith('open:')) fromPanels.current({ t: 'command', name: 'openRecent', arg: command.slice(5) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // File and view shortcuts work everywhere, even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ask || dialog || searching) return;
      if (mod && (key === 'k' || key === 'f')) {
        e.preventDefault();
        setSearching(true);
      } else if (e.shiftKey && e.code === 'Digit2' && !mod && !isTyping(e.target) && route.view === 'graph' && selection) {
        e.preventDefault();
        zoomTo(selection);
      } else if (e.key === 'F5' && route.view !== 'level') {
        // In the levels, F5 plays the level (the Level Designer takes it).
        e.preventDefault();
        if (e.shiftKey) {
          const from = route.view === 'scene' ? route.sceneId : route.view === 'graph' && selection && project.placements[selection] ? selection : null;
          if (from) openPlay(from);
        } else if (route.view === 'play') setRoute(route.back);
        else openPlay();
      } else if (mod && key === 's') {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (mod && key === 'o') {
        e.preventDefault();
        open();
      } else if (mod && key === 'n') {
        e.preventDefault();
        newProject();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setDialog('preferences');
      } else if (mod && key === 'b' && !isTyping(e.target)) {
        e.preventDefault();
        if (route.view === 'bible') setRoute(route.back);
        else openBible();
      } else if (mod && key === 'l' && !isTyping(e.target)) {
        e.preventDefault();
        if (route.view === 'level') setRoute(route.back);
        else openLevels(route.view === 'graph' ? (selection ?? undefined) : route.view === 'scene' ? route.sceneId : undefined);
      } else if (mod && key === 'e' && !isTyping(e.target)) {
        e.preventDefault();
        if (route.view === 'engine') setRoute(route.back);
        else openEngine();
      } else if (e.key === '?' && !mod && !isTyping(e.target)) {
        e.preventDefault();
        setDialog('shortcuts');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ask) {
        if (e.key === 'Escape') setAsk(null);
        return;
      }
      if (dialog) {
        if (e.key === 'Escape') setDialog(null);
        return;
      }
      if (searching) return;
      if (e.key === 'Escape') {
        setDrag(null);
        if (!isTyping(e.target)) {
          setSelection(null);
          setSceneSelection(null);
        }
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (isAside(route)) {
        // The Bible edits in its own fields; only undo and redo reach the app.
        if (mod && key === 'z') {
          e.preventDefault();
          if (e.shiftKey) studio.redo();
          else studio.undo();
        } else if (mod && key === 'y') {
          e.preventDefault();
          studio.redo();
        }
        return;
      }
      if (route.view === 'scene') {
        if (mod && key === 'z') {
          e.preventDefault();
          if (e.shiftKey) studio.redo();
          else studio.undo();
        } else if (mod && key === 'y') {
          e.preventDefault();
          studio.redo();
        } else if (mod && key === '0') {
          e.preventDefault();
          surface.current?.fit?.();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && route.mode === 'timeline') {
          e.preventDefault();
          surface.current?.remove?.();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && sceneSelection && inScene(project, route.sceneId, sceneSelection)) {
          e.preventDefault();
          removeFromSceneAsking(route.sceneId, sceneSelection);
        } else if ((e.key === 'F2' || e.key === 'Enter') && sceneSelection) {
          e.preventDefault();
          surface.current?.rename(sceneSelection);
        }
        return;
      }
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        studio.undo();
      } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        studio.redo();
      } else if (mod && key === '0') {
        e.preventDefault();
        fit();
      } else if (!mod && (e.key === '=' || e.key === '+')) {
        zoomBy(1.2);
      } else if (!mod && (e.key === '-' || e.key === '_')) {
        zoomBy(1 / 1.2);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        deleteItem(selection);
      } else if ((e.key === 'F2' || e.key === 'Enter') && selection) {
        e.preventDefault();
        canvas.current?.rename(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showGhost = drag && (drag.moved || drag.placing);
  const railOn = inSceneView ? rail.scene : rail.graph;

  // ------------------------------------------------------------ the menu bar

  const onGraph = route.view === 'graph';
  const fitsHere = onGraph || (route.view === 'scene' && route.mode !== 'open');
  const selected = onGraph ? selection : route.view === 'scene' ? sceneSelection : null;
  const canRename = !!selected && !!project.objects[selected];
  const canDelete = onGraph ? !!selection : route.view === 'scene' && !!sceneSelection && inScene(project, route.sceneId, sceneSelection);
  const sep: MenuItem = { kind: 'separator' };
  /** Where "Play from here" starts: the scene you are in, or the node selected on the graph. */
  const playFrom = route.view === 'scene' ? route.sceneId : onGraph && selection && project.placements[selection] ? selection : null;
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New project', shortcut: 'Mod+N', onClick: () => newProject() },
        { label: 'New from the sample (The Sunken Vault)', onClick: () => newProject(true) },
        { label: 'Open…', shortcut: 'Mod+O', onClick: open },
        {
          label: 'Open recent',
          hint: desktop() ? undefined : 'Recent files are listed in the desktop app.',
          submenu: recent.length
            ? [
                ...recent.map((r): MenuItem => ({ label: r.name, hint: r.path, onClick: () => reopen(r.path) })),
                sep,
                { label: 'Clear the list', onClick: () => (clearRecent(), setRecent([])) },
              ]
            : [],
        },
        sep,
        { label: isPreview() ? 'Save (full edition)' : 'Save', shortcut: 'Mod+S', onClick: () => void save() },
        { label: 'Save As…', shortcut: 'Mod+Shift+S', onClick: () => void save(true), disabled: isPreview() },
        sep,
        {
          label: 'Export',
          submenu: [
            { label: 'Engine handoff…', shortcut: 'Mod+E', onClick: () => openEngine() },
            { kind: 'heading', label: 'PRODUCTION REPORTS' },
            ...REPORTS.map((r): MenuItem => ({ label: r.label, onClick: () => openBible(undefined, r.key) })),
          ],
        },
        sep,
        { label: 'Preferences…', shortcut: 'Mod+,', onClick: () => setDialog('preferences') },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Search…', shortcut: 'Mod+K', onClick: () => setSearching(true) },
        sep,
        { label: 'Undo', shortcut: 'Mod+Z', onClick: studio.undo, disabled: !studio.canUndo },
        { label: 'Redo', shortcut: 'Mod+Shift+Z', onClick: studio.redo, disabled: !studio.canRedo },
        sep,
        {
          label: 'Rename',
          shortcut: 'F2',
          disabled: !canRename,
          onClick: () => (onGraph ? canvas.current?.rename(selection!) : surface.current?.rename(sceneSelection!)),
        },
        {
          label: 'Delete',
          shortcut: 'Delete',
          disabled: !canDelete,
          onClick: () => {
            if (onGraph) deleteItem(selection);
            else if (route.view === 'scene' && sceneSelection) {
              removeFromSceneAsking(route.sceneId, sceneSelection);
            }
          },
        },
        { label: 'Deselect', shortcut: 'Esc', disabled: !selected, onClick: () => (setSelection(null), setSceneSelection(null)) },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Story graph', checked: onGraph, onClick: () => setRoute({ view: 'graph' }) },
        { label: 'Game Bible', shortcut: 'Mod+B', checked: route.view === 'bible', onClick: () => openBible() },
        { label: 'Levels', shortcut: 'Mod+L', checked: route.view === 'level', onClick: () => openLevels() },
        { label: 'Note Sorter', checked: route.view === 'notes', onClick: () => (route.view === 'notes' ? setRoute(route.back) : openNotes()) },
        { label: 'Puzzle Creator', checked: route.view === 'puzzles', onClick: () => (route.view === 'puzzles' ? setRoute(route.back) : openPuzzles()) },
        { label: 'Engine handoff', shortcut: 'Mod+E', checked: route.view === 'engine', onClick: () => openEngine() },
        { label: 'Comments and changes', checked: dialog === 'comments', onClick: () => setDialog('comments') },
        { label: 'Play-through', shortcut: 'F5', checked: route.view === 'play', onClick: () => openPlay() },
        {
          label: 'Play from here',
          shortcut: 'Shift+F5',
          disabled: !playFrom,
          hint: 'Play from the selected scene, or the scene you are in, with a fresh world.',
          onClick: () => playFrom && openPlay(playFrom),
        },
        ...(route.view === 'scene'
          ? [
              sep,
              { label: 'Scene', checked: route.mode === 'open', onClick: () => openScene(route.sceneId, 'open') },
              { label: 'Mind map', checked: route.mode === 'exploded', onClick: () => openScene(route.sceneId, 'exploded') },
              { label: 'Timeline', checked: route.mode === 'timeline', onClick: () => openScene(route.sceneId, 'timeline') },
            ]
          : []),
        sep,
        { label: 'Zoom in', shortcut: '+', disabled: !onGraph, onClick: () => zoomBy(1.2) },
        { label: 'Zoom out', shortcut: '−', disabled: !onGraph, onClick: () => zoomBy(1 / 1.2) },
        { label: 'Zoom to fit', shortcut: 'Mod+0', disabled: !fitsHere, onClick: () => (onGraph ? fit() : surface.current?.fit?.()) },
        { label: 'Zoom to the spine', disabled: !onGraph, onClick: toSpine },
        { label: 'Zoom to selection', shortcut: 'Shift+2', disabled: !onGraph || !selection || !project.objects[selection] || !project.placements[selection], onClick: () => selection && zoomTo(selection) },
        sep,
        { label: 'Minimap', checked: preferences.showMinimap, onClick: () => setPreferences({ showMinimap: !preferences.showMinimap }) },
        { label: 'Dot grid', checked: preferences.showGrid, onClick: () => setPreferences({ showGrid: !preferences.showGrid }) },
        {
          label: 'Palette as a rail',
          checked: railOn,
          disabled: isAside(route),
          onClick: () => setRail((r) => (inSceneView ? { ...r, scene: !r.scene } : { ...r, graph: !r.graph })),
        },
      ],
    },
    {
      label: 'Project',
      items: [
        { label: 'Rename project…', onClick: () => (setRoute({ view: 'graph' }), setRenameRequest((n) => n + 1)) },
        { label: 'Game setup…', onClick: () => setDialog('setup') },
        { label: 'Your own kinds of element…', onClick: () => setDialog('kinds') },
        sep,
        { label: 'Add a subplot lane', disabled: !onGraph, onClick: () => onAddLane('subplot') },
        { label: 'Add a character arc lane', disabled: !onGraph, onClick: () => onAddLane('character') },
        ...(project.lanes.some((l) => l.role === 'player') ? [] : [{ label: 'Add the Player Lane', disabled: !onGraph, onClick: () => commit(ensurePlayerLane(project).project) }]),
        sep,
        {
          label: issues.length ? `Next thing to look at (${issues.length})` : 'Nothing to look at',
          disabled: !issues.length || !onGraph,
          onClick: showNextIssue,
        },
      ],
    },
    {
      label: 'Window',
      items: [
        {
          label: 'Open in a new window',
          submenu: [
            { label: 'Game Bible', onClick: () => popOut({ view: 'bible' }) },
            { label: 'Levels', onClick: () => popOut({ view: 'level' }) },
            { label: 'Engine handoff', onClick: () => popOut({ view: 'engine' }) },
            { label: 'Play-through', onClick: () => popOut({ view: 'play' }) },
            { label: 'Story graph', onClick: () => popOut({ view: 'graph' }) },
            ...(route.view === 'scene' ? [{ label: `This scene (${project.objects[route.sceneId]?.name ?? ''})`, onClick: () => popOut(viewOf(route)) }] : []),
          ],
        },
        {
          label: 'Move this view to another monitor',
          hint: 'Opens this view in its own window beside this one; this window goes back to the story graph.',
          disabled: route.view === 'graph' || isPanel,
          onClick: () => popOut(viewOf(route), true),
        },
        ...(desktop()?.arrangeWindows
          ? [
              {
                label: displays > 1 ? `Arrange across ${displays} monitors` : 'Arrange windows',
                hint: 'The story graph on the middle monitor, the Bible to its left, the other windows to its right.',
                onClick: () => void desktop()!.arrangeWindows!(),
              },
            ]
          : []),
        ...(isPanel ? [sep, { label: 'Go to the main window', onClick: () => (desktop()?.focusMain ? desktop()!.focusMain!() : window.opener?.focus()) }] : []),
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Getting started', onClick: () => setDialog('guide') },
        { label: 'Keyboard shortcuts', shortcut: '?', onClick: () => setDialog('shortcuts') },
        { label: 'About VC Game Studio', onClick: () => setDialog('about') },
        sep,
        ...(__LICENSING__
          ? [
              { label: 'License and account…', onClick: () => setDialog('license') },
              { label: 'Show project backups', onClick: () => void desktop()?.showBackups?.() },
              { label: 'Show logs (for support)', onClick: () => void desktop()?.showLogs?.() },
            ]
          : []),
        { label: isPreview() ? 'Buy or subscribe…' : 'vc-gamestudio.com', onClick: () => window.open(isPreview() ? PURCHASE_URL : 'https://vc-gamestudio.com', '_blank', 'noreferrer') },
      ],
    },
  ];

  const scene = route.view === 'scene' ? project.objects[route.sceneId] : undefined;
  const crumbs: Crumb[] | undefined =
    route.view === 'scene' && scene
      ? [
          { label: 'Story Graph', onClick: backToGraph },
          ...(route.mode !== 'open'
            ? [
                { label: `${scene.data.code ?? ''} ${scene.name}`.trim(), symbol: 'scene' as const, onClick: () => openScene(route.sceneId, 'open') },
                { label: route.mode === 'timeline' ? 'Timeline' : 'Exploded' },
              ]
            : [{ label: `${scene.data.code ?? ''} ${scene.name}`.trim(), symbol: 'scene' as const }]),
        ]
      : undefined;
  const sceneControls =
    route.view === 'scene' ? (
      <>
        <div role="group" aria-label="Scene view" className="view-toggle">
          <button className={route.mode === 'open' ? 'on' : ''} aria-pressed={route.mode === 'open'} onClick={() => openScene(route.sceneId, 'open')}>
            Scene
          </button>
          <button className={route.mode === 'exploded' ? 'on' : ''} aria-pressed={route.mode === 'exploded'} onClick={() => openScene(route.sceneId, 'exploded')}>
            Mind map
          </button>
          <button className={route.mode === 'timeline' ? 'on' : ''} aria-pressed={route.mode === 'timeline'} onClick={() => openScene(route.sceneId, 'timeline')}>
            Timeline
          </button>
        </div>
        {route.mode === 'timeline' ? (
          <button className="tb-btn" onClick={() => openScene(route.sceneId, 'exploded')}>
            Close timeline
          </button>
        ) : route.mode === 'open' ? (
          <button className="tb-btn" title="Explode the scene into a full mind map" onClick={() => openScene(route.sceneId, 'exploded')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
            </svg>
            Expand all
          </button>
        ) : (
          <button className="tb-btn" title="Collapse back to the writing box" onClick={() => openScene(route.sceneId, 'open')}>
            Collapse scene
          </button>
        )}
      </>
    ) : null;
  const backLabel = (r: PlaceRoute): string => {
    if (r.view === 'graph') return 'Story Graph';
    const o = project.objects[r.sceneId];
    return `${o?.data.code ?? ''} ${o?.name ?? ''}${r.mode === 'timeline' ? ' · Timeline' : r.mode === 'exploded' ? ' · Mind map' : ''}`.trim();
  };
  const bibleCrumbs: Crumb[] | undefined =
    route.view === 'bible' ? [{ label: 'GAME BIBLE' }] : route.view === 'engine'
        ? [{ label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) }, { label: 'Engine Handoff' }]
        : route.view === 'play'
          ? [{ label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) }, { label: 'Play-through' }]
        : route.view === 'level'
          ? [{ label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) }, { label: 'Levels' }]
        : route.view === 'notes'
          ? [{ label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) }, { label: 'Note Sorter' }]
        : route.view === 'puzzles'
          ? [{ label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) }, { label: 'Puzzle Creator' }]
          : route.view === 'cinematic'
            ? [
                { label: 'Story Graph', onClick: () => setRoute({ view: 'graph' }) },
                { label: project.objects[route.id]?.name ?? 'Cinematic', symbol: 'cinematic' as const },
                { label: 'Shot list' },
              ]
            : undefined;
  const bibleControls =
    isAside(route) ? (
      <button className="tb-btn back-btn" onClick={() => setRoute(route.back)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M10 3L5 8l5 5" />
        </svg>
        Back to {backLabel(route.back)}
      </button>
    ) : null;

  return (
    <NavContext.Provider value={nav}>
      <div
        className={`app${drag ? ' is-dragging' : ''}${railOn ? ' has-rail' : ''}${isAside(route) ? ' no-palette' : ''}${preferences.showGrid ? '' : ' no-grid'}`}
        style={{ '--script-size': `${preferences.scriptSize}px` } as React.CSSProperties}
      >
        <TopBar
          menus={menus}
          windowLabel={role.kind === 'panel' ? WINDOW_LABEL[role.start.view] : undefined}
          projectName={project.name}
          fileName={studio.file?.name}
          renameRequest={renameRequest}
          crumbs={crumbs ?? bibleCrumbs}
          viewControls={sceneControls ?? bibleControls}
          onRename={(name) => commit(renameProject(project, name))}
          onActivate={__LICENSING__ && isPreview() && currentAccess().state !== 'web' ? () => setDialog('license') : undefined}
          canUndo={studio.canUndo}
          canRedo={studio.canRedo}
          onUndo={studio.undo}
          onRedo={studio.redo}
          onFit={route.view === 'graph' ? fit : route.view === 'scene' && route.mode !== 'open' ? () => surface.current?.fit?.() : undefined}
          onBible={() => (route.view === 'bible' ? setRoute(route.back) : openBible(route.view === 'scene' ? (sceneSelection ?? route.sceneId) : route.view === 'graph' ? (selection ?? undefined) : undefined))}
          onEngine={() => (route.view === 'engine' ? setRoute(route.back) : openEngine())}
          onLevels={() => (route.view === 'level' ? setRoute(route.back) : openLevels(route.view === 'scene' ? route.sceneId : route.view === 'graph' ? (selection ?? undefined) : undefined))}
          levelsOn={route.view === 'level'}
          onNotes={() => (route.view === 'notes' ? setRoute(route.back) : openNotes())}
          onPuzzles={() => (route.view === 'puzzles' ? setRoute(route.back) : openPuzzles())}
          puzzlesOn={route.view === 'puzzles'}
          onComments={() => setDialog(dialog === 'comments' ? null : 'comments')}
          openComments={(project.comments ?? []).filter((c) => !c.done).length}
          notesOn={route.view === 'notes'}
          saveState={studio.saveState}
          issueCount={route.view === 'graph' ? issues.length : 0}
          onIssues={showNextIssue}
          onSearch={() => setSearching(true)}
          onPlay={() => (route.view === 'play' ? setRoute(route.back) : openPlay())}
        />
        {!isAside(route) && <Palette
          active={drag?.placing ? drag.type : null}
          onStart={startPaletteDrag}
          mode={inSceneView ? 'scene' : 'graph'}
          rail={railOn}
          onToggleRail={() => setRail((r) => (inSceneView ? { ...r, scene: !r.scene } : { ...r, graph: !r.graph }))}
        />}
        <main className="main">
          {route.view === 'graph' && (
            <>
              <StoryCanvas
                ref={canvas}
                project={project}
                onCommit={commit}
                view={view}
                setView={setView}
                selection={selection}
                onSelect={setSelection}
                paletteDrag={showGhost ? drag : null}
                bottomInset={BOTTOM_BAR}
                onConfirm={setAsk}
                onDelete={deleteItem}
                issues={issueMap}
                onSay={say}
                onOpenScene={openScene}
                onPlayFrom={openPlay}
              />
              <BottomBar
                lanes={project.lanes}
                zoom={view.zoom}
                onAddLane={onAddLane}
                onToggleLane={onToggleLane}
                onZoomToSpine={toSpine}
                onZoom={zoomBy}
              />
            </>
          )}
          {route.view === 'scene' && scene && route.mode === 'open' && (
            <SceneWorkspace
              key={route.sceneId}
              ref={surface}
              project={project}
              sceneId={route.sceneId}
              onCommit={commit}
              selection={sceneSelection}
              onSelect={setSceneSelection}
              paletteDrag={showGhost ? drag : null}
              onSay={say}
              onTimeline={() => openScene(route.sceneId, 'timeline')}
              onOpenBible={openBible}
              onOpenCode={openEngine}
              onNavigate={navigate}
              focusLine={lineFocus}
            />
          )}
          {route.view === 'scene' && scene && route.mode === 'timeline' && (
            <SceneTimeline
              key={route.sceneId}
              ref={surface}
              project={project}
              sceneId={route.sceneId}
              onCommit={commit}
              paletteDrag={showGhost ? drag : null}
              onSay={say}
              onOpen={() => openScene(route.sceneId, 'open')}
              onRemove={(id) => removeFromSceneAsking(route.sceneId, id)}
              onFullView={() => openScene(route.sceneId, 'exploded')}
            />
          )}
          {route.view === 'scene' && scene && route.mode === 'exploded' && (
            <ExplodedScene
              key={route.sceneId}
              ref={surface}
              project={project}
              sceneId={route.sceneId}
              onCommit={commit}
              selection={sceneSelection}
              onSelect={setSceneSelection}
              paletteDrag={showGhost ? drag : null}
              onSay={say}
              onOpen={() => openScene(route.sceneId, 'open')}
              onTimeline={() => openScene(route.sceneId, 'timeline')}
              onOpenBible={openBible}
              onOpenCode={openEngine}
              onNavigate={navigate}
              onRemove={(id) => removeFromSceneAsking(route.sceneId, id)}
            />
          )}
          <Suspense fallback={<div className="view-loading" role="status">Opening…</div>}>
            {route.view === 'bible' && (
              <GameBible key={route.report ?? 'bible'} project={project} onCommit={commit} focus={route.focus} report={route.report} onNavigate={navigate} onOpenCode={openEngine} onDelete={deleteItem} />
            )}
            {route.view === 'cinematic' && (
              <ShotList key={route.id} project={project} id={route.id} onCommit={commit} onNavigate={navigate} onOpenBible={openBible} onOpenCode={openEngine} />
            )}
            {route.view === 'notes' && (
              <NoteSorter project={project} onCommit={commit} onUndo={studio.undo} canUndo={studio.canUndo} onOpenBible={openBible} onSay={say} />
            )}
            {route.view === 'puzzles' && (
              <PuzzleCreator key={route.focus ?? 'puzzles'} project={project} onCommit={commit} onOpenBible={openBible} onOpenLevels={(id) => openLevels(id)} onSay={say} focus={route.focus} />
            )}
            {route.view === 'play' && <PlayView key={route.from ?? 'start'} project={project} from={route.from} onNavigate={navigate} onCommit={commit} />}
            {route.view === 'level' && (
              <LevelDesigner
                key={route.focus ?? 'levels'}
                project={project}
                onCommit={commit}
                onNavigate={navigate}
                onOpenBible={openBible}
                onSay={say}
                onConfirm={setAsk}
                focus={route.focus}
                mode={route.mode}
                onMode={(mode) => setRoute((r) => (r.view === 'level' ? { ...r, mode } : r))}
              />
            )}
            {route.view === 'engine' && <EngineHandoff project={project} onReplace={studio.replace} onNavigate={navigate} onSay={say} focus={route.focus} onCommit={commit} />}
          </Suspense>
          {route.view === 'graph' && Object.keys(project.objects).length <= 3 && (
            <div className="sample-card">
              <span>New here? Open the sample from the mockups to see every part working.</span>
              <button className="tb-btn small" onClick={openSample}>
                Open “The Sunken Vault”
              </button>
            </div>
          )}
        </main>
        {showGhost && (
          <div className="drag-ghost" style={{ left: drag.clientX + 12, top: drag.clientY + 12 }} aria-hidden="true">
            <Symbol type={drag.type} />
            {TYPE_LABEL[drag.type]}
            {drag.placing && !drag.moved && <span className="drag-ghost-hint">click to place · Esc to cancel</span>}
          </div>
        )}
        {ask && (
          <div className="dialog-backdrop" onPointerDown={() => setAsk(null)}>
            <div
              className="dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-message"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <h2 id="confirm-title">{ask.title}</h2>
              <p id="confirm-message">{ask.message}</p>
              {ask.details && (
                <ul className="dialog-list">
                  {ask.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              <div className="dialog-actions">
                <button className="tb-btn" onClick={() => setAsk(null)}>
                  Cancel
                </button>
                {ask.alternate && (
                  <button
                    className="tb-btn danger-btn"
                    onClick={() => {
                      ask.alternate!.onClick();
                      setAsk(null);
                    }}
                  >
                    {ask.alternate.label}
                  </button>
                )}
                <button
                  className={`tb-btn ${ask.safe ? 'primary' : 'danger-btn'}`}
                  autoFocus
                  onClick={() => {
                    ask.onConfirm();
                    setAsk(null);
                  }}
                >
                  {ask.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
        {mainClosed && (
          <div className="dialog-backdrop">
            <div className="dialog" role="alertdialog" aria-labelledby="closed-title">
              <h2 id="closed-title">The main window has closed</h2>
              <p>This window worked on the main window’s project. Open the studio again to carry on.</p>
              <div className="dialog-actions">
                <button className="tb-btn primary" onClick={() => window.close()}>
                  Close this window
                </button>
              </div>
            </div>
          </div>
        )}
        {searching && (
          <SearchPalette project={project} onGo={goToResult} onBible={(r) => openBible(r.id)} onClose={() => setSearching(false)} />
        )}
        {dialog === 'newGame' && (
          <SetupWizard
            onDone={(setup, name) => {
              setDialog(null);
              showProject(createFromSetup(name, setup), null);
            }}
            onBlank={() => {
              setDialog(null);
              showProject(createProject(), null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'setup' && (
          <SetupWizard
            editing
            initial={project.setup}
            onDone={(setup) => {
              setDialog(null);
              commit(updateSetup(project, setup));
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'preferences' && <PreferencesDialog onClose={() => setDialog(null)} />}
        {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {dialog === 'kinds' && <KindsDialog project={project} onCommit={commit} onClose={() => setDialog(null)} />}
        {dialog === 'guide' && (
          <Guide
            onClose={() => {
              markGuideSeen();
              setDialog(null);
            }}
            onSample={() => {
              markGuideSeen();
              setDialog(null);
              newProject(true);
            }}
            onGo={(place) => {
              markGuideSeen();
              if (place === 'graph') setRoute({ view: 'graph' });
              else if (place === 'bible') openBible();
              else if (place === 'notes') openNotes();
              else if (place === 'level') openLevels();
              else if (place === 'puzzles') openPuzzles();
              else if (place === 'play') openPlay();
              else openEngine();
            }}
          />
        )}
        {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
        {dialog === 'comments' && <CommentsPanel project={project} onCommit={commit} onGo={goToTarget} onClose={() => setDialog(null)} />}
        {dialog === 'previewSave' && <PreviewSaveDialog onClose={() => setDialog(null)} />}
        {__LICENSING__ && dialog === 'license' && <LicenseDialog onClose={() => setDialog(null)} />}
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </NavContext.Provider>
  );
};
