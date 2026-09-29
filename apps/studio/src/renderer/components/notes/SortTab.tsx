import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withSampleNotes } from '../../model/notes/sample';
import {
  addCategory,
  categoriesOf,
  childrenOf,
  extract,

  importSource,
  loadTemplate,
  moveNote,
  notesIn,
  notesOf,
  passagesOf,
  progressOf,
  removeCategory,
  renameCategory,
  searchNotes,
  segmentsOf,
  sourceById,
} from '../../model/notes/sorter';
import { dismissSuggestion, suggestionsFor } from '../../model/notes/suggest';
import { CATEGORY_TYPES, TEMPLATES } from '../../model/notes/templates';
import type { Category } from '../../model/notes/types';
import { ReadError, readNotesFile } from '../../model/notes/read';
import type { Project } from '../../model/types';
import { Symbol } from '../Symbol';
import { NoteCard, dragged, endDrag, isOurs, startDrag } from './parts';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onSay: (message: string) => void;
  onOpenNote: (noteId: string) => void;
  onReview: () => void;
  /** A passage to bring into view (Build flow's "Show in raw notes"). */
  show: { sourceId: string; start: number } | null;
}

/** Where a selection in the raw notes starts or ends, as an offset into its source. */
const offsetAt = (node: Node, offset: number): number | null => {
  const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>('[data-at], [data-start]');
  if (!el) return null;
  if (el.dataset.at !== undefined) {
    const at = Number(el.dataset.at);
    return node.nodeType === Node.TEXT_NODE ? at + offset : at + (offset > 0 ? (el.textContent ?? '').length : 0);
  }
  // At a passage's edge: its start, or its end.
  const start = Number(el.dataset.start);
  return offset === 0 ? start : Number(el.dataset.end);
};

/** A picked passage: part of one source, and where to show its menu. */
interface Picked {
  sourceId: string;
  start: number;
  end: number;
  x: number;
  y: number;
}

/**
 * Step 1, Sort (HANDOFF §1, spec §4, §6): the raw notes on the left, never
 * edited, and the categories on the right. Highlight any passage and drag it
 * onto a category — or pick "Sort into" — and it is a card at once, with no
 * dialog; the words in the source grey out and get a margin tag.
 */
export const SortTab = ({ project, onCommit, onSay, onOpenNote, onReview, show }: Props) => {
  const set = notesOf(project);
  const [sourceId, setSourceId] = useState<string | null>(show?.sourceId ?? set.sources[0]?.id ?? null);
  const source = (sourceId && sourceById(project, sourceId)) || set.sources[0];
  const [hideSorted, setHideSorted] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const doc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show) setSourceId(show.sourceId);
  }, [show]);
  useLayoutEffect(() => {
    if (!show || show.sourceId !== source?.id) return;
    const el = doc.current?.querySelector<HTMLElement>(`[data-start="${passagesOf(source).find((p) => show.start >= p.start && show.start <= p.end)?.start}"]`);
    el?.scrollIntoView?.({ block: 'center' });
    el?.classList.add('flash');
  }, [show, source]);

  // ------------------------------------------------------------ picking passages

  const pickSelection = (): Picked | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !source) return null;
    const range = sel.getRangeAt(0);
    if (!doc.current?.contains(range.commonAncestorContainer)) return null;
    const a = offsetAt(range.startContainer, range.startOffset);
    const b = offsetAt(range.endContainer, range.endOffset);
    if (a === null || b === null || a === b) return null;
    const rect = range.getBoundingClientRect?.();
    const box = doc.current.getBoundingClientRect();
    return { sourceId: source.id, start: Math.min(a, b), end: Math.max(a, b), x: (rect?.right ?? box.left) - box.left, y: (rect?.bottom ?? box.top) - box.top + doc.current.scrollTop };
  };

  const sortInto = (p: { sourceId: string; start: number; end: number }, categoryId: string | null) => {
    const made = extract(project, p.sourceId, p, categoryId);
    if (!made) return;
    onCommit(made.project);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    const name = categoryId ? categoriesOf(project).find((c) => c.id === categoryId)?.name : 'no category';
    onSay(`Sorted into ${name}. Ctrl+Z takes it back.`);
  };

  // ------------------------------------------------------------ drops on a category

  const onDropTo = (e: React.DragEvent, categoryId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragged(e);
    endDrag();
    setOver(null);
    if (!d) return;
    if (d.kind === 'passage') sortInto(d, categoryId);
    else if (d.kind === 'note') onCommit(moveNote(project, d.noteId, categoryId));
  };
  const [over, setOver] = useState<string | null>(null);

  // ------------------------------------------------------------ categories

  const [renaming, setRenaming] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Record<string, string>>({});
  const tops = categoriesOf(project).filter((c) => !c.parentId);
  const loose = notesIn(project, null);
  const suggestion = suggestionsFor(project)[0];
  const pending = suggestionsFor(project).length;

  const bin = (c: Category | null) => {
    const id = c?.id ?? 'none';
    const subs = c ? childrenOf(project, c.id) : [];
    const within = c && filter[c.id] ? filter[c.id]! : c?.id ?? null;
    const all = searchNotes(project, query, c ? notesIn(project, within, true) : loose);
    const expanded = open.has(id) || !!query;
    const shown = expanded ? all : all.slice(0, 2);
    const count = c ? notesIn(project, c.id, true).length : loose.length;
    const becomes = c?.templateKey ? CATEGORY_TYPES[c.templateKey] : undefined;
    return (
      <section
        key={id}
        className={`ns-bin${over === id ? ' over' : ''}${count === 0 ? ' empty' : ''}${query && !all.length ? ' dim' : ''}`}
        aria-label={c ? `Category ${c.name}` : 'No category'}
        onDragOver={(e) => {
          if (!isOurs(e)) return;
          e.preventDefault();
          setOver(id);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
        }}
        onDrop={(e) => onDropTo(e, within)}
      >
        <header className="ns-bin-head">
          {becomes ? <Symbol type={becomes} size={13} /> : <span className="ns-bin-plus">+</span>}
          {c && renaming === c.id ? (
            <input
              className="inp ns-rename"
              aria-label="Category name"
              autoFocus
              defaultValue={c.name}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => {
                onCommit(renameCategory(project, c.id, e.currentTarget.value));
                setRenaming(null);
              }}
            />
          ) : (
            <span className="ns-bin-name" onDoubleClick={() => c && setRenaming(c.id)} title={c ? 'Double-click to rename' : undefined}>
              {c?.name ?? 'No category'}
            </span>
          )}
          <span className="ns-count">{count}</span>
          {c && (
            <span className="ns-bin-tools">
              <button className="icon-btn small" title="Add a subcategory" aria-label={`Add a subcategory to ${c.name}`} onClick={() => {
                const made = addCategory(project, 'New subcategory', c.id);
                onCommit(made.project);
                setRenaming(made.id);
              }}>
                +
              </button>
              <button
                className="icon-btn small"
                title="Remove the category (its cards go up a level)"
                aria-label={`Remove ${c.name}`}
                onClick={() => {
                  onCommit(removeCategory(project, c.id));
                  if (count) onSay(`${c.name} removed; its ${count} card${count === 1 ? '' : 's'} moved up. Ctrl+Z brings it back.`);
                }}
              >
                ×
              </button>
            </span>
          )}
        </header>
        {subs.length > 0 && (
          <div className="ns-chips">
            {subs.map((s) => (
              <button
                key={s.id}
                className={`ns-chip${filter[c!.id] === s.id ? ' on' : ''}${over === s.id ? ' over' : ''}`}
                aria-pressed={filter[c!.id] === s.id}
                onClick={() => setFilter((f) => ({ ...f, [c!.id]: f[c!.id] === s.id ? '' : s.id }))}
                onDoubleClick={() => setRenaming(s.id)}
                onDragOver={(e) => {
                  if (!isOurs(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setOver(s.id);
                }}
                onDrop={(e) => onDropTo(e, s.id)}
                title="Click to show only these; drop a passage here to sort into it"
              >
                {renaming === s.id ? (
                  <input
                    className="inp ns-rename"
                    aria-label="Subcategory name"
                    autoFocus
                    defaultValue={s.name}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      onCommit(renameCategory(project, s.id, e.currentTarget.value));
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <>
                    {s.name} <span className="ns-count">{notesIn(project, s.id, true).length}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="ns-bin-cards">
          {shown.map((n) => (
            <NoteCard key={n.id} project={project} note={n} compact onOpen={() => onOpenNote(n.id)} onSelect={() => onOpenNote(n.id)} />
          ))}
          {over === id && <div className="ns-drop-slot">Drop to add here</div>}
          {all.length > shown.length && (
            <button className="ns-more" onClick={() => setOpen((o) => new Set(o).add(id))}>
              + {all.length - shown.length} more
            </button>
          )}
          {expanded && !query && all.length > 2 && (
            <button className="ns-more" onClick={() => setOpen((o) => ((next) => (next.delete(id), next))(new Set(o)))}>
              Show fewer
            </button>
          )}
          {count === 0 && over !== id && <p className="ns-empty">Empty. Drag a passage here.</p>}
        </div>
      </section>
    );
  };

  // ------------------------------------------------------------ the raw notes

  const categoryName = (id: string | null) => (id ? categoriesOf(project).find((c) => c.id === id)?.name : undefined) ?? 'No category';

  const rawNotes = () => {
    if (!source) {
      return (
        <div className="ns-start">
          <h2>Bring in raw notes</h2>
          <p>Brainstorms, design docs, dictated ideas, lore: paste them or import .txt, .md or .docx files. They are never edited; what you sort out of them greys out here.</p>
          <div className="ns-start-actions">
            <button className="tb-btn primary" onClick={() => setImporting(true)}>
              + Import notes
            </button>
            <button
              className="tb-btn"
              onClick={() => {
                onCommit(withSampleNotes(project));
                onSay('A sample brainstorm is in, with Action-adventure categories to sort it into.');
              }}
            >
              Try a sample brainstorm
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="ns-doc"
        ref={doc}
        role="region"
        aria-label={`Raw notes: ${source.name}`}
        onMouseUp={() => setPicked(pickSelection())}
        onKeyUp={() => setPicked(pickSelection())}
        onDragStart={(e) => {
          // A highlighted passage dragged out of the notes.
          const p = pickSelection() ?? picked;
          if (!p || (e.target as HTMLElement).closest?.('.ns-grip')) return;
          startDrag(e, { kind: 'passage', sourceId: p.sourceId, start: p.start, end: p.end }, source.content.slice(p.start, p.end));
        }}
        onDragEnd={endDrag}
      >
        {passagesOf(source).map((p) => {
          const segments = segmentsOf(project, source, p);
          const taken = segments.filter((s) => s.notes.length);
          const all = taken.length > 0 && segments.every((s) => s.notes.length || !source.content.slice(s.start, s.end).trim());
          if (hideSorted && all) return null;
          const tags = [...new Set(taken.flatMap((s) => s.notes.map((n) => categoryName(n.categoryId))))];
          return (
            <div key={p.start} className={`ns-passage${all ? ' sorted' : ''}`} data-start={p.start} data-end={p.end}>
              <span className="ns-tags">{tags.length > 0 && <span className="ns-tag">{tags.join(' · ')}</span>}</span>
              <p className="ns-words" data-start={p.start} data-end={p.end}>
                {segments.map((s) => (
                  <span key={s.start} data-at={s.start} className={s.notes.length ? 'ns-taken' : undefined} title={s.notes.length ? `Sorted into ${[...new Set(s.notes.map((n) => categoryName(n.categoryId)))].join(', ')}` : undefined}>
                    {source.content.slice(s.start, s.end)}
                  </span>
                ))}
              </p>
              <span
                className="ns-grip"
                draggable
                role="button"
                tabIndex={0}
                aria-label={`Sort passage ¶${p.index}`}
                title="Drag the whole passage onto a category, or click to pick one"
                onDragStart={(e) => {
                  e.stopPropagation();
                  startDrag(e, { kind: 'passage', sourceId: source.id, start: p.start, end: p.end }, source.content.slice(p.start, p.end));
                }}
                onDragEnd={endDrag}
                onClick={(e) => {
                  const box = doc.current!.getBoundingClientRect();
                  const r = e.currentTarget.getBoundingClientRect();
                  setPicked({ sourceId: source.id, start: p.start, end: p.end, x: r.right - box.left, y: r.bottom - box.top + doc.current!.scrollTop });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
              >
                ⠿
              </span>
            </div>
          );
        })}
        {picked && (
          <div className="ns-pick" role="menu" aria-label="Sort into" style={{ left: Math.min(picked.x, 420), top: picked.y + 6 }} onMouseUp={(e) => e.stopPropagation()}>
            <span className="ns-pick-head">
              Sort “{source.content.slice(picked.start, picked.end).slice(0, 40)}
              {picked.end - picked.start > 40 ? '…' : ''}” into
            </span>
            {categoriesOf(project).map((c) => (
              <button key={c.id} role="menuitem" className={c.parentId ? 'sub' : ''} onClick={() => sortInto(picked, c.id)}>
                {c.name}
              </button>
            ))}
            {!categoriesOf(project).length && <span className="ns-pick-head">Add a category first, or load a template.</span>}
            <button role="menuitem" className="ghost" onClick={() => setPicked(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ns-sort">
      <section className="ns-raw" aria-label="Raw notes">
        <header className="ns-panel-head">
          <span className="ns-lbl">Raw notes</span>
          <span className="ns-muted">never edited · sorted text greys out</span>
          <span className="grow" />
          <label className="ns-check">
            <input type="checkbox" checked={hideSorted} onChange={(e) => setHideSorted(e.currentTarget.checked)} /> Hide sorted
          </label>
          <button className="tb-btn" onClick={() => setImporting(true)}>
            + Import
          </button>
        </header>
        {set.sources.length > 0 && (
          <div className="ns-sources" role="tablist" aria-label="Sources">
            {set.sources.map((s) => {
              const ratio = progressOf(project, s).ratio;
              return (
                <button key={s.id} role="tab" aria-selected={s.id === source?.id} className={`ns-source${s.id === source?.id ? ' on' : ''}`} onClick={() => setSourceId(s.id)}>
                  {s.name}
                  <span className="ns-source-bar">
                    <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                  <span className="ns-mono">{Math.round(ratio * 100)}%</span>
                </button>
              );
            })}
          </div>
        )}
        {rawNotes()}
      </section>

      <section className="ns-cats" aria-label="Categories">
        <header className="ns-panel-head">
          <span className="ns-lbl">Categories</span>
          <select
            className="inp ns-template"
            aria-label="Template"
            value=""
            onChange={(e) => {
              if (!e.currentTarget.value) return;
              const before = categoriesOf(project).length;
              const next = loadTemplate(project, e.currentTarget.value);
              onCommit(next);
              onSay(`${categoriesOf(next).length - before} categories added from the template.`);
            }}
          >
            <option value="">Template: {TEMPLATES.find((t) => t.key === set.template)?.name ?? 'choose…'}</option>
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="grow" />
          <input className="inp ns-search" type="search" aria-label="Search cards" placeholder="Search cards…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
          <button
            className="tb-btn"
            onClick={() => {
              const made = addCategory(project, 'New category');
              onCommit(made.project);
              setRenaming(made.id);
            }}
          >
            + Category
          </button>
        </header>
        {suggestion && (
          <div className="ns-suggest-strip" role="note">
            <span className="ns-spark" aria-hidden="true">
              ✺
            </span>
            <span>
              Suggestion: {suggestion.text} Nothing moves until you say so.
            </span>
            <button className="tb-btn small" onClick={onReview}>
              Review {pending}
            </button>
            <button className="icon-btn small" aria-label="Dismiss the suggestion" onClick={() => onCommit(dismissSuggestion(project, suggestion.id))}>
              ×
            </button>
          </div>
        )}
        <div className="ns-bins">
          {tops.map((c) => bin(c))}
          {loose.length > 0 && bin(null)}
          {!tops.length && (
            <div className="ns-start small">
              <p>No categories yet. Load a template above, or make your own with + Category.</p>
            </div>
          )}
        </div>
      </section>

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={(docs) => {
            let next = project;
            let first: string | null = null;
            for (const d of docs) {
              const made = importSource(next, d.name, d.content);
              next = made.project;
              first ??= made.id;
            }
            onCommit(next);
            if (first) setSourceId(first);
            setImporting(false);
            onSay(`${docs.length} source${docs.length === 1 ? '' : 's'} in. Highlight a passage and drag it onto a category.`);
          }}
        />
      )}
    </div>
  );
};

/** Bring notes in: pasted, or read from .txt, .md and .docx files. */
const ImportDialog = ({ onImport, onClose }: { onImport: (docs: { name: string; content: string }[]) => void; onClose: () => void }) => {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog wide ns-import" role="dialog" aria-modal="true" aria-label="Import notes" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Import notes</h2>
          <button className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="dialog-text">The notes come in exactly as they are and are never edited. Each line is a passage you can sort.</p>
        <label className="dfld">
          <span>Files</span>
          <input
            type="file"
            aria-label="Note files"
            multiple
            accept=".txt,.md,.markdown,.docx,text/plain,text/markdown"
            onChange={async (e) => {
              const files = [...(e.currentTarget.files ?? [])];
              const docs: { name: string; content: string }[] = [];
              const problems: string[] = [];
              for (const f of files) {
                try {
                  const content = await readNotesFile(f);
                  if (content.trim()) docs.push({ name: f.name.replace(/\.[^.]+$/, ''), content });
                  else problems.push(`${f.name} is empty.`);
                } catch (err) {
                  problems.push(err instanceof ReadError ? err.message : `${f.name} couldn’t be read.`);
                }
              }
              setError(problems.length ? problems.join(' ') : null);
              if (docs.length) onImport(docs);
            }}
          />
        </label>
        <div className="ns-or">or paste</div>
        <label className="dfld">
          <span>Name</span>
          <input className="inp" aria-label="Source name" placeholder="Voice memo · Sep 22" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="dfld">
          <span>Notes</span>
          <textarea className="inp ns-paste" aria-label="Pasted notes" rows={10} placeholder="Paste a brainstorm, a design doc, a transcript…" value={text} onChange={(e) => setText(e.currentTarget.value)} />
        </label>
        {error && <p className="ns-error">{error}</p>}
        <div className="dialog-actions">
          <button className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="tb-btn primary" disabled={!text.trim()} onClick={() => onImport([{ name: name.trim() || 'Pasted notes', content: text }])}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

