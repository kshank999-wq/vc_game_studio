import { useEffect, useMemo, useRef, useState } from 'react';
import { childrenOf, kindBelow, kindLabel, kindOf, MAP_KINDS, scaleOf, WORLD_PRESETS, type WorldPreset } from '../../model/level/hierarchy';
import { areaPath, MARKER_FOR, newSceneArea, newWorld, nextSpot, pinMapOf, placedFor, placeElement, sceneMapOf, scenePinOf, setSceneMap } from '../../model/level/scene-area';
import type { Level, MapKind, TravelKind } from '../../model/level/types';
import { levelOf } from '../../model/level-of';
import { CATEGORIES, elementsIn } from '../../model/scene';
import type { Project } from '../../model/types';
import { useNav } from '../../nav';
import type { View } from '../../view';
import { useGlobalAssets } from '../level/global-library';
import { LevelMap, type MapApi } from '../level/LevelMap';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  onSay: (message: string) => void;
  /** Open one of the scene's elements in the panel. */
  onOpenElement: (id: string) => void;
}

/**
 * The scene on its map (macro to micro): first where it happens, an area of
 * the game's world; then, on that area's 2D map, its pin and everything in
 * it, placed where it stands, with paths drawn to the places around it. It is
 * the same map as in the Level Designer.
 */
export const SceneMap = (props: Props) => {
  const map = sceneMapOf(props.project, props.sceneId);
  const [changing, setChanging] = useState(false);
  if (!map || changing) return <AreaChooser {...props} current={map} onDone={() => setChanging(false)} />;
  return <AreaMap {...props} map={map} onChange={() => setChanging(true)} />;
};

// ---------------------------------------------------------------- choosing the area

/** Every map, a world first and what is inside it under it. */
const flatTree = (project: Project): { map: Level; depth: number }[] => {
  const set = project.levels;
  if (!set) return [];
  const out: { map: Level; depth: number }[] = [];
  const walk = (map: Level, depth: number) => {
    out.push({ map, depth });
    for (const child of childrenOf(set, map.id)) walk(child, depth + 1);
  };
  for (const root of set.levels.filter((l) => !l.parentId || !set.levels.some((p) => p.id === l.parentId))) walk(root, 0);
  return out;
};

const AreaChooser = ({ project, sceneId, onCommit, onSay, current, onDone }: Props & { current?: Level; onDone: () => void }) => {
  const global = useGlobalAssets();
  const scene = project.objects[sceneId]!;
  const maps = flatTree(project);
  const band = levelOf(project, sceneId);
  const bandMap = band?.mapId ? project.levels?.levels.find((l) => l.id === band.mapId) : undefined;
  const [worldName, setWorldName] = useState(project.name && project.name !== 'Untitled Game' ? project.name : 'World');
  const [preset, setPreset] = useState<WorldPreset['id']>('medium');
  const [parent, setParent] = useState<string>(bandMap?.id ?? current?.parentId ?? maps[0]?.map.id ?? '');
  // A scene's own area is a place you walk around: a level inside a world or region, the next size down inside anything smaller.
  const kindFor = (mapId: string): MapKind => {
    const m = project.levels?.levels.find((l) => l.id === mapId);
    return !m || scaleOf(kindOf(m)) === 'world' ? 'level' : kindBelow(kindOf(m));
  };
  const [kind, setKind] = useState<MapKind>(() => kindFor(bandMap?.id ?? current?.parentId ?? maps[0]?.map.id ?? ''));
  const [name, setName] = useState(scene.name);

  const choose = (mapId: string) => {
    onCommit(setSceneMap(project, sceneId, mapId, global));
    onSay(`${scene.name} happens in ${project.levels?.levels.find((l) => l.id === mapId)?.name ?? 'that area'}. Drag its pin to the spot.`);
    onDone();
  };

  if (!maps.length) {
    return (
      <div className="area-chooser" role="region" aria-label="Where this scene happens">
        <h3>First, the world this game is set in</h3>
        <p className="dialog-text">
          Every scene happens somewhere. Make the world (or the one place the game is set in), then set this scene in an area of it: a region, a level, a town, a
          building, a room.
        </p>
        <label className="area-field">
          <span>Name</span>
          <input aria-label="World name" value={worldName} onChange={(e) => setWorldName(e.target.value)} />
        </label>
        <div className="area-presets" role="radiogroup" aria-label="How big">
          {WORLD_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
            <button key={p.id} role="radio" aria-checked={preset === p.id} className={`area-preset${preset === p.id ? ' on' : ''}`} onClick={() => setPreset(p.id)}>
              <b>{p.label}</b>
              <span>{p.use}</span>
            </button>
          ))}
        </div>
        <button
          className="tb-btn primary"
          onClick={() => {
            const made = newWorld(project, worldName.trim() || 'World', preset);
            onCommit(made.project);
            setParent(made.mapId);
            setKind('level');
            onSay(`${worldName.trim() || 'World'} is made. Now set the scene in an area of it.`);
          }}
        >
          Make the world
        </button>
      </div>
    );
  }

  return (
    <div className="area-chooser" role="region" aria-label="Where this scene happens">
      <h3>Where does “{scene.name}” happen?</h3>
      {bandMap && (
        <p className="dialog-text">
          It is in the level <b>{band!.name}</b> on the Level lane.{' '}
          <button className="link-btn" onClick={() => choose(bandMap.id)}>
            Set it there
          </button>{' '}
          or make an area inside it below.
        </p>
      )}
      <div className="area-new" role="group" aria-label="A new area for this scene">
        <b>A new area for it</b>
        <label className="area-field">
          <span>Inside</span>
          <select
            aria-label="Inside"
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
              setKind(kindFor(e.target.value));
            }}
          >
            {maps.map(({ map, depth }) => (
              <option key={map.id} value={map.id}>
                {'  '.repeat(depth)}
                {map.name} ({kindLabel(kindOf(map))})
              </option>
            ))}
          </select>
        </label>
        <label className="area-field">
          <span>Is a</span>
          <select aria-label="Kind of area" value={kind} onChange={(e) => setKind(e.target.value as MapKind)}>
            {MAP_KINDS.filter((k) => k.id !== 'world').map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="area-field">
          <span>Called</span>
          <input aria-label="Area name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="tb-btn primary"
          disabled={!parent}
          onClick={() => {
            const made = newSceneArea(project, sceneId, parent || undefined, kind, name, global);
            onCommit(made.project);
            onSay(`${name.trim() || scene.name} is a new ${kindLabel(kind).toLowerCase()}, and the scene happens there.`);
            onDone();
          }}
        >
          Make it and set the scene there
        </button>
      </div>
      <div className="area-list" role="list" aria-label="Or an area the game already has">
        <b>Or one the game already has</b>
        {maps.map(({ map, depth }) => (
          <div key={map.id} role="listitem" className={`area-row${current?.id === map.id ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
            <span className="area-kind">{kindLabel(kindOf(map))}</span>
            <span className="area-name">{map.name}</span>
            <button className="tb-btn small" aria-label={`Set it in ${map.name}`} onClick={() => choose(map.id)}>
              Set it here
            </button>
          </div>
        ))}
      </div>
      {current && (
        <button className="tb-btn" onClick={onDone}>
          Keep it in {current.name}
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- the area's map

const PLACEABLE = CATEGORIES.filter((c) => c.types.some((t) => MARKER_FOR[t]));

const AreaMap = ({ project, sceneId, onCommit, onSay, onOpenElement, map, onChange }: Props & { map: Level; onChange: () => void }) => {
  const global = useGlobalAssets();
  const nav = useNav();
  const api = useRef<MapApi>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 300, panY: 200 });
  const [selection, setSelection] = useState<string[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [route, setRoute] = useState<TravelKind | null>(null);
  const pin = scenePinOf(project, sceneId);
  const around = pinMapOf(project, sceneId);
  // The scene's own area, with what is in it; or the map around it, with the scene's pin and the paths to other places.
  const [onAround, setOnAround] = useState(false);
  const shownMap = onAround && around ? around : map;
  const floor = shownMap.floors[0]!;
  const path = areaPath(project, map.id);

  // Escape stops placing or drawing.
  useEffect(() => {
    if (!placing && !route) return;
    const stop = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlacing(null);
      setRoute(null);
    };
    window.addEventListener('keydown', stop);
    return () => window.removeEventListener('keydown', stop);
  }, [placing, route]);

  // The whole area in view when it opens.
  useEffect(() => {
    const t = setTimeout(() => api.current?.frame(), 0);
    return () => clearTimeout(t);
  }, [shownMap.id]);

  const elements = useMemo(
    () =>
      PLACEABLE.flatMap((c) =>
        elementsIn(project, sceneId, c.key)
          .filter((o) => MARKER_FOR[o.type])
          .map((o) => ({ object: o, placed: placedFor(project, sceneId, map.id, o.id).length > 0 })),
      ),
    [project, sceneId, map.id],
  );
  const placingObject = placing ? project.objects[placing] : undefined;

  const put = (id: string, at: { x: number; y: number }) => {
    const made = placeElement(project, sceneId, id, at, global);
    if (!made) return;
    onCommit(made.project);
    setSelection([made.itemId]);
    setPlacing(null);
  };

  return (
    <div className="area-map">
      <div className="area-bar">
        <nav className="area-path" aria-label="Where it happens">
          {path.map((m, i) => (
            <span key={m.id}>
              {i > 0 && <span className="area-sep">›</span>}
              <span className={i === path.length - 1 ? 'area-here' : ''}>{m.name}</span>
            </span>
          ))}
        </nav>
        <div className="grow" />
        {around && around.id !== map.id && (
          <div className="seg area-seg" role="tablist" aria-label="Which map">
            <button role="tab" aria-selected={!onAround} className={!onAround ? 'on' : ''} onClick={() => { setOnAround(false); setRoute(null); }}>
              The scene’s area
            </button>
            <button role="tab" aria-selected={onAround} className={onAround ? 'on' : ''} onClick={() => { setOnAround(true); setPlacing(null); }}>
              On {around.name}
            </button>
          </div>
        )}
        {(onAround || !around || around.id === map.id) && <button className={`tb-btn small${route ? ' on' : ''}`} aria-pressed={!!route} title="Draw a path from this scene's pin to another place: click the places it passes, double-click to finish" onClick={() => { setPlacing(null); setRoute(route ? null : 'trail'); }}>
          {route ? 'Drawing a path…' : 'Draw a path'}
        </button>}
        <button className="tb-btn small" onClick={onChange}>
          Change where
        </button>
        {nav.openLevels && (
          <button className="tb-btn small" title="Open this map in the Level Designer, with every tool" onClick={() => nav.openLevels!(pin?.id ?? map.id)}>
            Open in Levels ↗
          </button>
        )}
      </div>
      <div className="area-body">
        <LevelMap
          ref={api}
          project={project}
          levelId={shownMap.id}
          floorId={floor.id}
          global={global}
          selection={selection}
          onSelect={(ids) => {
            setSelection(ids);
            // A placed element opens in the scene's panel.
            const item = project.levels?.items.find((i) => i.id === ids[0]);
            const element = item?.links?.find((l) => l !== sceneId && project.objects[l]);
            if (element && ids.length === 1) onOpenElement(element);
          }}
          onCommit={onCommit}
          view={view}
          setView={setView}
          hidden={EMPTY}
          overlays={OVERLAYS}
          tool={route ? 'route' : 'select'}
          drawAsset=""
          routeKind={route ?? undefined}
          placing={placingObject ? MARKER_FOR[placingObject.type]! : null}
          onPlace={(at) => placing && put(placing, at)}
          onHover={() => {}}
          onOpen3D={() => nav.openLevels?.(map.id)}
          issues={NO_ISSUES}
        />
        {placingObject && <div className="area-hint">Click the map where {placingObject.name} is in this scene · Esc to stop</div>}
        {onAround && !route && <div className="area-hint">Drag the scene’s pin to where it happens on {around?.name}; Draw a path joins it to other places</div>}
        {route && <div className="area-hint">Click the places the path passes through, from the scene’s pin · double-click to finish · Esc to stop</div>}
      </div>
      {!onAround && <div className="area-elements" role="list" aria-label="Put on the map">
        <span className="area-elements-head">ON THE MAP</span>
        {elements.length === 0 && <span className="area-empty">Add characters, objects, choices and puzzles in the panel, then put them on the map here.</span>}
        {elements.map(({ object, placed }) => (
          <button
            key={object.id}
            role="listitem"
            className={`area-chip${placed ? ' placed' : ''}${placing === object.id ? ' on' : ''}`}
            title={placed ? 'On the map · click to put another' : 'Click, then click the map where it is'}
            onClick={() => {
              setRoute(null);
              setPlacing(placing === object.id ? null : object.id);
            }}
            onDoubleClick={() => put(object.id, nextSpot(project, sceneId, global))}
          >
            <Symbol type={object.type} size={12} color={object.type === 'character' ? (object.data.color as string | undefined) : undefined} />
            {object.name}
            {placed && <span className="area-check" aria-label="on the map">✓</span>}
          </button>
        ))}
        {elements.some((e) => !e.placed) && (
          <button
            className="tb-btn small"
            onClick={() => {
              let p = project;
              for (const e of elements.filter((x) => !x.placed)) p = placeElement(p, sceneId, e.object.id, nextSpot(p, sceneId, global), global)?.project ?? p;
              onCommit(p);
              onSay('Everything in the scene is on its map. Drag each where it belongs.');
            }}
          >
            Put the rest on the map
          </button>
        )}
      </div>}
    </div>
  );
};

const EMPTY = new Set<never>();
const OVERLAYS = { story: true, dims: false, ghost: true };
const NO_ISSUES = new Map<string, string>();
