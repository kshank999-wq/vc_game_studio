import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { assetOf, frameOf, type Point } from '../../model/level/geometry';
import { findAsset } from '../../model/level/library';
import {
  addFloor,
  addLevel,
  duplicateItems,
  groupItems,
  levelsOf,
  moveItems,
  placeAsset,
  removeAsset,
  removeItems,
  removalOf,
  rotateItems,
  saveToLibrary,
  ungroupItems,
  updateItem,
  updateSettings,
  withGroups,
} from '../../model/level/level';
import { exportNameOf } from '../../model/level/naming';
import type { AssetCategory, AssetDefinition, Perspective } from '../../model/level/types';
import { levelIssues } from '../../model/level/validate';
import { pointNear, startPoint } from '../../model/level/play';
import type { PlayWorld } from '../../model/play';
import type { PlayStart } from './PlayMode';
import type { Destination } from '../../model/details';
import type { Project } from '../../model/types';
import type { View } from '../../view';
import type { ConfirmRequest } from '../canvas/StoryCanvas';
import { forgetAsset, promoteAsset, useGlobalAssets } from './global-library';
import type { GrayboxApi } from './Graybox';
import { AssetIcon, LevelLibrary } from './LevelLibrary';
import { LevelInspector } from './LevelInspector';
import { LevelMap, type MapApi, type MapTool } from './LevelMap';
import { formatLength } from './units';

// three.js is big: it loads the first time the graybox is opened.
const Graybox = lazy(() => import('./Graybox'));
const PlayMode = lazy(() => import('./PlayMode'));

export type LevelMode = '2d' | '3d';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onNavigate: (to: Destination) => void;
  onOpenBible: (id?: string) => void;
  onSay: (message: string) => void;
  onConfirm: (request: ConfirmRequest) => void;
  /** An item to select, or a story element whose level items to select. */
  focus?: string;
  mode?: LevelMode;
  onMode?: (mode: LevelMode) => void;
}

interface Pick {
  assetId: string;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  moved: boolean;
  /** Picked up with a click: stays until put down or Esc. */
  sticky: boolean;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const DRAW_ASSETS = ['space.room', 'space.hall', 'space.stairwell', 'space.exterior', 'space.arena', 'logic.trigger', 'pres.ambient', 'spawn.wave', 'space.platform', 'arch.floor'];
const OUTLINE_ASSETS = ['space.room', 'space.hall', 'space.stairwell', 'space.exterior', 'space.arena', 'logic.trigger', 'pres.cinematic', 'pres.ambient', 'logic.hazard', 'logic.damage', 'spawn.wave', 'play.checkpoint'];

/**
 * The Level Designer (docs/specs/level-designer-spec.md): library on the
 * left, the 2D map or 3D graybox in the middle, the inspector on the right.
 * Both views and the inspector edit the same items.
 */
export const LevelDesigner = ({ project, onCommit, onNavigate, onOpenBible, onSay, onConfirm, focus, mode: initialMode = '2d', onMode }: Props) => {
  const set = levelsOf(project);
  const global = useGlobalAssets();
  const focusItem = focus ? set.items.find((i) => i.id === focus) : undefined;
  const focusLinked = focus && !focusItem ? set.items.filter((i) => i.links?.includes(focus) || Object.values(i.params ?? {}).includes(focus)) : [];
  const [levelId, setLevelId] = useState<string>(() => focusItem?.levelId ?? focusLinked[0]?.levelId ?? set.levels[0]?.id ?? '');
  const level = set.levels.find((l) => l.id === levelId) ?? set.levels[0];
  const [floorId, setFloorId] = useState<string>(() => focusItem?.floorId ?? focusLinked[0]?.floorId ?? level?.floors[0]?.id ?? '');
  const floor = level?.floors.find((f) => f.id === floorId) ?? level?.floors[0];
  const [mode, setModeState] = useState<LevelMode>(initialMode);
  const setMode = (m: LevelMode) => {
    setModeState(m);
    onMode?.(m);
  };
  const [selection, setSelection] = useState<string[]>(() => (focusItem ? [focusItem.id] : focusLinked.map((i) => i.id)));
  const [tool, setTool] = useState<MapTool>('select');
  const [drawAsset, setDrawAsset] = useState('space.room');
  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  pickRef.current = pick;
  const [leftTab, setLeftTab] = useState<'library' | 'outliner'>('library');
  const [hidden, setHidden] = useState<ReadonlySet<AssetCategory>>(() => new Set());
  const [overlays, setOverlays] = useState({ story: true, dims: true, ghost: true });
  const [view3d, setView3d] = useState({ ceilings: false, allFloors: false, logic: true });
  const [view, setView] = useState<View>({ zoom: 1, panX: 400, panY: 300 });
  const [hover, setHover] = useState<Point | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [focus3d, setFocus3d] = useState<string[] | undefined>(focusItem ? [focusItem.id] : undefined);
  const [playing, setPlaying] = useState<{ levelId: string; start: PlayStart; world?: PlayWorld; presetId?: string; key: number } | null>(null);
  const [playFrom, setPlayFrom] = useState<'start' | 'selection' | 'camera'>('start');
  const [playPreset, setPlayPreset] = useState('');
  const [playPerspective, setPlayPerspective] = useState<Perspective | null>(null);
  const map = useRef<MapApi>(null);
  const box = useRef<GrayboxApi>(null);
  const playingRef = useRef(false);
  const latest = useRef({ project, selection, levelId: level?.id ?? '', floorId: floor?.id ?? '' });
  latest.current = { project, selection, levelId: level?.id ?? '', floorId: floor?.id ?? '' };

  playingRef.current = !!playing;
  const issues = useMemo(() => levelIssues(project, global), [project, global]);
  const levelIssuesHere = issues.filter((i) => i.levelId === level?.id);
  const issueMap = useMemo(() => new Map(issues.map((i) => [i.id, i.message])), [issues]);

  // Keep the floor and selection valid as things change (undo, another window).
  useEffect(() => {
    if (level && !level.floors.some((f) => f.id === floorId)) setFloorId(level.floors[0]!.id);
    if (!set.levels.some((l) => l.id === levelId) && set.levels[0]) setLevelId(set.levels[0].id);
    setSelection((s) => {
      const kept = s.filter((id) => set.items.some((i) => i.id === id));
      return kept.length === s.length ? s : kept;
    });
  }, [set, level, floorId, levelId]);

  // Open framed on the focus, or the floor.
  useEffect(() => {
    const t = setTimeout(() => map.current?.frame(focusItem ? [focusItem.id] : focusLinked.length ? focusLinked.map((i) => i.id) : undefined), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level?.id, floor?.id]);

  // ------------------------------------------------------------ placing from the library

  /** A global asset placed in a project is copied into it, so the file opens anywhere. */
  const withAsset = (p: Project, assetId: string): Project => {
    const s = levelsOf(p);
    if (s.assets.some((a) => a.id === assetId)) return p;
    const g = global.find((a) => a.id === assetId);
    return g ? { ...p, levels: { ...s, assets: [...s.assets, g] } } : p;
  };

  const place = (assetId: string, at: Point) => {
    const { project: p, levelId: lid, floorId: fid } = latest.current;
    if (!lid || !fid) return;
    const placed = placeAsset(withAsset(p, assetId), lid, fid, assetId, at, { global });
    if (!placed.ids.length) return;
    onCommit(placed.project);
    setSelection(placed.ids);
    const def = findAsset(assetId, levelsOf(placed.project).assets, global);
    const item = levelsOf(placed.project).items.find((i) => i.id === placed.ids[0]);
    if (item?.invalid) onSay(item.invalid);
    else if (def?.kind === 'hosted') onSay(`${def.name} placed in the wall.`);
  };

  const onPickAsset = (assetId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (pick?.sticky && pick.assetId === assetId) {
      setPick(null);
      return;
    }
    setTool('select');
    setPick({ assetId, clientX: e.clientX, clientY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, sticky: false });
    const where = mode;
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      const p = pickRef.current;
      if (!p) return;
      if (!p.moved) {
        // A click picks it up; the next click on the map puts it down.
        setPick({ ...p, sticky: true });
        return;
      }
      const at = (where === '3d' ? box.current : map.current)?.worldAt(u.clientX, u.clientY);
      if (at) place(p.assetId, at);
      setPick(null);
    };
    window.addEventListener('pointerup', up);
  };
  const picking = !!pick;
  useEffect(() => {
    if (!picking) return;
    const move = (m: PointerEvent) =>
      setPick((p) => p && { ...p, clientX: m.clientX, clientY: m.clientY, moved: p.moved || (!p.sticky && Math.hypot(m.clientX - p.startX, m.clientY - p.startY) > 4) });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [picking]);

  const putDown = (at: Point) => {
    const p = pickRef.current;
    if (!p) return;
    place(p.assetId, at);
    setPick(null);
  };

  // ------------------------------------------------------------ commands

  const remove = (ids: readonly string[] = selection) => {
    if (!ids.length) return;
    const p = latest.current.project;
    const s = levelsOf(p);
    const also = removalOf(p, ids);
    const go = () => {
      onCommit(removeItems(p, ids));
      setSelection([]);
    };
    const names = ids.map((id) => s.items.find((i) => i.id === id)?.name).filter(Boolean);
    if (!also.length) {
      go();
      onSay(names.length === 1 ? `Deleted ${names[0]}.` : `Deleted ${names.length} items.`);
      return;
    }
    onConfirm({
      title: names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${names.length} items?`,
      message: 'What is in its walls goes with it:',
      details: also.map((i) => `${i.name} (${assetOf(s, i, global).name})`),
      confirmLabel: 'Delete',
      onConfirm: go,
    });
  };

  const duplicate = () => {
    if (!selection.length) return;
    const made = duplicateItems(project, withGroups(project, selection), { x: set.settings.grid * 2 || 1, y: set.settings.grid * 2 || 1 });
    onCommit(made.project);
    setSelection(made.ids);
  };

  const save = (name: string) => {
    const made = saveToLibrary(project, selection, name, global);
    if (!made.assetId) return;
    onCommit(made.project);
    setLeftTab('library');
    onSay(`Saved “${name}” to the project library.`);
  };

  const openStory = (id: string) => {
    const o = project.objects[id];
    if (!o) return;
    if (o.type === 'scene') onNavigate({ kind: 'scene', sceneId: id, mode: 'open' });
    else onOpenBible(id);
  };

  const open3D = (id?: string) => {
    setFocus3d(id ? withGroups(project, [id]) : selection.length ? selection : undefined);
    if (id) setSelection(withGroups(project, [id]));
    setMode('3d');
  };

  /** Into Play Mode (spec §9.3): from the level's start, the selected item, or where the 3D camera is. */
  const beginPlay = (from = playFrom) => {
    const { project: p, selection: sel, levelId: lid, floorId: fid } = latest.current;
    let start: PlayStart = startPoint(p, lid, global);
    if (from === 'selection' && sel[0]) start = pointNear(p, sel[0], global) ?? start;
    if (from === 'camera' && mode === '3d') {
      const spot = box.current?.cameraSpot();
      const elevation = levelsOf(p).levels.find((l) => l.id === lid)?.floors.find((f) => f.id === fid)?.elevation ?? 0;
      if (spot) start = { x: spot.x, y: spot.y, z: elevation + 2, yaw: spot.yaw, floorId: fid };
    }
    setShowIssues(false);
    setPick(null);
    setPlayPerspective(null);
    setPlaying({ levelId: lid, start, presetId: playPreset || undefined, key: Date.now() });
  };

  const deleteAsset = (a: AssetDefinition) => {
    if (a.source === 'global') {
      forgetAsset(a.id);
      onSay(`Removed ${a.name} from your library. Projects that use it keep their copy.`);
      return;
    }
    const used = set.items.filter((i) => i.assetId === a.id).length;
    const go = () => onCommit(removeAsset(project, a.id));
    if (!used) {
      go();
      return;
    }
    onConfirm({
      title: `Remove “${a.name}” from the project library?`,
      message: `${used} placed ${used === 1 ? 'item uses' : 'items use'} it. They stay, shown as a missing asset, until you replace them.`,
      confirmLabel: 'Remove',
      onConfirm: go,
    });
  };

  /** The outline tool draws spaces and volumes; it starts with a plain room if something else was being drawn. */
  const outlineTool = () => {
    setTool((t) => (t === 'outline' ? 'select' : 'outline'));
    setDrawAsset((a) => (OUTLINE_ASSETS.includes(a) ? a : 'space.room'));
  };

  // ------------------------------------------------------------ keys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.dialog-backdrop, .search-backdrop')) return;
      // Play Mode has the keyboard to itself.
      if (playingRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') {
        e.preventDefault();
        beginPlay(e.shiftKey && latest.current.selection.length ? 'selection' : undefined);
        return;
      }
      const key = e.key.toLowerCase();
      const { project: p, selection: sel, floorId: fid, levelId: lid } = latest.current;
      if (e.key === 'Escape') {
        if (pickRef.current) setPick(null);
        else if (tool !== 'select') setTool('select');
        else setSelection([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(sel);
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicate();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelection(levelsOf(p).items.filter((i) => i.levelId === lid && i.floorId === fid && !i.hidden).map((i) => i.id));
      } else if (mod && key === 'g') {
        e.preventDefault();
        onCommit(e.shiftKey ? ungroupItems(p, sel) : groupItems(p, sel));
      } else if (!mod && key === 'r' && sel.length) {
        onCommit(rotateItems(p, sel, e.shiftKey ? -90 : 90, global));
      } else if (!mod && e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const step = (levelsOf(p).settings.grid || 0.5) * (e.shiftKey ? 4 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onCommit(moveItems(p, sel, dx, dy, global));
      } else if (!mod && key === 'f') {
        (mode === '3d' ? box.current : map.current)?.frame(sel.length ? sel : undefined);
      } else if (!mod && key === '2') setMode('2d');
      else if (!mod && key === '3') open3D();
      else if (!mod && key === 'd') setTool((t) => (t === 'draw' ? 'select' : 'draw'));
      else if (!mod && key === 'o') outlineTool();
      else if (!mod && key === 'v') setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ no level yet

  if (!level || !floor) {
    return (
      <div className="lvl-empty">
        <h2>Levels</h2>
        <p>Lay out the places your story happens: rooms from a library, doors in their walls, the player’s start, pickups, triggers and spawns. Every piece can be tied to a scene, a character or an item from the story, then walked through in 3D.</p>
        <button
          className="tb-btn primary"
          onClick={() => {
            const made = addLevel(project, project.name || 'Level 1');
            onCommit(made.project);
            setLevelId(made.id);
            setFloorId(levelsOf(made.project).levels.find((l) => l.id === made.id)!.floors[0]!.id);
          }}
        >
          + Create the first level
        </button>
      </div>
    );
  }

  const selected = selection.length === 1 ? set.items.find((i) => i.id === selection[0]) : undefined;
  const floors = [...level.floors].sort((a, b) => b.elevation - a.elevation);
  const picked = pick && findAsset(pick.assetId, set.assets, global);

  return (
    <div className={`lvl${pick ? ' is-placing' : ''}${playing ? ' playing' : ''}`}>
      <div className="lvl-bar" role="toolbar" aria-label="Level tools">
        {playing ? (
          <>
            <span className="lvl-playing">▶ Playing {set.levels.find((l) => l.id === playing.levelId)?.name}</span>
            <span className="muted">Esc or Tab pauses; the level’s rules and the story’s state are live.</span>
            <div className="grow" />
            <button className="tb-btn small" onClick={() => setPlaying(null)}>
              ■ Stop
            </button>
          </>
        ) : (
        <>
        <select className="inp small lvl-pick" aria-label="Level" value={level.id} onChange={(e) => {
          if (e.target.value === '+') {
            const made = addLevel(project);
            onCommit(made.project);
            setLevelId(made.id);
            setFloorId(levelsOf(made.project).levels.find((l) => l.id === made.id)!.floors[0]!.id);
            setSelection([]);
            return;
          }
          setLevelId(e.target.value);
          setFloorId(set.levels.find((l) => l.id === e.target.value)!.floors[0]!.id);
          setSelection([]);
        }}>
          {set.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="+">+ New level</option>
        </select>
        <select className="inp small lvl-pick" aria-label="Floor" value={floor.id} onChange={(e) => {
          if (e.target.value === '+') {
            const made = addFloor(project, level.id);
            onCommit(made.project);
            setFloorId(made.id);
            return;
          }
          setFloorId(e.target.value);
          setSelection([]);
        }}>
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {formatLength(f.elevation, set.settings.units)}
            </option>
          ))}
          <option value="+">+ Floor above</option>
        </select>
        <div role="group" aria-label="View" className="view-toggle">
          <button className={mode === '2d' ? 'on' : ''} aria-pressed={mode === '2d'} onClick={() => setMode('2d')} title="The top-down map (2)">
            2D map
          </button>
          <button className={mode === '3d' ? 'on' : ''} aria-pressed={mode === '3d'} onClick={() => open3D()} title="The 3D graybox (3)">
            3D graybox
          </button>
        </div>
        {mode === '2d' ? (
          <>
            <div role="group" aria-label="Tool" className="view-toggle">
              <button className={tool === 'select' ? 'on' : ''} aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select and move (V)">
                Select
              </button>
              <button className={tool === 'draw' ? 'on' : ''} aria-pressed={tool === 'draw'} onClick={() => setTool('draw')} title="Drag out a space on the map (D)">
                Draw
              </button>
              <button className={tool === 'outline' ? 'on' : ''} aria-pressed={tool === 'outline'} onClick={outlineTool} title="Click the corners of a space or volume of any shape; click the first corner, double-click or press Enter to close it (O)">
                Outline
              </button>
            </div>
            {tool !== 'select' && (
              <select className="inp small lvl-pick" aria-label="Draw" value={drawAsset} onChange={(e) => setDrawAsset(e.target.value)}>
                {(tool === 'outline' ? OUTLINE_ASSETS : DRAW_ASSETS).map((id) => (
                  <option key={id} value={id}>
                    {findAsset(id)!.name}
                  </option>
                ))}
              </select>
            )}
            <label className="lvl-toggle"><input type="checkbox" checked={overlays.story} onChange={(e) => setOverlays((o) => ({ ...o, story: e.target.checked }))} /> Story</label>
            <label className="lvl-toggle"><input type="checkbox" checked={overlays.dims} onChange={(e) => setOverlays((o) => ({ ...o, dims: e.target.checked }))} /> Sizes</label>
            <label className="lvl-toggle"><input type="checkbox" checked={overlays.ghost} onChange={(e) => setOverlays((o) => ({ ...o, ghost: e.target.checked }))} /> Floor below</label>
          </>
        ) : (
          <>
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.ceilings} onChange={(e) => setView3d((o) => ({ ...o, ceilings: e.target.checked }))} /> Ceilings</label>
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.allFloors} onChange={(e) => setView3d((o) => ({ ...o, allFloors: e.target.checked }))} /> All floors</label>
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.logic} onChange={(e) => setView3d((o) => ({ ...o, logic: e.target.checked }))} /> Logic volumes</label>
          </>
        )}
        <label className="lvl-toggle" title="Snap to the grid"><input type="checkbox" checked={set.settings.snap} onChange={(e) => onCommit({ ...project, levels: { ...set, settings: { ...set.settings, snap: e.target.checked } } })} /> Snap {formatLength(set.settings.grid, set.settings.units)}</label>
        <div className="grow" />
        <div className="lvl-play" role="group" aria-label="Play">
          <button className="tb-btn small primary" onClick={() => beginPlay()} title="Walk the level (F5; Shift+F5 from the selection)">
            ▶ Play
          </button>
          <select className="inp small lvl-pick" aria-label="Play from" value={playFrom} onChange={(e) => setPlayFrom(e.target.value as typeof playFrom)}>
            <option value="start">from the start</option>
            <option value="selection" disabled={!selection.length}>from the selection</option>
            <option value="camera" disabled={mode !== '3d'}>from the 3D camera</option>
          </select>
          <select className="inp small lvl-pick" aria-label="Start with" value={playPreset} onChange={(e) => setPlayPreset(e.target.value)}>
            <option value="">a fresh story</option>
            {(set.presets ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="inp small lvl-pick" aria-label="Perspective" value={set.settings.perspective ?? 'first'} onChange={(e) => onCommit(updateSettings(project, { perspective: e.target.value as Perspective }))}>
            <option value="first">first person</option>
            <option value="third">third person</option>
            <option value="top">top-down</option>
          </select>
        </div>
        <button className="tb-btn small" onClick={() => (mode === '3d' ? box.current : map.current)?.frame(selection.length ? selection : undefined)} title="Frame the selection, or the floor (F)">
          Frame
        </button>
        <div className="lvl-issues-wrap">
          <button className={`tb-btn small${levelIssuesHere.length ? ' issues-btn' : ''}`} aria-expanded={showIssues} onClick={() => setShowIssues((s) => !s)} title="Preflight: what would break in play or on export">
            {levelIssuesHere.length ? (
              <>
                <span className="issue-dot" />
                {levelIssuesHere.length} to check
              </>
            ) : (
              'Preflight ✓'
            )}
          </button>
          {showIssues && (
            <div className="lvl-issues" role="dialog" aria-label="Preflight">
              {levelIssuesHere.length === 0 && <p className="muted">Nothing to fix: this level is ready for play and export.</p>}
              {levelIssuesHere.map((i, n) => (
                <button
                  key={`${i.id}:${n}`}
                  className={`lvl-issue ${i.severity}`}
                  onClick={() => {
                    const item = set.items.find((x) => x.id === i.id);
                    if (item) {
                      setFloorId(item.floorId);
                      setSelection([item.id]);
                      setTimeout(() => (mode === '3d' ? box.current : map.current)?.frame([item.id]), 0);
                    } else setSelection([]);
                    setShowIssues(false);
                  }}
                >
                  <strong>{i.message}</strong>
                  <span className="muted">{i.export}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        </>
        )}
      </div>
      <LevelLibrary
        set={set}
        levelId={level.id}
        floorId={floor.id}
        global={global}
        active={pick?.assetId ?? null}
        onPick={onPickAsset}
        tab={leftTab}
        onTab={setLeftTab}
        selection={selection}
        onSelect={(ids) => setSelection(ids)}
        hidden={hidden}
        onToggleLayer={(c) =>
          setHidden((h) => {
            const n = new Set(h);
            if (n.has(c)) n.delete(c);
            else n.add(c);
            return n;
          })
        }
        onToggleItem={(id, what) => {
          const item = set.items.find((i) => i.id === id);
          if (item) onCommit(updateItem(project, id, { [what]: item[what] ? undefined : true }, global));
        }}
        onDeleteAsset={deleteAsset}
        onPromote={(a) => {
          promoteAsset(a);
          onSay(`${a.name} is in your library now, for every project on this computer.`);
        }}
      />
      <div className="lvl-centre">
        {playing ? (
          <Suspense fallback={<div className="view-loading" role="status">Starting Play Mode…</div>}>
            <PlayMode
              key={playing.key}
              project={project}
              levelId={playing.levelId}
              global={global}
              start={playing.start}
              preset={(set.presets ?? []).find((p) => p.id === playing.presetId)}
              world={playing.world}
              perspective={playPerspective ?? set.settings.perspective ?? 'first'}
              onPerspective={setPlayPerspective}
              onCommit={onCommit}
              onExit={(near) => {
                setPlaying(null);
                if (near) setSelection([near]);
              }}
              onGoToLevel={(lid, world) => {
                const next = set.levels.find((l) => l.id === lid);
                if (!next) return;
                setLevelId(lid);
                setFloorId(next.floors[0]!.id);
                onSay(`On to ${next.name}.`);
                setPlaying({ levelId: lid, start: startPoint(project, lid, global), world, key: Date.now() });
              }}
            />
          </Suspense>
        ) : mode === '2d' ? (
          <LevelMap
            ref={map}
            project={project}
            levelId={level.id}
            floorId={floor.id}
            global={global}
            selection={selection}
            onSelect={setSelection}
            onCommit={onCommit}
            view={view}
            setView={setView}
            hidden={hidden}
            overlays={overlays}
            tool={tool}
            drawAsset={drawAsset}
            placing={pick?.sticky ? pick.assetId : null}
            onPlace={putDown}
            onOpen3D={open3D}
            onHover={setHover}
            issues={issueMap}
          />
        ) : (
          <Suspense fallback={<div className="view-loading" role="status">Opening the graybox…</div>}>
            <Graybox
              ref={box}
              project={project}
              levelId={level.id}
              floorId={floor.id}
              allFloors={view3d.allFloors}
              ceilings={view3d.ceilings}
              logic={view3d.logic}
              global={global}
              selection={selection}
              onSelect={setSelection}
              onCommit={onCommit}
              placing={pick?.sticky ? pick.assetId : null}
              onPlace={putDown}
              onHover={setHover}
              focus={focus3d}
            />
          </Suspense>
        )}
        <div className="lvl-status" aria-live="polite">
          <span className="mono">{hover ? `${formatLength(hover.x, set.settings.units)}, ${formatLength(hover.y, set.settings.units)}` : '—'}</span>
          {selected ? (
            <span>
              <strong>{selected.name}</strong> · <span className="mono">{exportNameOf(set, selected, global)}</span> · <span className="mono muted" title={selected.id}>{selected.id.slice(0, 8)}</span>
              {(() => {
                const f = frameOf(set, selected, global);
                return <span className="muted"> · {formatLength(f.w, set.settings.units)} × {formatLength(f.d, set.settings.units)} × {formatLength(f.h, set.settings.units)}</span>;
              })()}
            </span>
          ) : selection.length > 1 ? (
            <span>{selection.length} selected</span>
          ) : (
            <span className="muted">{mode === '2d' ? 'Drag empty ground to pan, Shift-drag to select an area, double-click to see it in 3D.' : 'Left-drag to orbit, right-drag to pan, wheel to zoom. Drag a selected item to move it.'}</span>
          )}
          <span className="grow" />
          {pick?.sticky && <span className="lvl-hint-on">Click where the {picked?.name ?? 'asset'} goes · Esc to cancel</span>}
        </div>
      </div>
      <LevelInspector
        project={project}
        levelId={level.id}
        floorId={floor.id}
        global={global}
        selection={selection}
        onCommit={onCommit}
        onSelect={setSelection}
        onFloor={(id) => {
          setFloorId(id);
          setSelection([]);
        }}
        onOpenStory={openStory}
        onDuplicate={duplicate}
        onDelete={() => remove()}
        onSaveToLibrary={save}
        issues={issues}
      />
      {pick && picked && (pick.moved || pick.sticky) && (
        <div className="drag-ghost" style={{ left: pick.clientX + 12, top: pick.clientY + 12 }} aria-hidden="true">
          <AssetIcon asset={picked} size={14} />
          {picked.name}
        </div>
      )}
    </div>
  );
};

export default LevelDesigner;
