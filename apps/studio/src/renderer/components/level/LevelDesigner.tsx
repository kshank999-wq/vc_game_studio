import { elementsOf, itemsFor } from '../../model/puzzle/elements';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import type { AssetCategory, AssetDefinition, LayoutRules, Perspective, TravelKind } from '../../model/level/types';
import { levelIssues } from '../../model/level/validate';
import { pointNear, startPoint } from '../../model/level/play';
import type { PlayWorld } from '../../model/play';
import type { PlayStart } from './PlayMode';
import type { Destination } from '../../model/details';
import type { Project } from '../../model/types';
import type { View } from '../../view';
import type { ConfirmRequest } from '../canvas/StoryCanvas';
import { puzzleOverlay, puzzlesOf, puzzlesOnMap } from '../../model/level/puzzles';
import { forgetAsset, promoteAsset, useGlobalAssets } from './global-library';
import type { GrayboxApi } from './Graybox';
import { ASSET_DRAG, AssetIcon, LevelLibrary } from './LevelLibrary';
import { LevelInspector } from './LevelInspector';
import { LevelMap, type MapApi, type MapTool } from './LevelMap';
import type { Axes, Tool3d } from './gizmo';
import { formatLength } from './units';
import { HallwayDialog } from './HallwayDialog';
import { boxOf, edgeLines, snapBox, snapsByEdge } from '../../model/level/edges';
import { syncBuildings, opensAsMap, scaleOf, childOfItem, createWorld, duplicateMap, kindLabel, kindOf, mapsOwnedBy, openChildMap, pathTo, removalOfMap, removeMap, updateMap, addChildMap } from '../../model/level/hierarchy';
import { MapNavigator } from './MapNavigator';
import { removeTravel, travelById, TRAVEL_KINDS } from '../../model/level/travel';
import { NewWorldDialog } from './NewWorldDialog';
import { NewStructureDialog } from './NewStructureDialog';
import { StructurePanel } from './StructurePanel';
import type { FloorStack } from '../../model/level/stack';
import { GeneratePanel, type GenerateAsk } from './GeneratePanel';
import { acceptLayout, defaultGenerator, entranceAt, groundFloorOf, guidedOrder, laidOut, proposeDressing, proposeLayout, stairsAt, type Proposal } from '../../model/level/generate';
import { importPlan } from '../../model/level/cad';
import { ImportPlanDialog } from './ImportPlanDialog';
import { PREFAB_DRAG, PrefabsPanel } from './PrefabsPanel';
import { TeamDialog } from './TeamDialog';
import { PopOut } from '../PopOut';
import { desktop } from '../../desktop';
import { claim as claimLevel, handOut, release as releaseLevel, sendBackName, workingCopyOf } from '../../model/level/coop';
import { makePrefab, makeStructurePrefab, placePrefab, prefabsOf, prefabText, removePrefab, savePrefab, starterPrefabs, type Prefab } from '../../model/level/prefabs';
import { downloadText, fileNameFor, serialize } from '../../files';
import { getPreferences } from '../../preferences';
import { createStructure, floorCodes, isStructure, updateStructure } from '../../model/level/structure';

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


/** The Levels panels that can go into windows of their own. */
type PanelKey = 'library' | 'inspector' | 'graph' | 'generate' | 'prefabs' | 'view';
/** How wide the Hallway tool draws, kept on this computer. */
const HALL_KEY = 'vcgs.hallway.width';
/** Whether the library is locked out beside the map, kept on this computer. */
const LIB_PIN_KEY = 'vcgs.levels.libraryPinned';

const PinIcon = ({ on }: { on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z" fill={on ? 'currentColor' : 'none'} />
    <path d="M8 8.5V14" />
  </svg>
);
const PANEL_KEYS: readonly PanelKey[] = ['view', 'library', 'inspector', 'graph', 'generate', 'prefabs'];
const PANEL_NAMES: Record<PanelKey, string> = { view: 'the map', library: 'the library', inspector: 'the properties', graph: 'the structure graph', generate: 'the generator', prefabs: 'prefabs' };

/**
 * Which panels were in windows of their own when the studio was last closed,
 * for each project (by its id), kept on this computer: each project opens with
 * the windows it had.
 */
const OUTS_KEY = 'vcgs.levels.popouts';
const readAllOuts = (): Record<string, PanelKey[]> => {
  try {
    const v = JSON.parse(localStorage.getItem(OUTS_KEY) ?? '{}') as unknown;
    // Before it was kept per project it was one list: it stands for whichever project opens next.
    if (Array.isArray(v)) return { '*': PANEL_KEYS.filter((k) => v.includes(k)) };
    return v && typeof v === 'object' ? (v as Record<string, PanelKey[]>) : {};
  } catch {
    return {};
  }
};
const readOuts = (projectId: string): PanelKey[] => {
  const all = readAllOuts();
  const v = all[projectId] ?? all['*'] ?? [];
  return Array.isArray(v) ? PANEL_KEYS.filter((k) => v.includes(k)) : [];
};
const writeOuts = (projectId: string, keys: Iterable<PanelKey>) => {
  try {
    const all = readAllOuts();
    delete all['*'];
    const list = [...keys];
    if (list.length) all[projectId] = list;
    else delete all[projectId];
    localStorage.setItem(OUTS_KEY, JSON.stringify(all));
  } catch {
    // Storage off: they don't come back next time.
  }
};
/** Set while the studio closes: its windows close with it, and that isn't putting them back. */
let closingApp = false;
globalThis.addEventListener?.('pagehide', () => {
  closingApp = true;
});
globalThis.addEventListener?.('beforeunload', () => {
  closingApp = true;
});

/**
 * The Level Designer (docs/specs/level-designer-spec.md): library on the
 * left, the 2D map or 3D graybox in the middle, the inspector on the right.
 * Both views and the inspector edit the same items.
 */
export const LevelDesigner = ({ project, onCommit, onNavigate, onOpenBible, onSay, onConfirm: confirmHere, focus, mode: initialMode = '2d', onMode }: Props) => {
  // A question asked while working in a window of its own (on another screen): this window comes forward to ask it.
  const onConfirm = (request: ConfirmRequest) => {
    if (outsRef.current.size) window.focus();
    confirmHere(request);
  };
  const outsRef = useRef<ReadonlySet<string>>(new Set());
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
  // The Hallway tool: how wide (asked when it is picked, remembered), and what was just drawn (to fill round).
  const [hallWidth, setHallWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem(HALL_KEY));
      return n > 0 ? n : 2.4384;
    } catch {
      return 2.4384;
    }
  });
  const [askHall, setAskHall] = useState(false);
  const [hallDrawn, setHallDrawn] = useState(false);
  const [genStart, setGenStart] = useState<{ n: number; rules: LayoutRules } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  const focusRoomRef = useRef<string | null>(null);
  pickRef.current = pick;
  // The library: a flyout from the maps panel's right edge, open while picking, or locked out beside the map.
  const [libPinned, setLibPinned] = useState(() => {
    try {
      return localStorage.getItem(LIB_PIN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [libOpen, setLibOpen] = useState(false);
  const [libGhost, setLibGhost] = useState(false);
  const pinLib = (on: boolean) => {
    setLibPinned(on);
    if (on) setLibOpen(true);
    try {
      localStorage.setItem(LIB_PIN_KEY, on ? '1' : '0');
    } catch {
      // It opens unlocked next time.
    }
  };
  const [hidden, setHidden] = useState<ReadonlySet<AssetCategory>>(() => new Set());
  const [overlays, setOverlays] = useState({ story: true, dims: true, ghost: true, puzzles: false, cast: false });
  // The puzzle shown on the map (spec V2 §14): one, or every puzzle with a part here ('').
  const [puzzleFocus, setPuzzleFocus] = useState('');
  const [view3d, setView3d] = useState<{ ceilings: boolean; allFloors: boolean; stack: FloorStack; connections: boolean; logic: boolean; collision: boolean; walkable: boolean; tool: Tool3d; axes: Axes }>({
    ceilings: false,
    allFloors: false,
    stack: 'all',
    connections: false,
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
  const [newStructure, setNewStructure] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showPrefabs, setShowPrefabs] = useState(() => (desktop() ? readOuts(project.id).includes('prefabs') : false));
  const [showTeam, setShowTeam] = useState(false);
  /** Panels pulled out into windows of their own. */
  // The desktop app opens again the windows that were open; a browser only opens one on a click, so it asks.
  const [outs, setOuts] = useState<ReadonlySet<PanelKey>>(() => new Set(desktop() ? readOuts(project.id) : []));
  const [reopen, setReopen] = useState<PanelKey[] | null>(() => (desktop() ? null : readOuts(project.id).length ? readOuts(project.id) : null));
  outsRef.current = outs;
  /** The project the panels out now belong to. */
  const outsOf = useRef(project.id);
  useEffect(() => {
    // Another project opened: its own windows, not this one's.
    if (outsOf.current === project.id) return;
    outsOf.current = project.id;
    const saved = readOuts(project.id);
    if (desktop()) {
      if (saved.includes('generate')) setShowGenerate(true);
      if (saved.includes('prefabs')) setShowPrefabs(true);
      if (saved.includes('graph')) setShowStructure(true);
      setOuts(new Set(saved));
      setReopen(null);
    } else {
      setOuts(new Set());
      setReopen(saved.length ? saved : null);
    }
  }, [project.id]);
  useEffect(() => {
    // Remembered as they come and go; not while the studio itself is closing, nor before the browser's offer is answered.
    if (closingApp || reopen) return;
    writeOuts(outsOf.current, outs);
  }, [outs, reopen]);
  const popOut = (k: PanelKey) => setOuts((o) => new Set(o).add(k));
  /** The window the map or graybox is in, when it is in one of its own. */
  const [viewWin, setViewWin] = useState<Window | null>(null);
  /** The middle of the view on screen, wherever the view is. */
  const viewCentre = () => {
    const doc = outs.has('view') && viewWin ? viewWin.document : document;
    const r = doc.querySelector('.lvl-view')?.getBoundingClientRect() ?? doc.querySelector('.lvl-centre')?.getBoundingClientRect();
    return (r && (mode === '3d' ? box.current : map.current)?.worldAt(r.left + r.width / 2, r.top + r.height / 2)) || (r && map.current?.worldAt(r.left + r.width / 2, r.top + r.height / 2)) || { x: 0, y: 0 };
  };
  const dockBack = (k: PanelKey) =>
    setOuts((o) => {
      const n = new Set(o);
      n.delete(k);
      return n;
    });
  const [showStructure, setShowStructure] = useState(true);
  // A panel that was in a window of its own last time is open again (in its window).
  const [showGenerate, setShowGenerate] = useState(() => (desktop() ? readOuts(project.id).includes('generate') : false));
  const [preview, setPreview] = useState<Proposal | null>(null);
  /** Floor by floor: the point the generator is asking for, if any. */
  const [asking, setAsking] = useState<'entrance' | 'stairs' | null>(null);
  // A preview is of the project as it was: an undo, an edit elsewhere or another map drops it.
  useEffect(() => setPreview(null), [project, levelId]);
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
  // Puzzles with a part on this map, and the ones the overlay shows.
  const onMap = useMemo(() => (level ? puzzlesOnMap(project, level.id, global) : []), [project, level, global]);
  // Every item that is part of a puzzle, or stands for one of its elements, carries a badge (puzzle spec §12).
  const badges = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (id: string, name: string) => m.set(id, [...new Set([...(m.get(id) ?? []), name])]);
    for (const o of onMap) for (const part of o.parts) if (part.itemId) add(part.itemId, o.puzzle.name);
    for (const pz of Object.values(project.objects)) {
      if (pz.type !== 'puzzle') continue;
      for (const e of elementsOf(project, pz.id)) for (const i of itemsFor(project, e.id)) if (i.levelId === level?.id) add(i.id, pz.name);
    }
    return m;
  }, [onMap, project, level]);
  const shownPuzzles = useMemo(() => {
    if (!puzzleFocus) return onMap;
    const one = level && puzzleOverlay(project, puzzleFocus, level.id, global);
    return one ? [one] : [];
  }, [onMap, puzzleFocus, project, level, global]);
  const showPuzzle = (id: string) => {
    setPuzzleFocus(id);
    setOverlays((o) => ({ ...o, puzzles: true }));
    setMode('2d');
  };
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
    let placed = placeAsset(withAsset(p, assetId), lid, fid, assetId, at, { global });
    if (!placed.ids.length) return;
    // Put down beside a room, a hallway or a building: flush against it.
    const s1 = levelsOf(placed.project);
    const made = s1.items.find((i) => i.id === placed.ids[0]);
    const tol = map.current?.snapTolerance() ?? 0;
    if (made && placed.ids.length === 1 && tol > 0 && snapsByEdge(s1, made, global)) {
      const sn = snapBox(boxOf(s1, made, global), edgeLines(s1, lid, fid, placed.ids, global), tol);
      if (sn.dx || sn.dy) placed = { ...placed, project: moveItems(placed.project, placed.ids, sn.dx, sn.dy, global, true) };
    }
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
    // The browser took the drag over (a drag that can cross windows): the drop places it, not this.
    const cancel = () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!pickRef.current?.sticky) setPick(null);
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
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
    window.addEventListener('pointercancel', cancel);
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
    setLibOpen(true);
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

  /** Rooms round the hallways drawn on this floor: a preview from the generator's "Around the hallways" rules. */
  const fillRound = () => {
    setHallDrawn(false);
    if (!level || !floor) return;
    setTool('select');
    const last = level.generation?.[level.generation.length - 1];
    const settings = { ...defaultGenerator(level.structure?.type), ...(last?.settings ?? {}), rules: 'hallways' as const, mode: 'plan' as const };
    setGenStart((g) => ({ n: (g?.n ?? 0) + 1, rules: 'hallways' }));
    setShowGenerate(true);
    const seed = Math.floor(Math.random() * 1e6) + 1;
    setPreview(proposeLayout(project, { levelId: level.id, floorIds: [floor.id], seed, settings, ...(level.floors.length > 1 && !level.structure?.stairs ? { noCore: true } : {}) }, global));
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
        if (libOpen && !libPinned) setLibOpen(false);
        else if (pickRef.current) setPick(null);
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
      else if (!mod && key === 'l') {
        if (libPinned || libOpen) {
          pinLib(false);
          setLibOpen(false);
        } else setLibOpen(true);
      } else if (!mod && key === 'h') {
        if (tool === 'hallway') setTool('select');
        else setAskHall(true);
      }
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
  // A generated layout being previewed (structure spec §6) is shown in place of the project until it is accepted or rejected.
  const shown = preview?.project ?? project;
  const shownSet = levelsOf(shown);
  const held = () => onSay('Accept or reject the generated layout first.');
  const picked = pick && findAsset(pick.assetId, set.assets, global);
  /** A panel in the main window, or in a window of its own (to put on another screen). */
  const dock = (key: PanelKey, title: string, render: (pop?: () => void) => ReactNode): ReactNode => {
    if (outs.has(key))
      return (
        <PopOut key={`pop-${key}`} id={key} title={title} width={key === 'library' || key === 'inspector' ? 380 : 980} height={key === 'library' || key === 'inspector' ? 860 : 560} className="lvl lvl-popout" onClose={() => dockBack(key)} onBlocked={() => onSay('The new window was blocked: allow pop-ups for the studio, then try again.')}>
          <div className="popout-bar">
            <strong>{title}</strong>
            <span className="muted">{level.name}</span>
            <span className="grow" />
            <button className="tb-btn small" onClick={() => dockBack(key)}>
              Put it back
            </button>
          </div>
          {render()}
        </PopOut>
      );
    if (key === 'library' || key === 'inspector')
      return (
        <>
          {render()}
          {!playing && (
            <button className={`icon-btn small lvl-popbtn lvl-popbtn-${key}`} aria-label={`Open the ${title.toLowerCase()} in its own window`} title="Open in its own window, to put on another screen" onClick={() => popOut(key)}>
              ⧉
            </button>
          )}
        </>
      );
    return render(() => popOut(key));
  };
  /** The library (a flyout, or a window of its own) and the maps-and-outliner panel: one component, two parts. */
  const libraryPart = (part: 'library' | 'outliner', head?: ReactNode) => (
    <LevelLibrary
        part={part}
        {...(head ? { head } : {})}
        navigator={part === 'library' ? undefined : (
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
        )}
        set={set}
        scale={focusRoom ? 'room' : scaleOf(kindOf(level))}
        levelId={level.id}
        floorId={floor.id}
        global={global}
        active={pick?.assetId ?? null}
        onPick={(id, e) => {
          onPickAsset(id, e);
          // Picked from the flyout: it slides back in once the press is over, out of the map's way.
          if (part === 'library' && !libPinned && !outs.has('library')) (e.currentTarget.ownerDocument.defaultView ?? window).addEventListener('pointerup', () => setLibOpen(false), { once: true });
        }}
        onDragStart={() => {
          setPick(null);
          // Dragged from the flyout: it fades while the drag goes on (taken away, the drag would stop), then slides in.
          if (part === 'library' && !libPinned && !outs.has('library')) {
            setLibGhost(true);
            window.addEventListener('dragend', () => {
              setLibGhost(false);
              setLibOpen(false);
            }, { once: true });
          }
        }}
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
        onSay={onSay}
        onPromote={(a) => {
          promoteAsset(a);
          onSay(`${a.name} is in your library now, for every project on this computer.`);
        }}
      />
  );
  const libHead = (
    <div className="lvl-fly-head">
      <strong>Library</strong>
      <span className="grow" />
      <button className={`icon-btn small lvl-pin${libPinned ? ' on' : ''}`} aria-pressed={libPinned} aria-label={libPinned ? 'Let the library slide back in' : 'Keep the library out'} title={libPinned ? 'Unlock: it slides back in after you pick something' : 'Lock it out: it stays open beside the map'} onClick={() => pinLib(!libPinned)}>
        <PinIcon on={libPinned} />
      </button>
      <button className="icon-btn small" aria-label="Open the library in its own window" title="Open in its own window, to put on another screen" onClick={() => popOut('library')}>
        ⧉
      </button>
      <button className="icon-btn small" aria-label="Close the library" title="Slide it back in (L)" onClick={() => {
        pinLib(false);
        setLibOpen(false);
      }}>
        ×
      </button>
    </div>
  );
  const placePrefabAt = (prefab: Prefab, at: Point) => {
    const out = placePrefab(project, level.id, floor.id, prefab, at, global);
    if (!out.ids.length) {
      onSay(out.problems[0] ?? `Nothing of ${prefab.name} could go here.`);
      return;
    }
    onCommit(out.project);
    setSelection(out.ids);
    const brought = [out.added.objects ? `${out.added.objects} story ${out.added.objects === 1 ? 'object' : 'objects'}` : '', out.added.assets ? `${out.added.assets} ${out.added.assets === 1 ? 'asset' : 'assets'}` : ''].filter(Boolean).join(' and ');
    onSay(`${prefab.name} placed: ${out.ids.length} pieces${brought ? `, bringing ${brought}` : ''}.${out.problems.length ? ` ${out.problems.join(' ')}` : ''}`);
  };
  /** Something dragged in, from this window or another (another screen): a library asset or a prefab. */
  const dragKind = (e: React.DragEvent) => (e.dataTransfer.types.includes(ASSET_DRAG) ? 'asset' : e.dataTransfer.types.includes(PREFAB_DRAG) ? 'prefab' : null);
  const onViewDragOver = (e: React.DragEvent) => {
    if (playing || !dragKind(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onViewDrop = (e: React.DragEvent) => {
    const kind = dragKind(e);
    if (playing || !kind) return;
    e.preventDefault();
    const at = (mode === '3d' ? box.current : map.current)?.worldAt(e.clientX, e.clientY);
    if (!at) return;
    if (kind === 'asset') {
      setPick(null);
      place(e.dataTransfer.getData(ASSET_DRAG), at);
      return;
    }
    const id = e.dataTransfer.getData(PREFAB_DRAG);
    const prefab = [...prefabsOf(project), ...starterPrefabs()].find((x) => x.id === id);
    if (prefab) placePrefabAt(prefab, at);
  };
  /** The map or graybox (or Play Mode), here or in a window of its own. */
  const dockView = (node: ReactNode): ReactNode => {
    if (!outs.has('view'))
      return (
        <>
          {node}
          <button className="icon-btn small lvl-popbtn-view" aria-label="Open the map in its own window" title="Open the 2D map / 3D graybox in its own window, to put on another screen" onClick={() => popOut('view')}>
            ⧉
          </button>
        </>
      );
    return (
      <>
        <div className="lvl-view-out" role="note">
          <p>
            <strong>{playing ? 'Play Mode' : mode === '3d' ? 'The 3D graybox' : 'The 2D map'}</strong> is in its own window.
          </p>
          <button className="tb-btn small" onClick={() => viewWin?.focus()}>
            Show it
          </button>
          <button className="tb-btn small" onClick={() => dockBack('view')}>
            Put it back here
          </button>
        </div>
        <PopOut key="pop-view" id="view" title={`${level.name} — ${floor.name}`} width={1280} height={820} className="lvl lvl-popout" onWindow={setViewWin} onClose={() => dockBack('view')} onBlocked={() => onSay('The new window was blocked: allow pop-ups for the studio, then try again.')}>
          <div className="popout-bar">
            <strong>{level.name}</strong>
            <span className="muted">{floor.name}</span>
            {!playing && (
              <div role="group" aria-label="View" className="view-toggle">
                <button className={mode === '2d' ? 'on' : ''} aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>
                  2D map
                </button>
                <button className={mode === '3d' ? 'on' : ''} aria-pressed={mode === '3d'} onClick={() => open3D()}>
                  3D graybox
                </button>
              </div>
            )}
            {!playing && (
              <button className="tb-btn small" onClick={() => (mode === '3d' ? box.current : map.current)?.frame(selection.length ? selection : undefined)}>
                Frame
              </button>
            )}
            <span className="grow" />
            <button className="tb-btn small" onClick={() => dockBack('view')}>
              Put it back
            </button>
          </div>
          <div className="lvl-centre lvl-centre-out">{node}</div>
        </PopOut>
      </>
    );
  };
  const crumbs = pathTo(set, level.id);
  const codes = floorCodes(level);
  const selectedRoom = selected && assetOf(set, selected, global).kind === 'space' ? selected : undefined;
  const focusedRoom = focusRoom ? set.items.find((i) => i.id === focusRoom) : undefined;

  return (
    <div className={`lvl${pick ? ' is-placing' : ''}${playing ? ' playing' : ''}${libPinned && !outs.has('library') && !playing ? ' lib-pinned' : ''}${outs.has('inspector') ? ' right-out' : ''}`}>
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
              {level.structure ? `${codes.get(f.id)} · ` : ''}
              {f.name} · {formatLength(f.elevation, set.settings.units)}
            </option>
          ))}
          <option value="+">+ Floor above</option>
        </select>
        {kindOf(level) !== 'world' && kindOf(level) !== 'region' && (
          <button className="tb-btn small" onClick={() => setNewStructure(true)} title="Add a pyramid, temple, fortress, office, bunker or dungeon here: a mini-level with its own floors (structure spec)">
            + Structure
          </button>
        )}
        {isStructure(level) && (
          <button className={`tb-btn small${showStructure ? ' on' : ''}`} aria-pressed={showStructure} onClick={() => setShowStructure((v) => !v)} title="The structure graph: rooms on every floor, and how they connect">
            Structure graph
          </button>
        )}
        {isStructure(level) && (
          <button className={`tb-btn small${showGenerate ? ' on' : ''}`} aria-pressed={showGenerate} onClick={() => setShowGenerate((v) => !v)} title="Generate a layout from a seed: plan-first or along a route you draw (structure spec §6)">
            Generate
          </button>
        )}
        <button className={`tb-btn small${showPrefabs ? ' on' : ''}`} aria-pressed={showPrefabs} onClick={() => setShowPrefabs((v) => !v)} title="Prefabs: save pieces of a level to place again, here or in another project, and open prefab catalogs (structure spec V2)">
          Prefabs
        </button>
        {isStructure(level) && (
          <button className="tb-btn small" onClick={() => setShowTeam(true)} title="Work on this structure together: claim it, hand out a working copy, merge one back (structure spec V2)">
            Team
          </button>
        )}
        {level.claim && (
          <span className="lvl-claim" role="note" title={`Claimed ${new Date(level.claim.at).toLocaleString()}`}>
            {level.claim.by} is working on this
          </span>
        )}
        {workingCopyOf(project)?.levelId === level.id && (
          <span className="lvl-claim" role="note">
            Working copy from {workingCopyOf(project)!.by}
          </span>
        )}
        {isStructure(level) && (
          <button className="tb-btn small" onClick={() => setImporting(true)} title="Import a floor plan from CAD (DXF or SVG) onto this floor: rooms, doors, stairs and the footprint (structure spec V2)">
            Import plan
          </button>
        )}
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
              <button className={tool === 'hallway' ? 'on' : ''} aria-pressed={tool === 'hallway'} onClick={() => (tool === 'hallway' ? setTool('select') : setAskHall(true))} title="Draw a hallway: give its width, then click along where it runs; Enter or a double-click finishes it. Then fill the floor with rooms round it (H)">
                Hallway
              </button>
            </div>
            {tool === 'hallway' && (
              <button className="tb-btn small lvl-hall-width" onClick={() => setAskHall(true)} title="Change how wide the hallway is">
                {formatLength(hallWidth, set.settings.units)} wide
              </button>
            )}
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
            <label className="lvl-toggle" title="How AI enemies see and hear: vision cones, proximity and hearing rings (always shown for what is selected)"><input type="checkbox" checked={overlays.cast} onChange={(e) => setOverlays((o) => ({ ...o, cast: e.target.checked }))} /> Senses</label>
            <label className="lvl-toggle" title="Where each puzzle’s parts are: entry, required objects, clues, gates and outputs"><input type="checkbox" checked={overlays.puzzles} onChange={(e) => setOverlays((o) => ({ ...o, puzzles: e.target.checked }))} /> Puzzles</label>
            {overlays.puzzles && (
              <select className="inp small lvl-puzzle-pick" aria-label="Puzzle shown" value={puzzleFocus} onChange={(e) => setPuzzleFocus(e.target.value)}>
                <option value="">Every puzzle here ({onMap.length})</option>
                {puzzlesOf(project).map((pz) => (
                  <option key={pz.id} value={pz.id}>
                    {pz.name}
                    {onMap.some((o) => o.puzzle.id === pz.id) ? '' : ' (nothing here yet)'}
                  </option>
                ))}
              </select>
            )}
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
            <select
              className="inp small lvl-pick"
              aria-label="Floors in 3D"
              title="Which floors the graybox shows: this one, all of them, a cutaway down to this floor, or the floors spread apart"
              value={view3d.allFloors ? view3d.stack : 'one'}
              onChange={(e) => {
                const v = e.target.value;
                setView3d((o) => (v === 'one' ? { ...o, allFloors: false } : { ...o, allFloors: true, stack: v as FloorStack }));
              }}
            >
              <option value="one">This floor</option>
              <option value="all">All floors</option>
              <option value="cutaway">Cutaway to this floor</option>
              <option value="exploded">Floors spread apart</option>
            </select>
            {isStructure(level) && (
              <label className="lvl-toggle" title="The structure graph in 3D: the ways between rooms"><input type="checkbox" checked={view3d.connections} onChange={(e) => setView3d((o) => ({ ...o, connections: e.target.checked }))} /> Connections</label>
            )}
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
      {libraryPart('outliner')}
      {outs.has('library') && dock('library', 'Library', () => libraryPart('library'))}
      <div className="lvl-centre">
        {!playing && !outs.has('library') && (libOpen || libPinned ? (
          <div className={`lvl-fly${libPinned ? ' pinned' : ''}${libGhost ? ' ghost' : ''}`}>{libraryPart('library', libHead)}</div>
        ) : (
          <button className="lvl-fly-tab" aria-label="Open the library" title="The library: what to put on the map (L)" onClick={() => setLibOpen(true)}>
            Library
          </button>
        ))}
        {reopen && (
          <div className="lvl-reopen" role="note" aria-label="Windows from last time">
            <span>
              Last time {reopen.length === 1 ? 'this was' : 'these were'} in {reopen.length === 1 ? 'a window' : 'windows'} of {reopen.length === 1 ? 'its' : 'their'} own: {reopen.map((k) => PANEL_NAMES[k]).join(', ')}.
            </span>
            <button
              className="tb-btn small primary"
              onClick={() => {
                if (reopen.includes('generate')) setShowGenerate(true);
                if (reopen.includes('prefabs')) setShowPrefabs(true);
                if (reopen.includes('graph')) setShowStructure(true);
                setOuts(new Set(reopen));
                setReopen(null);
              }}
            >
              Open {reopen.length === 1 ? 'it' : 'them'} again
            </button>
            <button className="tb-btn small" onClick={() => setReopen(null)}>
              Keep them here
            </button>
          </div>
        )}
        {dockView(
          <div className="lvl-view" onDragOver={onViewDragOver} onDrop={onViewDrop} onPointerDownCapture={() => libOpen && !libPinned && setLibOpen(false)}>
        {hallDrawn && !preview && isStructure(level) && mode === '2d' && (
          <div className="lvl-reopen lvl-hall-fill" role="note" aria-label="Hallway drawn">
            <span>Hallway drawn. Draw more, or fill {floor.name} with rooms round the hallways.</span>
            <button className="tb-btn small primary" onClick={fillRound}>
              Fill with rooms
            </button>
            <button className="tb-btn small" onClick={() => setHallDrawn(false)}>
              Not now
            </button>
          </div>
        )}
        {asking && mode === '2d' && (
          <div
            className="lvl-ask"
            role="button"
            tabIndex={0}
            aria-label={asking === 'entrance' ? 'Click on the outside wall where the entrance goes' : 'Click where the stairs go up'}
            onKeyDown={(e) => e.key === 'Escape' && setAsking(null)}
            onClick={(e) => {
              const pt = map.current?.worldAt(e.clientX, e.clientY);
              if (!pt) return;
              if (asking === 'entrance') {
                const q = entranceAt(project, level.id, pt, global);
                if (!q) {
                  onSay('Click on the outside wall of the ground floor (its footprint’s edge).');
                  return;
                }
                onCommit(updateStructure(project, level.id, { entrance: q }));
                setAsking(null);
                onSay(`The way in is set. Now generate ${groundFloorOf(level)?.name ?? 'the ground floor'}.`);
              } else {
                const q = stairsAt(project, level.id, pt, global);
                if (!q) {
                  onSay('Click inside the footprint, where the stairs go up.');
                  return;
                }
                onCommit(updateStructure(project, level.id, { stairs: q }));
                setAsking(null);
                const nextFloor = guidedOrder(level).find((f) => !laidOut(set, level.id, f.id, global));
                onSay(`The stairs are set: they stand there on every floor.${nextFloor ? ` Now generate ${nextFloor.name}.` : ''}`);
              }
            }}
          >
            <span className="lvl-ask-hint">{asking === 'entrance' ? 'Click on the outside wall where the entrance goes · Esc to cancel' : 'Click where the stairs go up to the next floor · Esc to cancel'}</span>
          </div>
        )}
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
              onGoToLevel={(lid, world, arrival) => {
                const next = set.levels.find((l) => l.id === lid);
                if (!next) return;
                setLevelId(lid);
                setFloorId(arrival?.floorId && next.floors.some((f) => f.id === arrival.floorId) ? arrival.floorId : next.floors[0]!.id);
                onSay(`On to ${next.name}.`);
                setPlaying({ levelId: lid, start: arrival ?? startPoint(project, lid, global), world, key: Date.now() });
              }}
            />
          </Suspense>
        ) : mode === '2d' ? (
          <LevelMap
            ref={map}
            project={shown}
            levelId={level.id}
            floorId={floor.id}
            global={global}
            selection={preview ? preview.made : selection}
            onSelect={preview ? () => {} : setSelection}
            onCommit={preview ? held : commitItems}
            view={view}
            setView={setView}
            hidden={hidden}
            overlays={overlays}
            tool={tool}
            drawAsset={drawAsset}
            routeKind={routeKind}
            hallWidth={hallWidth}
            onHallway={() => {
              if (isStructure(level)) setHallDrawn(true);
            }}
            focusRoom={focusRoom}
            placing={pick?.sticky ? pick.assetId : null}
            onPlace={putDown}
            onOpen3D={(id) => (id && (childOfItem(set, id) || opensAsMap(set, id, global)) ? openChild(id) : open3D(id))}
            onHover={setHover}
            puzzles={overlays.puzzles ? shownPuzzles : undefined}
            markers={showGenerate && isStructure(level) ? [...(level.structure?.entrance && floor.id === groundFloorOf(level)?.id ? [{ ...level.structure.entrance, label: 'Way in' }] : []), ...(level.structure?.stairs ? [{ ...level.structure.stairs, label: 'Stairs' }] : [])] : undefined}
            badges={badges}
            issues={issueMap}
          />
        ) : (
          <Suspense fallback={<div className="view-loading" role="status">Opening the graybox…</div>}>
            <Graybox
              ref={box}
              badges={badges}
              project={shown}
              levelId={level.id}
              floorId={floor.id}
              allFloors={view3d.allFloors}
              stack={view3d.stack}
              connections={view3d.connections && isStructure(level)}
              ceilings={view3d.ceilings}
              logic={view3d.logic}
              tool={view3d.tool}
              axes={view3d.axes}
              collision={view3d.collision}
              walkable={view3d.walkable}
              global={global}
              selection={preview ? preview.made : selection}
              onSelect={preview ? () => {} : setSelection}
              onCommit={preview ? held : commitItems}
              placing={pick?.sticky ? pick.assetId : null}
              onPlace={putDown}
              onHover={setHover}
              focus={focus3d}
            />
          </Suspense>
        )}
          </div>,
        )}
        {!playing && isStructure(level) && showGenerate && (
          dock('generate', 'Generate', (pop) => <GeneratePanel
            {...(pop ? { onPopOut: pop } : {})}
            key={`${level.id}:${genStart?.n ?? 0}`}
            {...(genStart ? { start: { rules: genStart.rules } } : {})}
            level={level}
            floorId={floor.id}
            units={set.settings.units}
            areaName={selected && ['space', 'volume'].includes(assetOf(set, selected, global).kind) && assetOf(set, selected, global).role !== 'footprint' ? selected.name : undefined}
            proposal={preview}
            {...(level.floors.length > 1
              ? {
                  guided: {
                    ...(level.structure?.entrance ? { entrance: level.structure.entrance } : {}),
                    ...(level.structure?.stairs ? { stairs: level.structure.stairs } : {}),
                    picking: asking,
                    onPick: (what: 'entrance' | 'stairs' | null) => {
                      setPreview(null);
                      setAsking(what);
                      if (what) {
                        setMode('2d');
                        const g = groundFloorOf(level);
                        if (g) setFloorId(g.id);
                        // The whole floor in view, so its outside walls can be clicked.
                        setTimeout(() => map.current?.frame(), 0);
                        onSay(what === 'entrance' ? 'Click on the outside wall of the ground floor where the entrance goes.' : 'Click where the stairs go up: they will stand there on every floor.');
                      }
                    },
                    floors: (() => {
                      const order = guidedOrder(level);
                      const ground = order[0];
                      const sorted = [...level.floors].sort((a, b) => a.elevation - b.elevation);
                      return order.map((f) => {
                        const done = laidOut(set, level.id, f.id, global);
                        const k = sorted.findIndex((x) => x.id === f.id);
                        // The floor next to it on the way back to the ground: its stairs come from there.
                        const toward = ground && f.elevation > ground.elevation ? sorted[k - 1] : sorted[k + 1];
                        const nearDone = !toward || laidOut(set, level.id, toward.id, global);
                        const isGround = f.id === ground?.id;
                        const ready = isGround ? !!level.structure?.entrance : !!level.structure?.stairs && nearDone;
                        const why = isGround ? 'Set the way in first.' : !level.structure?.stairs ? 'Set the stairs first.' : !nearDone ? `Lay out ${toward!.name} first.` : undefined;
                        return { id: f.id, name: f.name, code: codes.get(f.id) ?? '', done, ready, ...(why ? { why } : {}) };
                      });
                    })(),
                  },
                }
              : {})}
            onPreview={(ask: GenerateAsk) => {
              if (ask.floorId) {
                // Floor by floor: just this one, seen on the map; before the stairs are set, with no stair core yet.
                setFloorId(ask.floorId);
                setMode('2d');
                setAsking(null);
                setPreview(proposeLayout(project, { levelId: level.id, floorIds: [ask.floorId], seed: ask.seed, settings: ask.settings, ...(level.structure?.stairs ? {} : { noCore: true }) }, global));
                return;
              }
              const floorIds = ask.scope === 'structure' ? level.floors.map((f) => f.id) : [floor.id];
              const areaId = ask.scope === 'area' && selected ? selected.id : undefined;
              if (ask.dressOnly) {
                const roomIds = areaId ? [areaId] : set.items.filter((i) => i.levelId === level.id && floorIds.includes(i.floorId) && assetOf(set, i, global).kind === 'space' && assetOf(set, i, global).role !== 'footprint').map((i) => i.id);
                setPreview(proposeDressing(project, { levelId: level.id, roomIds, theme: ask.settings.theme ?? 'none', seed: ask.seed, ...(ask.settings.decay !== undefined ? { decay: ask.settings.decay } : {}), ...(ask.settings.traps !== undefined ? { traps: ask.settings.traps } : {}) }, global));
                return;
              }
              const made = proposeLayout(project, { levelId: level.id, floorIds, ...(areaId ? { areaId } : {}), seed: ask.seed, settings: ask.settings }, global);
              setPreview(made);
            }}
            onAccept={() => {
              if (!preview) return;
              const next = updateStructure(acceptLayout(preview), level.id, { seed: preview.run.seed });
              setPreview(null);
              onCommit(next);
              // Floor by floor: the ground floor done and no stairs yet, ask for them now.
              const ground = groundFloorOf(level);
              if (level.floors.length > 1 && preview.run.floorIds.length === 1 && preview.run.floorIds[0] === ground?.id && !level.structure?.stairs && level.structure?.entrance) {
                setAsking('stairs');
                setMode('2d');
                setTimeout(() => map.current?.frame(), 0);
                onSay(`${ground!.name} is laid out. Now click where the stairs go up to the next floor: they line up through every floor.`);
                return;
              }
              onSay(
                preview.counts.rooms || preview.counts.corridors
                  ? `Layout accepted: ${preview.counts.rooms} rooms and ${preview.counts.doors} doors. Edit them as you like; regenerating replaces only what you leave as it was.`
                  : `Dressing accepted: ${preview.made.length} things in the rooms. Move or change any of them and dressing again keeps it.`,
              );
            }}
            onReject={() => setPreview(null)}
            onDrawRoute={() => {
              setPreview(null);
              setMode('2d');
              setTool('route');
              setRouteKind('progression');
              onSay('Click the way in, then each chamber along the route; Enter or a double-click ends it.');
            }}
            onClose={() => {
              setPreview(null);
              setShowGenerate(false);
            }}
          />)
        )}
        {!playing && showPrefabs && (
          dock('prefabs', 'Prefabs', (pop) => <PrefabsPanel
            {...(pop ? { onPopOut: pop } : {})}
            prefabs={prefabsOf(project)}
            selected={selection.length}
            {...(isStructure(level) ? { structureName: level.name } : {})}
            onClose={() => setShowPrefabs(false)}
            onSay={onSay}
            onPlace={(prefab) => placePrefabAt(prefab, viewCentre())}
            onSave={(name) => {
              const pre = makePrefab(project, selection, { name, ...(getPreferences().authorName ? { author: getPreferences().authorName } : {}) }, global);
              if (!pre) {
                onSay('Select something to save as a prefab.');
                return;
              }
              onCommit(savePrefab(project, pre));
              onSay(`Saved “${pre.name}” as a prefab: ${pre.items.length} pieces${pre.objects.length ? `, with ${pre.objects.map((o) => o.name).join(', ')}` : ''}.`);
            }}
            onSaveStructure={(name) => {
              const pre = makeStructurePrefab(project, level.id, { name, ...(getPreferences().authorName ? { author: getPreferences().authorName } : {}) }, global);
              if (!pre) {
                onSay('There is nothing in this structure to save yet.');
                return;
              }
              onCommit(savePrefab(project, pre));
              onSay(`Saved “${pre.name}” as a prefab: every floor, ${pre.items.length} pieces.`);
            }}
            onExport={(prefab) => downloadText(`${prefab.name.replace(/[^\w -]+/g, '').trim() || 'prefab'}.vcgsprefab.json`, prefabText(prefab), 'application/json')}
            onImport={(prefab) => {
              onCommit(savePrefab(project, prefab));
              onSay(`${prefab.name} is in this project’s prefabs. Place it where you like.`);
            }}
            onRemove={(prefab) => {
              onCommit(removePrefab(project, prefab.id));
              onSay(`Removed the prefab “${prefab.name}”. What was placed from it stays.`);
            }}
          />)
        )}
        {!playing && isStructure(level) && showStructure && (
          dock('graph', 'Structure graph', (pop) => <StructurePanel
            {...(pop ? { onPopOut: pop } : {})}
            project={shown}
            levelId={level.id}
            floorId={floor.id}
            global={global}
            selection={selection}
            onClose={() => setShowStructure(false)}
            onSelect={(id, fid) => {
              if (fid !== floor.id) setFloorId(fid);
              setSelection([id]);
              setTimeout(() => (mode === '3d' ? box.current : map.current)?.frame([id]), 0);
            }}
          />)
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
      {dock('inspector', 'Properties', () => <LevelInspector
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
        onSay={onSay}
        onShowPuzzle={showPuzzle}
      />)}
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
      {showTeam && isStructure(level) && (
        <TeamDialog
          project={project}
          levelId={level.id}
          levelName={level.name}
          me={getPreferences().authorName}
          onClose={() => setShowTeam(false)}
          onClaim={(by) => {
            onCommit(claimLevel(project, level.id, by));
            onSay(`${level.name} is claimed by ${by.trim()}.`);
          }}
          onRelease={() => {
            onCommit(releaseLevel(project, level.id));
            onSay(`${level.name} is free again.`);
          }}
          onHandOut={(to) => {
            const out = handOut(project, level.id, to, getPreferences().authorName || 'Someone');
            if (!out) return;
            onCommit(out.project);
            downloadText(fileNameFor(out.copy), serialize(out.copy), 'application/json');
            onSay(`Handed ${level.name} out to ${to.trim()}: give them the file just saved. When they send it back, merge it here.`);
          }}
          onSendBack={() => {
            downloadText(sendBackName(project), serialize(project), 'application/json');
            onSay('Saved the working copy to send back. They merge it into their project.');
          }}
          onMerged={(merged, taken, kept) => {
            onCommit(merged);
            setShowTeam(false);
            onSay(`Merged ${level.name}: ${taken} ${taken === 1 ? 'change' : 'changes'} taken${kept ? `, ${kept} kept as you had ${kept === 1 ? 'it' : 'them'}` : ''}. Undo takes the merge back.`);
          }}
        />
      )}
      {askHall && (
        <HallwayDialog
          width={hallWidth}
          units={set.settings.units}
          onClose={() => setAskHall(false)}
          onPick={(w) => {
            setHallWidth(w);
            try {
              localStorage.setItem(HALL_KEY, String(w));
            } catch {
              // It asks again next time.
            }
            setAskHall(false);
            setMode('2d');
            setTool('hallway');
            onSay('Click along where the hallway runs; Enter or a double-click finishes it.');
          }}
        />
      )}
      {importing && isStructure(level) && (
        <ImportPlanDialog
          floorName={floor.name}
          onClose={() => setImporting(false)}
          onImport={(plan, file) => {
            const out = importPlan(project, level.id, floor.id, plan, global);
            setImporting(false);
            if (!out.made.length) {
              onSay(out.problems[0] ?? 'Nothing in the plan could be put on this floor.');
              return;
            }
            onCommit(out.project);
            setSelection(out.made.filter((id) => levelsOf(out.project).items.find((i) => i.id === id)?.assetId !== 'struct.footprint'));
            onSay(`${file} is on ${floor.name}: ${out.counts.rooms} rooms, ${out.counts.doors} doors and ${out.counts.stairs} stairs.${out.problems.length ? ` ${out.problems.join(' ')}` : ''} Undo takes it all back.`);
          }}
        />
      )}
      {newStructure && (
        <NewStructureDialog
          units={set.settings.units}
          scenes={Object.values(project.objects)
            .filter((o) => o.type === 'scene')
            .map((o) => ({ id: o.id, name: `${o.data.code ? `${o.data.code} ` : ''}${o.name}` }))}
          onClose={() => setNewStructure(false)}
          onCreate={(choice) => {
            // In the middle of what is in view.
            const at = viewCentre();
            const made = createStructure(project, { ...choice, parentId: level.id, floorId: floor.id, at }, global);
            setNewStructure(false);
            if (!made.id) return;
            onCommit(made.project);
            const m = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
            const ground = m.floors.find((f) => f.kind === 'ground') ?? m.floors[0]!;
            onSay(`${m.name} is on ${level.name}, and opens as its own map with ${m.floors.length} floors. Draw its rooms; Alt+↑ goes back.`);
            setShowStructure(true);
            openMap(made.id, ground.id, undefined, made.project);
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
