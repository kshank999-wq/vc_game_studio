import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../../model/bible';
import { filterChoices, filterLabel, GROUP_LABEL, groupChoices, sameKind, scenesIn, type Filter, type GroupBy } from '../../model/bible-filters';
import type { Project } from '../../model/types';

type Open = 'group' | 'scene' | 'filter' | null;

/**
 * The chips under the Bible's search (mockup 06): how the list is grouped,
 * which scene it is narrowed to, the other filters on, and "+ Filter".
 */
export const BibleChips = ({ project, entries, filters, onFilters, groupBy, onGroupBy, issues, viewGroupLabel }: {
  project: Project;
  /** The view's entries before the filters, so the menus can say what each would keep. */
  entries: Entry[];
  filters: Filter[];
  onFilters: (filters: Filter[]) => void;
  groupBy: GroupBy;
  onGroupBy: (by: GroupBy) => void;
  issues: ReadonlyMap<string, string>;
  /** What the view's own grouping is called ("Role", "Where it sits"). */
  viewGroupLabel: string;
}) => {
  const [open, setOpen] = useState<Open>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const scene = filters.find((f): f is Extract<Filter, { kind: 'scene' }> => f.kind === 'scene');
  const others = filters.filter((f) => f.kind !== 'scene');
  const set = (filter: Filter) => onFilters([...filters.filter((f) => !sameKind(f, filter)), filter]);
  const remove = (filter: Filter) => onFilters(filters.filter((f) => f !== filter));
  const groupName = (by: GroupBy) => (by === 'view' ? viewGroupLabel : GROUP_LABEL[by]);
  const toggle = (which: Exclude<Open, null>) => setOpen(open === which ? null : which);

  return (
    <div className="bible-chips" ref={root}>
      <div className="chip-wrap">
        <button className={`tag chip-menu${groupBy !== 'view' ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open === 'group'} onClick={() => toggle('group')}>
          Group: {groupName(groupBy)}
        </button>
        {open === 'group' && (
          <div className="add-menu chip-dropdown" role="menu">
            <div className="menu-heading">GROUP BY</div>
            {groupChoices(entries).map((by) => (
              <button
                key={by}
                role="menuitemradio"
                aria-checked={by === groupBy}
                onClick={() => {
                  onGroupBy(by);
                  setOpen(null);
                }}
              >
                <span className="menu-check">{by === groupBy ? '●' : ''}</span>
                {groupName(by)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="chip-wrap">
        <button className={`tag chip-menu${scene ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open === 'scene'} onClick={() => toggle('scene')}>
          {scene ? filterLabel(project, scene) : 'Scene: any'}
        </button>
        {open === 'scene' && (
          <div className="add-menu chip-dropdown" role="menu">
            <div className="menu-heading">IN SCENE</div>
            <button
              role="menuitemradio"
              aria-checked={!scene}
              onClick={() => {
                onFilters(others);
                setOpen(null);
              }}
            >
              <span className="menu-check">{!scene ? '●' : ''}</span>
              Any scene
            </button>
            {scenesIn(project, entries).map((s) => (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={scene?.sceneId === s.id}
                onClick={() => {
                  set({ kind: 'scene', sceneId: s.id });
                  setOpen(null);
                }}
              >
                <span className="menu-check">{scene?.sceneId === s.id ? '●' : ''}</span>
                {s.data.code ? `${s.data.code} ` : ''}
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {others.map((f) => (
        <span key={JSON.stringify(f)} className="tag on chip-active">
          {filterLabel(project, f)}
          <button className="chip-x" aria-label={`Remove filter ${filterLabel(project, f)}`} onClick={() => remove(f)}>
            ×
          </button>
        </span>
      ))}

      <div className="chip-wrap">
        <button className="tag chip-add-filter" aria-haspopup="menu" aria-expanded={open === 'filter'} onClick={() => toggle('filter')}>
          + Filter
        </button>
        {open === 'filter' && (
          <div className="add-menu chip-dropdown" role="menu">
            {filterChoices(project, entries, issues).map((section) => (
              <div key={section.heading}>
                <div className="menu-heading">{section.heading}</div>
                {section.options.map(({ filter, count }) => {
                  const on = filters.some((f) => JSON.stringify(f) === JSON.stringify(filter));
                  return (
                    <button
                      key={JSON.stringify(filter)}
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => {
                        if (on) remove(filters.find((f) => JSON.stringify(f) === JSON.stringify(filter))!);
                        else set(filter);
                        setOpen(null);
                      }}
                    >
                      <span className="menu-check">{on ? '✓' : ''}</span>
                      {filterLabel(project, filter)}
                      <span className="menu-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {filters.length > 0 && (
        <button className="chip-clear" onClick={() => onFilters([])}>
          Clear
        </button>
      )}
    </div>
  );
};
