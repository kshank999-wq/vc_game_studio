import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { Palette } from './components/Palette';
import { StoryCanvas, type CanvasApi, type ConfirmRequest, type PaletteDrag } from './components/StoryCanvas';
import { Symbol } from './components/Symbol';
import { TopBar } from './components/TopBar';
import { laneRows } from './model/layout';
import { addLane, isProtected, removeObject, renameProject, spanDependents, updateLane } from './model/project';
import { TYPE_LABEL } from './model/semantics';
import type { ObjectType } from './model/types';
import { useStudio } from './use-studio';
import { fitView, spineView, zoomAt, type View } from './view';

const BOTTOM_BAR = 52;

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const App = () => {
  const studio = useStudio();
  const { project, commit } = studio;
  const canvas = useRef<CanvasApi>(null);
  const [view, setViewState] = useState<View>({ zoom: 1, panX: 180, panY: 300 });
  const setView = useCallback((update: (view: View) => View) => setViewState(update), []);
  const [selection, setSelection] = useState<string | null>(null);
  const [drag, setDrag] = useState<PaletteDrag | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragRef = useRef<PaletteDrag | null>(null);
  dragRef.current = drag;
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);

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

  // A selection that no longer exists (after undo, say) is dropped.
  useEffect(() => {
    if (selection && !project.objects[selection]) setSelection(null);
  }, [project, selection]);

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
      canvas.current?.drop(at);
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

  const deleteSelection = () => {
    if (!selection || !project.objects[selection]) return;
    if (isProtected(project, selection)) {
      say('Beginning and Ending are protected. You can rename them but not remove them.');
      return;
    }
    const id = selection;
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
      message: `${names} ${dependents.length === 1 ? 'starts or stops' : 'start or stop'} here. The span will move to the neighbouring spine node.`,
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
        if (!isTyping(e.target)) setSelection(null);
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        studio.undo();
      } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        studio.redo();
      } else if (mod && key === '0') {
        e.preventDefault();
        fit();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        deleteSelection();
      } else if ((e.key === 'F2' || e.key === 'Enter') && selection) {
        e.preventDefault();
        canvas.current?.rename(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showGhost = drag && (drag.moved || drag.placing);

  return (
    <div className={`app${drag ? ' is-dragging' : ''}`}>
      <TopBar
        projectName={project.name}
        onRename={(name) => commit(renameProject(project, name))}
        canUndo={studio.canUndo}
        canRedo={studio.canRedo}
        onUndo={studio.undo}
        onRedo={studio.redo}
        onFit={fit}
        onBible={() => say('The Game Bible is not built yet.')}
        onEngine={() => say('Engine handoff is not built yet.')}
        saveState={studio.saveState}
      />
      <Palette active={drag?.placing ? drag.type : null} onStart={startPaletteDrag} />
      <main className="main">
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
        />
        <BottomBar
          lanes={project.lanes}
          zoom={view.zoom}
          onAddLane={onAddLane}
          onToggleLane={onToggleLane}
          onZoomToSpine={toSpine}
          onZoom={zoomBy}
        />
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
