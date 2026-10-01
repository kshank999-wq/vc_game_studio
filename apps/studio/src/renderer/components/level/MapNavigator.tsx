import { useEffect, useMemo, useState } from 'react';
import { filterTree, kindLabel, navigatorTree, pathTo, STATUSES, type TreeNode } from '../../model/level/hierarchy';
import type { AssetDefinition, LevelSet } from '../../model/level/types';

interface Props {
  set: LevelSet;
  global: readonly AssetDefinition[];
  levelId: string;
  floorId: string;
  selection: readonly string[];
  /** Open a map, at a floor, with an item selected. */
  onOpen: (levelId: string, floorId?: string, itemId?: string) => void;
  /** Show where a map is on the map open now (its item there). */
  onLocate: (itemId: string) => void;
  /** Detail a room in place (double-click a room). */
  onFocusRoom?: (roomId: string) => void;
  onNewWorld: () => void;
  onNewChild: (parentId: string) => void;
  onToggle: (levelId: string, what: 'favorite' | 'hidden' | 'locked') => void;
  onRename: (levelId: string, name: string) => void;
  onDuplicate: (levelId: string) => void;
  onDelete: (levelId: string) => void;
}

const KIND_MARK: Record<string, string> = { world: 'W', region: 'R', level: 'L', district: 'D', building: 'B', interior: 'I' };

/**
 * The navigator (spec V2 §6): World › Region › Level › Building › Floor ›
 * Room, always to hand. Click a map to see it (on the map open now if it sits
 * there, else it opens); double-click or ▸ to open it. Search, favourites,
 * and each map's status at a glance.
 */
export const MapNavigator = (props: Props) => {
  const { set, global } = props;
  const tree = useMemo(() => navigatorTree(set, global), [set, global]);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const shown = useMemo(() => filterTree(tree, query, { favorites }), [tree, query, favorites]);
  const searching = !!query.trim() || favorites;

  // The way to the open map stays open.
  const path = useMemo(() => pathTo(set, props.levelId).map((l) => l.id), [set, props.levelId]);
  useEffect(() => {
    setClosed((c) => {
      if (!path.some((id) => c.has(id))) return c;
      const n = new Set(c);
      for (const id of path) n.delete(id);
      return n;
    });
  }, [path]);

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const click = (n: TreeNode) => {
    if (n.kind === 'room') return props.onOpen(n.levelId, n.floorId, n.id);
    if (n.kind === 'floor') return props.onOpen(n.levelId, n.floorId);
    const level = set.levels.find((l) => l.id === n.id);
    // On the map open now: point at it there, and wait for a double-click to go in.
    if (level?.anchorId && level.parentId === props.levelId) return props.onLocate(level.anchorId);
    props.onOpen(n.id);
  };

  const row = (n: TreeNode, depth: number): React.ReactNode => {
    const open = searching || !closed.has(n.id);
    const here = n.kind === 'map' ? n.id === props.levelId : n.kind === 'floor' ? n.levelId === props.levelId && n.id === props.floorId : props.selection.includes(n.id);
    const status = n.status ? STATUSES.find((s) => s.id === n.status) : undefined;
    return (
      <li key={`${n.kind}:${n.id}`} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={here} aria-label={n.name}>
        <div className={`lvl-nav-row ${n.kind}${here ? ' on' : ''}${n.hidden ? ' hidden' : ''}`} style={{ paddingLeft: 4 + depth * 12 }}>
          <button className="lvl-nav-twist" aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`} disabled={!n.children.length} onClick={() => toggle(n.id)}>
            {n.children.length ? (open ? '▾' : '▸') : ''}
          </button>
          {n.kind === 'map' ? (
            <span className={`lvl-nav-kind ${n.mapKind}`} title={kindLabel(n.mapKind!)}>
              {KIND_MARK[n.mapKind!]}
            </span>
          ) : (
            <span className="lvl-nav-kind minor">{n.kind === 'floor' ? '≡' : '□'}</span>
          )}
          {renaming?.id === n.id ? (
            <input
              className="inp small lvl-nav-rename"
              autoFocus
              aria-label={`Rename ${n.name}`}
              value={renaming.name}
              onChange={(e) => setRenaming({ id: n.id, name: e.target.value })}
              onBlur={() => {
                if (renaming.name.trim()) props.onRename(n.id, renaming.name.trim());
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button className="lvl-nav-name" aria-label={`${n.name}, ${n.kind === 'map' ? kindLabel(n.mapKind!).toLowerCase() : n.kind}`} onClick={() => click(n)} onDoubleClick={() => (n.kind === 'map' ? props.onOpen(n.id) : n.kind === 'room' ? props.onFocusRoom?.(n.id) : undefined)} title={n.kind === 'map' ? `${kindLabel(n.mapKind!)} · ${status?.label ?? ''} · double-click to open` : undefined}>
              {n.favorite && <span className="lvl-nav-star">★ </span>}
              {n.name}
            </button>
          )}
          {status && <span className={`lvl-nav-status ${status.id}`} title={status.label} aria-label={status.label} />}
          {n.locked && <span className="lvl-nav-lock" title="Locked">🔒</span>}
          {n.kind === 'map' && (
            <>
              <button className="icon-btn small lvl-nav-open" aria-label={`Open ${n.name}`} title="Open it" onClick={() => props.onOpen(n.id)}>
                ▸
              </button>
              <button className="icon-btn small lvl-nav-more" aria-label={`More for ${n.name}`} aria-expanded={menu === n.id} onClick={() => setMenu((m) => (m === n.id ? null : n.id))}>
                ⋯
              </button>
            </>
          )}
        </div>
        {menu === n.id && (
          <div className="lvl-nav-menu" role="menu" aria-label={`${n.name} actions`}>
            {(
              [
                ['New map inside', () => props.onNewChild(n.id)],
                ['Rename', () => setRenaming({ id: n.id, name: n.name })],
                [n.favorite ? 'Unfavourite' : 'Favourite', () => props.onToggle(n.id, 'favorite')],
                [n.hidden ? 'Show' : 'Hide', () => props.onToggle(n.id, 'hidden')],
                [n.locked ? 'Unlock' : 'Lock', () => props.onToggle(n.id, 'locked')],
                ['Duplicate', () => props.onDuplicate(n.id)],
                ['Delete…', () => props.onDelete(n.id)],
              ] as const
            ).map(([label, go]) => (
              <button
                key={label}
                role="menuitem"
                className={label === 'Delete…' ? 'danger' : ''}
                onClick={() => {
                  setMenu(null);
                  go();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {open && n.children.length > 0 && <ul role="group">{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section className={`lvl-nav${collapsed ? ' collapsed' : ''}`} aria-label="Navigator">
      <header className="lvl-nav-head">
        <button className="lvl-nav-title" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '▸' : '▾'} Maps
        </button>
        <span className="grow" />
        <button className={`icon-btn small${favorites ? ' on' : ''}`} aria-pressed={favorites} aria-label="Favourites only" title="Favourites only" onClick={() => setFavorites((f) => !f)}>
          ★
        </button>
        <button className="tb-btn small" onClick={props.onNewWorld} title="Start a world from a size preset">
          + World
        </button>
      </header>
      {!collapsed && (
        <>
          <input className="inp small lvl-search" placeholder="Find a map, floor or room" aria-label="Find a map, floor or room" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="lvl-nav-tree" role="tree" aria-label="Maps">
            {shown.map((n) => row(n, 0))}
            {!shown.length && <li className="lvl-hint">{searching ? 'Nothing matches.' : 'No maps yet.'}</li>}
          </ul>
        </>
      )}
    </section>
  );
};
