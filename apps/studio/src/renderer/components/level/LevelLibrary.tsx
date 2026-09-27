import { useMemo, useState } from 'react';
import { assetOf, CATEGORY_COLOR } from '../../model/level/geometry';
import { CATEGORIES, STARTER } from '../../model/level/library';
import { exportNameOf } from '../../model/level/naming';
import type { AssetCategory, AssetDefinition, LevelSet } from '../../model/level/types';

/** A small picture of what an asset is: its outline on the map, in its category's colour. */
export const AssetIcon = ({ asset, size = 18 }: { asset: AssetDefinition; size?: number }) => {
  const c = CATEGORY_COLOR[asset.category] ?? '#a59c86';
  const body = (() => {
    switch (asset.kind) {
      case 'space':
        return <rect x="2" y="3.5" width="12" height="9" fill="none" stroke={c} strokeWidth="2" strokeDasharray={asset.role === 'zone' ? '2 1.5' : undefined} />;
      case 'hosted':
        return asset.role === 'window' ? (
          <>
            <path d="M1 8h14" stroke="#8b8473" strokeWidth="2.4" />
            <path d="M5 8h6" stroke="#9fc6d8" strokeWidth="2.4" />
          </>
        ) : (
          <>
            <path d="M1 12h3M12 12h3" stroke="#8b8473" strokeWidth="2.4" />
            <path d="M4 12V4" stroke={c} strokeWidth="1.6" />
            <path d="M4 4a8 8 0 018 8" fill="none" stroke={c} strokeWidth="1" strokeDasharray="1.5 1.5" />
          </>
        );
      case 'volume':
        return <rect x="2.5" y="2.5" width="11" height="11" fill={c} fillOpacity="0.15" stroke={c} strokeWidth="1.4" strokeDasharray="2.5 1.8" />;
      case 'marker':
        return (
          <>
            <path d="M8 1.5l2.4 3.6H5.6z" fill={c} />
            <circle cx="8" cy="9.5" r="4.5" fill="none" stroke={c} strokeWidth="1.8" />
          </>
        );
      case 'light':
        return (
          <>
            <circle cx="8" cy="8" r="3.2" fill={c} />
            <path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" stroke={c} strokeWidth="1.2" />
          </>
        );
      case 'assembly':
        return (
          <>
            <rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke={c} strokeWidth="1.6" />
            <rect x="6.5" y="6.5" width="8" height="8" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1.6" />
          </>
        );
      default:
        if (asset.proxy === 'cylinder' || asset.proxy === 'sphere') return <circle cx="8" cy="8" r="5.5" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1.6" />;
        if (asset.proxy === 'stairs') return <path d="M2 14h3v-3h3V8h3V5h3V2" fill="none" stroke={c} strokeWidth="1.6" />;
        if (asset.proxy === 'wedge') return <path d="M2 13h12V4z" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1.6" />;
        return <rect x="2.5" y="2.5" width="11" height="11" rx="1" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1.6" />;
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="asset-icon">
      {body}
    </svg>
  );
};

const Eye = ({ open }: { open: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" opacity={open ? 1 : 0.45} />
    {open ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : <path d="M2.5 13.5l11-11" />}
  </svg>
);

const Lock = ({ closed }: { closed: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" opacity={closed ? 1 : 0.45}>
    <rect x="3" y="7" width="10" height="7.5" rx="1.2" fill={closed ? 'currentColor' : 'none'} />
    <path d={closed ? 'M5 7V5a3 3 0 016 0v2' : 'M5 7V5a3 3 0 015.8-1'} />
  </svg>
);

interface Props {
  set: LevelSet;
  levelId: string;
  floorId: string;
  global: readonly AssetDefinition[];
  /** The asset picked up, if any. */
  active: string | null;
  onPick: (assetId: string, e: React.PointerEvent) => void;
  tab: 'library' | 'outliner';
  onTab: (tab: 'library' | 'outliner') => void;
  selection: readonly string[];
  onSelect: (ids: string[]) => void;
  hidden: ReadonlySet<AssetCategory>;
  onToggleLayer: (category: AssetCategory) => void;
  onToggleItem: (id: string, what: 'hidden' | 'locked') => void;
  onDeleteAsset: (asset: AssetDefinition) => void;
  onPromote: (asset: AssetDefinition) => void;
}

/**
 * The left panel (spec §2): the library to drag assets from, and the outliner
 * of what is on this floor, by layer, with visibility and locks.
 */
export const LevelLibrary = (props: Props) => {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const q = query.trim().toLowerCase();
  const all = useMemo(() => [...STARTER, ...props.set.assets, ...props.global.filter((g) => !props.set.assets.some((a) => a.id === g.id))], [props.set.assets, props.global]);
  const match = (a: AssetDefinition) => !q || `${a.name} ${a.description} ${a.role}`.toLowerCase().includes(q);

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const items = props.set.items.filter((i) => i.levelId === props.levelId && i.floorId === props.floorId);

  return (
    <aside className="lvl-left" aria-label="Library and outliner">
      <div className="lvl-tabs" role="tablist">
        <button role="tab" aria-selected={props.tab === 'library'} className={props.tab === 'library' ? 'on' : ''} onClick={() => props.onTab('library')}>
          Library
        </button>
        <button role="tab" aria-selected={props.tab === 'outliner'} className={props.tab === 'outliner' ? 'on' : ''} onClick={() => props.onTab('outliner')}>
          Outliner <span className="lvl-count">{items.length}</span>
        </button>
      </div>
      <input className="inp small lvl-search" placeholder={props.tab === 'library' ? 'Search the library' : 'Find on this floor'} aria-label={props.tab === 'library' ? 'Search the library' : 'Find on this floor'} value={query} onChange={(e) => setQuery(e.target.value)} />
      {props.tab === 'library' ? (
        <div className="lvl-list">
          <p className="lvl-hint">Drag onto the map or the graybox, or click and then click where it goes.</p>
          {CATEGORIES.map((cat) => {
            const assets = all.filter((a) => (a.source === 'starter' ? a.category === cat.id : cat.id === 'custom') && match(a));
            if (!assets.length) return null;
            const open = !closed.has(cat.id) || !!q;
            return (
              <section key={cat.id} className="lvl-cat">
                <button className="lvl-cat-head" aria-expanded={open} onClick={() => toggle(cat.id)}>
                  <span className="lvl-cat-dot" style={{ background: CATEGORY_COLOR[cat.id] }} />
                  {cat.label}
                  <span className="lvl-count">{assets.length}</span>
                </button>
                {open && (
                  <div className="lvl-assets">
                    {assets.map((a) => (
                      <div key={a.id} className={`lvl-asset${props.active === a.id ? ' on' : ''}`} title={a.description}>
                        <button className="lvl-asset-pick" onPointerDown={(e) => props.onPick(a.id, e)} aria-label={`Place ${a.name}`}>
                          <AssetIcon asset={a} />
                          <span className="lvl-asset-name">{a.name}</span>
                          {a.source !== 'starter' && <span className="lvl-asset-src">{a.source === 'global' ? 'mine' : 'project'}{a.version > 1 ? ` · v${a.version}` : ''}</span>}
                        </button>
                        {a.source === 'project' && (
                          <button className="icon-btn small" title="Add to my library, for every project" aria-label={`Add ${a.name} to my library`} onClick={() => props.onPromote(a)}>
                            ↑
                          </button>
                        )}
                        {a.source !== 'starter' && (
                          <button className="icon-btn small" title={a.source === 'global' ? 'Remove from my library' : 'Remove from this project’s library'} aria-label={`Remove ${a.name}`} onClick={() => props.onDeleteAsset(a)}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="lvl-list">
          {CATEGORIES.map((cat) => {
            const inCat = items.filter((i) => assetOf(props.set, i, props.global).category === cat.id && (!q || `${i.name} ${exportNameOf(props.set, i, props.global)}`.toLowerCase().includes(q)));
            if (!inCat.length) return null;
            const layerOff = props.hidden.has(cat.id);
            return (
              <section key={cat.id} className={`lvl-cat${layerOff ? ' off' : ''}`}>
                <div className="lvl-cat-head">
                  <span className="lvl-cat-dot" style={{ background: CATEGORY_COLOR[cat.id] }} />
                  {cat.label}
                  <span className="lvl-count">{inCat.length}</span>
                  <button className="icon-btn small lvl-eye" aria-pressed={!layerOff} aria-label={`${layerOff ? 'Show' : 'Hide'} the ${cat.label} layer`} title={layerOff ? 'Show this layer' : 'Hide this layer'} onClick={() => props.onToggleLayer(cat.id)}>
                    <Eye open={!layerOff} />
                  </button>
                </div>
                {inCat.map((i) => (
                  <div key={i.id} className={`lvl-row${props.selection.includes(i.id) ? ' on' : ''}${i.hidden ? ' hidden' : ''}`}>
                    <button className="lvl-row-name" title={exportNameOf(props.set, i, props.global)} onClick={(e) => props.onSelect(e.shiftKey ? [...props.selection, i.id] : [i.id])}>
                      <AssetIcon asset={assetOf(props.set, i, props.global)} size={14} />
                      <span>{i.name}</span>
                    </button>
                    <button className="icon-btn small" aria-label={`${i.hidden ? 'Show' : 'Hide'} ${i.name}`} title={i.hidden ? 'Show' : 'Hide'} onClick={() => props.onToggleItem(i.id, 'hidden')}>
                      <Eye open={!i.hidden} />
                    </button>
                    <button className={`icon-btn small${i.locked ? ' on' : ''}`} aria-label={`${i.locked ? 'Unlock' : 'Lock'} ${i.name}`} title={i.locked ? 'Unlock' : 'Lock in place'} onClick={() => props.onToggleItem(i.id, 'locked')}>
                      <Lock closed={!!i.locked} />
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
          {!items.length && <p className="lvl-hint">Nothing on this floor yet. Drag a Room in from the library.</p>}
        </div>
      )}
    </aside>
  );
};
