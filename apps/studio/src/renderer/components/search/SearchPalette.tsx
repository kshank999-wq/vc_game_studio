import { useEffect, useMemo, useRef, useState } from 'react';
import { search, type SearchResult } from '../../model/search';
import type { Project } from '../../model/types';
import { shortcutLabel } from '../menu/MenuBar';
import { Symbol } from '../Symbol';

/**
 * Search the whole project from anywhere (Ctrl+K). Enter goes to the result:
 * its node on the story graph, the scene that holds it, or its line in the
 * script. Mod+Enter opens it in the Game Bible instead.
 */
export const SearchPalette = ({ project, onGo, onBible, onClose }: {
  project: Project;
  onGo: (result: SearchResult) => void;
  onBible: (result: SearchResult) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const results = useMemo(() => search(project, query), [project, query]);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const go = (result: SearchResult | undefined, bible: boolean) => {
    if (!result) return;
    onClose();
    if (bible && result.inBible) onBible(result);
    else onGo(result);
  };

  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={onClose}>
      <div className="search-palette" role="dialog" aria-label="Search the project" onPointerDown={(e) => e.stopPropagation()}>
        <div className="search-field">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            autoFocus
            aria-label="Search"
            aria-controls="search-results"
            aria-activedescendant={results[at] ? `search-${at}` : undefined}
            placeholder="Search scenes, characters, objects, lines…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAt((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(results[at], e.ctrlKey || e.metaKey);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {query.trim() && (
          <ul id="search-results" ref={list} className="search-results" role="listbox" aria-label="Results">
            {results.length === 0 && <li className="search-empty">Nothing called “{query.trim()}”.</li>}
            {results.map((r, i) => (
              <li
                key={`${r.kind}:${r.id}`}
                id={`search-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === at}
                className={`search-result${i === at ? ' active' : ''}`}
                onPointerEnter={() => setAt(i)}
                onClick={(e) => go(r, e.ctrlKey || e.metaKey)}
              >
                <Symbol type={r.type} size={13} />
                <span className="search-text">
                  <span className="search-label">{r.label}</span>
                  <span className="search-detail">
                    {r.detail}
                    {r.snippet && <span className="search-snippet"> · “{r.snippet}”</span>}
                  </span>
                </span>
                {i === at && (
                  <span className="search-go">
                    {r.to.kind === 'graph' ? 'Show on graph' : r.kind === 'line' ? 'Open script' : 'Open scene'} ↵
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="search-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>↵</kbd> go there
          </span>
          <span>
            <kbd>{shortcutLabel('Mod+↵')}</kbd> open in the Bible
          </span>
        </div>
      </div>
    </div>
  );
};
