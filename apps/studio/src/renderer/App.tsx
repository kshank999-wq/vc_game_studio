import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { Palette } from './components/Palette';
import { StoryCanvas, type CanvasApi, type ConfirmRequest, type PaletteDrag } from './components/canvas/StoryCanvas';
import { Symbol } from './components/Symbol';
import { TopBar, type Crumb } from './components/TopBar';
import { ExplodedScene } from './components/scene/ExplodedScene';
import { SceneWorkspace, type SceneSurface } from './components/scene/SceneWorkspace';
import { inScene, removeFromScene } from './model/scene';
import { laneRows, nodeBox } from './model/layout';
import { addLane, isProtected, removeConnection, removeObject, renameProject, spanDependents, updateLane } from './model/project';
import { findIssues } from './model/validate';
import { TYPE_LABEL } from './model/semantics';
import type { ObjectType } from './model/types';
import { useStudio } from './use-studio';
import { fitView, spineView, zoomAt, type View } from './view';

const BOTTOM_BAR = 52;

/** Where the user is: the story graph, or inside one scene (written, or exploded). */
export type Route = { view: 'graph' } | { view: 'scene'; sceneId: string; mode: 'open' | 'exploded' };

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const App = () => {
  const studio = useStudio();
  const { project, commit } = studio;
  const canvas = useRef<CanvasApi>(null);
  const surface = useRef<SceneSurface>(null);
  const [route, setRoute] = useState<Route>({ view: 'graph' });
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

  routeRef.current = route;
  const say = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const canvasSize = () => canvas.current?.size() ?? { w: window.innerWidth - 264, h: window.innerHeight - 104 };
  const fit = () => setViewState(fitView(project, canvasSize().w, canvasSize().h));
  const toSpine = () => setViewState(spineView(project, canvasSize().w, canvasSize().h));
  const zoomBy = (factor: number) => setViewState((v) => zoomAt(v, factor, canvasSize().w / 2, canvasSize().h / 2));

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
  const openScene = (sceneId: string, mode: 'open' | 'exploded') => {
    setRoute({ view: 'scene', sceneId, mode });
    setSceneSelection(null);
  };
  const [sceneSelection, setSceneSelection] = useState<string | null>(null);
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
    if (!box) return;
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
    };
    const dependents = spanDependents(project, id);
    if (dependents.length === 0) {
      remove();
      return;
    }
    const names = dependents.map((l) => `“${l.name}”`).join(', ');
    setAsk({
      title: `Delete “${project.objects[id]!.name}”?`,
      message: `${names} ${dependents.length === 1 ? 'branches off or rejoins' : 'branch off or rejoin'} the spine here. It will move to the neighbouring spine node.`,
      confirmLabel: 'Delete',
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ask) {
        if (e.key === 'Escape') setAsk(null);
        return;
      }
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
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && sceneSelection && inScene(project, route.sceneId, sceneSelection)) {
          e.preventDefault();
          commit(removeFromScene(project, route.sceneId, sceneSelection));
          setSceneSelection(null);
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

  const scene = route.view === 'scene' ? project.objects[route.sceneId] : undefined;
  const crumbs: Crumb[] | undefined =
    route.view === 'scene' && scene
      ? [
          { label: 'Story Graph', onClick: backToGraph },
          ...(route.mode === 'exploded'
            ? [
                { label: `${scene.data.code ?? ''} ${scene.name}`.trim(), symbol: 'scene' as const, onClick: () => openScene(route.sceneId, 'open') },
                { label: 'Exploded' },
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
        </div>
        {route.mode === 'open' ? (
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
  const railOn = inSceneView ? rail.scene : rail.graph;

  return (
    <div className={`app${drag ? ' is-dragging' : ''}${railOn ? ' has-rail' : ''}`}>
      <TopBar
        projectName={project.name}
        crumbs={crumbs}
        viewControls={sceneControls}
        onRename={(name) => commit(renameProject(project, name))}
        canUndo={studio.canUndo}
        canRedo={studio.canRedo}
        onUndo={studio.undo}
        onRedo={studio.redo}
        onFit={route.view === 'graph' ? fit : route.mode === 'exploded' ? () => surface.current?.fit?.() : undefined}
        onBible={() => say('The Game Bible is not built yet.')}
        onEngine={() => say('Engine handoff is not built yet.')}
        saveState={studio.saveState}
        issueCount={route.view === 'graph' ? issues.length : 0}
        onIssues={showNextIssue}
      />
      <Palette
        active={drag?.placing ? drag.type : null}
        onStart={startPaletteDrag}
        mode={inSceneView ? 'scene' : 'graph'}
        rail={railOn}
        onToggleRail={() => setRail((r) => (inSceneView ? { ...r, scene: !r.scene } : { ...r, graph: !r.graph }))}
      />
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
          />
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
            <div className="dialog-actions">
              <button className="tb-btn" onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button
                className="tb-btn danger-btn"
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
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
};
