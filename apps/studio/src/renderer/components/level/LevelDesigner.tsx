import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { assetOf, frameOf, type Point } from '../../model/level/geometry';
import { findAsset } from '../../model/level/library';
import {
  addFloor,
  addLevel,
  mapGrid,
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
import type { AssetCategory, AssetDefinition, Perspective, TravelKind } from '../../model/level/types';
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
import type { Axes, Tool3d } from './gizmo';
import { formatLength } from './units';
import { syncBuildings, opensAsMap, scaleOf, childOfItem, createWorld, duplicateMap, kindLabel, kindOf, mapsOwnedBy, openChildMap, pathTo, removalOfMap, removeMap, updateMap, addChildMap } from '../../model/level/hierarchy';
import { MapNavigator } from './MapNavigator';
import { removeTravel, travelById, TRAVEL_KINDS } from '../../model/level/travel';
import { NewWorldDialog } from './NewWorldDialog';

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
  const [routeKind, setRouteKind] = useState<TravelKind>('road');
  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  const focusRoomRef = useRef<string | null>(null);
  pickRef.current = pick;
  const [leftTab, setLeftTab] = useState<'library' | 'outliner'>('library');
  const [hidden, setHidden] = useState<ReadonlySet<AssetCategory>>(() => new Set());
  const [overlays, setOverlays] = useState({ story: true, dims: true, ghost: true });
  const [view3d, setView3d] = useState<{ ceilings: boolean; allFloors: boolean; logic: boolean; collision: boolean; walkable: boolean; tool: Tool3d; axes: Axes }>({
    ceilings: false,
    allFloors: false,
    logic: true,
    collision: false,
    walkable: false,
    tool: 'size',
    axes: 'world',
  });
  const [view, setView] = useState<View>({ zoom: 1, panX: 400, panY: 300 });
  const [hover, setHover] = useState<Point | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [focus3d, setFocus3d] = useState<string[] | undefined>(focusItem ? [focusItem.id] : undefined);
  const [playing, setPlaying] = useState<{ levelId: string; start: PlayStart; world?: PlayWorld; presetId?: string; key: number } | null>(null);
  const [playFrom, setPlayFrom] = useState<'start' | 'selection' | 'camera'>('start');
  const [playPreset, setPlayPreset] = useState('');
  const [playPerspective, setPlayPerspective] = useState<Perspective | null>(null);
  const [newWorld, setNewWorld] = useState(false);
  // A room being detailed (spec V2 §2, §7): the map frames it, the rest of the floor dims, the library offers room things.
  const [focusRoom, setFocusRoomState] = useState<string | null>(null);
  focusRoomRef.current = focusRoom;
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
    if (focusRoom && !set.items.some((i) => i.id === focusRoom && i.levelId === levelId && i.floorId === floorId)) setFocusRoomState(null);
    setSelection((s) => {
      const kept = s.filter((id) => set.items.some((i) => i.id === id) || (set.travel ?? []).some((t) => t.id === id));
      return kept.length === s.length ? s : kept;
    });
  }, [set, level, floorId, levelId, focusRoom]);

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

  const remove = (all: readonly string[] = selection) => {
    if (!all.length) return;
    const p0 = latest.current.project;
    // Routes in the selection go at once (spec V2 §13); then the items.
    const routeIds = all.filter((id) => travelById(levelsOf(p0), id));
    const ids = all.filter((id) => !routeIds.includes(id));
    if (routeIds.length) {
      onCommit(removeTravel(p0, routeIds));
      setSelection([]);
      if (!ids.length) {
        onSay(routeIds.length === 1 ? 'Deleted the route.' : `Deleted ${routeIds.length} routes.`);
        return;
      }
    }
    const p = routeIds.length ? removeTravel(p0, routeIds) : p0;
    const s = levelsOf(p);
    const also = removalOf(p, ids);
    const go = () => {
      onCommit(removeItems(p, ids));
      setSelection([]);
    };
    const names = ids.map((id) => s.items.find((i) => i.id === id)?.name).filter(Boolean);
    const owned = mapsOwnedBy(s, ids);
    if (owned.length) {
      onConfirm({
        title: names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${names.length} items?`,
        message: `${owned.length === 1 ? 'It opens into its own map, which stays' : 'They open into their own maps, which stay'}, no longer tied to a place here:`,
        details: [...owned.map((m) => `${m.name} (${kindLabel(kindOf(m))})`), ...also.map((i) => `${i.name} (${assetOf(s, i, global).name}), in its walls`)],
        confirmLabel: 'Delete',
        onConfirm: go,
      });
      return;
    }
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

  // ------------------------------------------------------------ maps (spec V2 §4–§6)

  /** A locked map's items stay as they are (spec V2 §6): a change to them is turned down, with why. */
  const commitItems = (next: Project) => {
    const before = levelsOf(latest.current.project);
    const after = levelsOf(next);
    const locked = before.levels.filter((l) => l.locked).map((l) => l.id);
    if (locked.length) {
      const mine = (s: typeof before, lid: string) => s.items.filter((i) => i.levelId === lid);
      const changed = locked.find((lid) => {
        const a = mine(before, lid);
        const b = mine(after, lid);
        return a.length !== b.length || a.some((x, n) => x !== b[n]);
      });
      if (changed && after.levels.find((l) => l.id === changed)?.locked) {
        onSay(`${before.levels.find((l) => l.id === changed)!.name} is locked: unlock it in the navigator or its Map section to change it.`);
        return;
      }
    }
    // A building and its mass stay in step (spec V2 §8).
    onCommit(syncBuildings(latest.current.project, next, global));
  };

  /** Detail one room (or stop, with null): it is framed, and the library turns to what goes in a room. */
  const setFocusRoom = (id: string | null) => {
    setFocusRoomState(id);
    if (!id) return;
    const room = levelsOf(latest.current.project).items.find((i) => i.id === id);
    if (!room) return;
    if (room.levelId !== latest.current.levelId) setLevelId(room.levelId);
    setFloorId(room.floorId);
    setSelection([id]);
    setTimeout(() => (mode === '3d' ? box.current : map.current)?.frame([id]), 0);
  };

  /** Open a map, at a floor, with an item selected (and in view). */
  const openMap = (lid: string, fid?: string, itemId?: string, within: Project = latest.current.project) => {
    const s = levelsOf(within);
    const next = s.levels.find((l) => l.id === lid);
    if (!next) return;
    setFocusRoomState(null);
    setLevelId(lid);
    setFloorId(fid ?? next.floors[0]?.id ?? '');
    setSelection(itemId ? [itemId] : []);
    setPick(null);
    setTimeout(() => (mode === '3d' ? box.current : map.current)?.frame(itemId ? [itemId] : undefined), 0);
  };

  /** Open an item as its own map (making it the first time). */
  const openChild = (itemId: string) => {
    const made = openChildMap(latest.current.project, itemId, undefined, global);
    if (!made.id) return;
    if (made.made) {
      onCommit(made.project);
      const m = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
      onSay(`${m.name} is its own ${kindLabel(kindOf(m)).toLowerCase()} map now, the size it is here. Alt+↑ goes back.`);
    }
    const next = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
    setLevelId(next.id);
    setFloorId(next.floors[0]!.id);
    setSelection([]);
    setMode('2d');
    setTimeout(() => map.current?.frame(), 0);
  };

  const backToParent = () => {
    // Out of a room first, then up a map.
    if (focusRoomRef.current) {
      setFocusRoomState(null);
      return;
    }
    const s = levelsOf(latest.current.project);
    const here = s.levels.find((l) => l.id === latest.current.levelId);
    const parent = here?.parentId ? s.levels.find((l) => l.id === here.parentId) : undefined;
    if (!parent || !here) return;
    // Back out onto the item it details, when it has one.
    openMap(parent.id, here.anchorId ? s.items.find((i) => i.id === here.anchorId)?.floorId : undefined, here.anchorId);
  };

  const deleteMap = (lid: string) => {
    const p = latest.current.project;
    const s = levelsOf(p);
    const { maps, items } = removalOfMap(s, lid);
    const target = maps[0];
    if (!target) return;
    const go = () => {
      const next = removeMap(p, lid);
      onCommit(next);
      if (maps.some((m) => m.id === latest.current.levelId)) {
        const rest = levelsOf(next).levels;
        const to = (target.parentId && rest.find((l) => l.id === target.parentId)) || rest[0];
        if (to) openMap(to.id);
      }
      onSay(`Deleted ${target.name}.`);
    };
    onConfirm({
      title: `Delete “${target.name}”?`,
      message: maps.length > 1 ? `The maps inside it go too, with everything on them (${items} items):` : `Everything on it goes too (${items} items).`,
      details: maps.slice(1).map((m) => `${m.name} (${kindLabel(kindOf(m))})`),
      confirmLabel: 'Delete',
      onConfirm: go,
    });
  };

  const duplicate = () => {
    if (!selection.length) return;
    const made = duplicateItems(project, withGroups(project, selection), { x: mapGrid(set, level?.id) * 2 || 1, y: mapGrid(set, level?.id) * 2 || 1 });
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
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        backToParent();
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
        const step = mapGrid(levelsOf(p), lid) * (e.shiftKey ? 4 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onCommit(moveItems(p, sel, dx, dy, global));
      } else if (!mod && key === 'f') {
        (mode === '3d' ? box.current : map.current)?.frame(sel.length ? sel : undefined);
      } else if (!mod && key === '2') setMode('2d');
      else if (!mod && key === '3') open3D();
      else if (!mod && key === 'd') setTool((t) => (t === 'draw' ? 'select' : 'draw'));
      else if (!mod && key === 'o') outlineTool();
      else if (!mod && key === 't') setTool((t) => (t === 'route' ? 'select' : 'route'));
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
        <button className="tb-btn" onClick={() => setNewWorld(true)}>
          + Start with a world
        </button>
        <p className="muted">A world holds regions and levels, and they hold towns, buildings and rooms: open each to work closer in.</p>
        {newWorld && (
          <NewWorldDialog
            units={set.settings.units}
            onClose={() => setNewWorld(false)}
            onCreate={(w) => {
              const made = createWorld(project, w);
              onCommit(made.project);
              setNewWorld(false);
              setLevelId(made.id);
              setFloorId(levelsOf(made.project).levels.find((l) => l.id === made.id)!.floors[0]!.id);
            }}
          />
        )}
      </div>
    );
  }

  const selected = selection.length === 1 ? set.items.find((i) => i.id === selection[0]) : undefined;
  const floors = [...level.floors].sort((a, b) => b.elevation - a.elevation);
  const picked = pick && findAsset(pick.assetId, set.assets, global);
  const crumbs = pathTo(set, level.id);
  const selectedRoom = selected && assetOf(set, selected, global).kind === 'space' ? selected : undefined;
  const focusedRoom = focusRoom ? set.items.find((i) => i.id === focusRoom) : undefined;

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
        <nav className="lvl-crumbs" aria-label="Where you are">
          {crumbs.map((l, n) => (
            <span key={l.id} className="lvl-crumb">
              {n > 0 && <span className="lvl-crumb-sep">›</span>}
              <button className={l.id === level.id ? 'on' : ''} aria-current={l.id === level.id ? 'location' : undefined} onClick={() => l.id !== level.id && openMap(l.id)} title={kindLabel(kindOf(l))}>
                {l.name}
              </button>
            </span>
          ))}
          {(level.floors.length > 1 || kindOf(level) === 'building' || kindOf(level) === 'interior') && (
            <span className="lvl-crumb">
              <span className="lvl-crumb-sep">›</span>
              <span className="muted">{floor.name}</span>
            </span>
          )}
          {focusedRoom ? (
            <span className="lvl-crumb">
              <span className="lvl-crumb-sep">›</span>
              <span className="lvl-crumb-room">
                {focusedRoom.name}
                <button className="icon-btn small" aria-label={`Leave ${focusedRoom.name}`} title="Back to the whole floor (Alt+↑)" onClick={() => setFocusRoomState(null)}>
                  ×
                </button>
              </span>
            </span>
          ) : (
            selectedRoom && (
              <span className="lvl-crumb">
                <span className="lvl-crumb-sep">›</span>
                <button onClick={() => setFocusRoom(selectedRoom.id)} title="Detail this room: the rest of the floor dims, the library offers what goes in a room">
                  {selectedRoom.name}
                </button>
              </span>
            )
          )}
          {(level.parentId || focusedRoom) && (
            <button className="icon-btn small lvl-crumb-up" aria-label={focusedRoom ? 'Back to the whole floor' : 'Back to the parent map'} title={`${focusedRoom ? 'Back to the whole floor' : 'Back to the parent map'} (Alt+↑)`} onClick={backToParent}>
              ↑
            </button>
          )}
        </nav>
        <select className="inp small lvl-pick" aria-label="Level" value={level.id} onChange={(e) => {
          if (e.target.value === '+world') {
            setNewWorld(true);
            return;
          }
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
              {'  '.repeat(Math.max(0, pathTo(set, l.id).length - 1))}
              {l.name}
            </option>
          ))}
          <option value="+">+ New level</option>
          <option value="+world">+ New world…</option>
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
              <button className={tool === 'route' ? 'on' : ''} aria-pressed={tool === 'route'} onClick={() => setTool((t) => (t === 'route' ? 'select' : 'route'))} title="Draw a road, river or route: click the places it joins and the points between; it ends on a place, or with Enter or a double-click (T)">
                Route
              </button>
              <button className={tool === 'outline' ? 'on' : ''} aria-pressed={tool === 'outline'} onClick={outlineTool} title="Click the corners of a space or volume of any shape; click the first corner, double-click or press Enter to close it (O)">
                Outline
              </button>
            </div>
            {tool === 'route' && (
              <select className="inp small lvl-pick" aria-label="Route kind" value={routeKind} onChange={(e) => setRouteKind(e.target.value as TravelKind)}>
                {TRAVEL_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
            {(tool === 'draw' || tool === 'outline') && (
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
            <div role="group" aria-label="3D handles" className="view-toggle">
              {([['move', 'Move', 'Arrows move the selection along an axis'], ['size', 'Size', 'Push or pull a face: a side, the top, or a wall of an outline'], ['pivot', 'Pivot', 'Drag the point it turns about and grows from']] as const).map(([id, label, title]) => (
                <button key={id} className={view3d.tool === id ? 'on' : ''} aria-pressed={view3d.tool === id} title={title} onClick={() => setView3d((o) => ({ ...o, tool: id }))}>
                  {label}
                </button>
              ))}
            </div>
            {view3d.tool === 'move' && (
              <select className="inp small lvl-pick" aria-label="Axes" value={view3d.axes} onChange={(e) => setView3d((o) => ({ ...o, axes: e.target.value as Axes }))}>
                <option value="world">World axes</option>
                <option value="local">Its own axes</option>
              </select>
            )}
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.ceilings} onChange={(e) => setView3d((o) => ({ ...o, ceilings: e.target.checked }))} /> Ceilings</label>
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.allFloors} onChange={(e) => setView3d((o) => ({ ...o, allFloors: e.target.checked }))} /> All floors</label>
            <label className="lvl-toggle"><input type="checkbox" checked={view3d.logic} onChange={(e) => setView3d((o) => ({ ...o, logic: e.target.checked }))} /> Logic volumes</label>
            <label className="lvl-toggle" title="What the player bumps into and stands on"><input type="checkbox" checked={view3d.collision} onChange={(e) => setView3d((o) => ({ ...o, collision: e.target.checked }))} /> Collision</label>
            <label className="lvl-toggle" title="Where the player can walk to from the player start (green), and where they can’t (amber). Doors and gates count as open."><input type="checkbox" checked={view3d.walkable} onChange={(e) => setView3d((o) => ({ ...o, walkable: e.target.checked }))} /> Walkable</label>
          </>
        )}
        <label className="lvl-toggle" title="Snap to the grid"><input type="checkbox" checked={set.settings.snap} onChange={(e) => onCommit({ ...project, levels: { ...set, settings: { ...set.settings, snap: e.target.checked } } })} /> Snap {formatLength(mapGrid(set, level.id), set.settings.units)}</label>
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
        navigator={
          <MapNavigator
            set={set}
            global={global}
            levelId={level.id}
            floorId={floor.id}
            selection={selection}
            onOpen={openMap}
            onFocusRoom={setFocusRoom}
            onLocate={(id) => {
              const item = set.items.find((i) => i.id === id);
              if (!item) return;
              if (item.floorId !== floor.id) setFloorId(item.floorId);
              setSelection([id]);
              setTimeout(() => (mode === '3d' ? box.current : map.current)?.frame([id]), 0);
            }}
            onNewWorld={() => setNewWorld(true)}
            onNewChild={(pid) => {
              const made = addChildMap(project, pid);
              onCommit(made.project);
              openMap(made.id, undefined, undefined, made.project);
            }}
            onToggle={(lid, what) => {
              const l = set.levels.find((x) => x.id === lid);
              if (l) onCommit(updateMap(project, lid, { [what]: l[what] ? undefined : true }));
            }}
            onRename={(lid, name) => onCommit(updateMap(project, lid, { name }))}
            onDuplicate={(lid) => {
              const made = duplicateMap(project, lid);
              if (made.id) onCommit(made.project);
            }}
            onDelete={deleteMap}
          />
        }
        set={set}
        scale={focusRoom ? 'room' : scaleOf(kindOf(level))}
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
            onCommit={commitItems}
            view={view}
            setView={setView}
            hidden={hidden}
            overlays={overlays}
            tool={tool}
            drawAsset={drawAsset}
            routeKind={routeKind}
            focusRoom={focusRoom}
            placing={pick?.sticky ? pick.assetId : null}
            onPlace={putDown}
            onOpen3D={(id) => (id && (childOfItem(set, id) || opensAsMap(set, id, global)) ? openChild(id) : open3D(id))}
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
              tool={view3d.tool}
              axes={view3d.axes}
              collision={view3d.collision}
              walkable={view3d.walkable}
              global={global}
              selection={selection}
              onSelect={setSelection}
              onCommit={commitItems}
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
        onCommit={commitItems}
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
        onOpenMap={(lid) => openMap(lid)}
        onOpenChild={openChild}
        onFocusRoom={setFocusRoom}
        focusRoom={focusRoom}
      />
      {newWorld && (
        <NewWorldDialog
          units={set.settings.units}
          onClose={() => setNewWorld(false)}
          onCreate={(w) => {
            const made = createWorld(project, w);
            onCommit(made.project);
            setNewWorld(false);
            openMap(made.id, undefined, undefined, made.project);
          }}
        />
      )}
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
