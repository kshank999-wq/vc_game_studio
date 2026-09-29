import { useEffect, useMemo, useState } from 'react';
import { KINDS, convertNote, suggestedKind, type Kind } from '../../model/notes/convert';
import { categoriesOf, linkNote, liveDestinations, longRefOf, mergeNotes, moveNote, noteById, notesIn, notesOf, refOf, removeNote, unlinkNote, updateNote } from '../../model/notes/sorter';
import { duplicatesOf } from '../../model/notes/suggest';
import { VERBS, type ExtractedNote, type Verb } from '../../model/notes/types';
import { TYPE_LABEL } from '../../model/semantics';
import type { Project } from '../../model/types';
import { Symbol } from '../Symbol';
import { NoteCard, StatusMark, dragged, endDrag, isOurs } from './parts';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onSay: (message: string) => void;
  noteId: string | null;
  onSelect: (noteId: string | null) => void;
  onShowSource: (note: ExtractedNote) => void;
  onOpenBible: (id: string) => void;
  /** Go and place what was just made. */
  onPlace: (noteId: string, objectId: string) => void;
}

/**
 * Step 2, Convert (HANDOFF §2, spec §7, §13): pick a category, pick a card,
 * refine its words (the source never changes), name it, link it to other
 * cards and objects, and say what it is. The suggested type is marked; the
 * designer chooses. A card can be converted more than once, and every object
 * it becomes points back to the same source words.
 */
export const ConvertTab = ({ project, onCommit, onSay, noteId, onSelect, onShowSource, onOpenBible, onPlace }: Props) => {
  const categories = categoriesOf(project);
  const selected = noteId ? noteById(project, noteId) : undefined;
  const [categoryId, setCategoryId] = useState<string | null>(selected?.categoryId ?? categories.find((c) => notesIn(project, c.id).length)?.id ?? categories[0]?.id ?? null);
  useEffect(() => {
    if (selected && selected.categoryId !== categoryId) setCategoryId(selected.categoryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);
  const cards = notesIn(project, categoryId);
  const note = selected ?? cards[0];

  const [over, setOver] = useState<{ id: string; merge: boolean } | null>(null);

  const onCardDrop = (e: React.DragEvent, target: ExtractedNote) => {
    e.preventDefault();
    const d = dragged(e);
    endDrag();
    const merge = over?.merge ?? false;
    setOver(null);
    if (!d || d.kind !== 'note' || d.noteId === target.id) return;
    if (merge) {
      onCommit(mergeNotes(project, target.id, d.noteId));
      onSelect(target.id);
      onSay('Merged: one card, both passages kept as its sources. Ctrl+Z splits them again.');
    } else onCommit(moveNote(project, d.noteId, target.categoryId, target.id));
  };

  return (
    <div className="ns-convert">
      <nav className="ns-rail" aria-label="Categories">
        <span className="ns-lbl">Categories</span>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`ns-rail-item${c.id === categoryId ? ' on' : ''}${c.parentId ? ' sub' : ''}${notesIn(project, c.id).length ? '' : ' none'}`}
            aria-current={c.id === categoryId}
            onClick={() => {
              setCategoryId(c.id);
              onSelect(notesIn(project, c.id)[0]?.id ?? null);
            }}
            onDragOver={(e) => isOurs(e) && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const d = dragged(e);
              endDrag();
              if (d?.kind === 'note') onCommit(moveNote(project, d.noteId, c.id));
            }}
          >
            {c.name}
            <span className="ns-count">{notesIn(project, c.id).length}</span>
          </button>
        ))}
        {notesIn(project, null).length > 0 && (
          <button className={`ns-rail-item${categoryId === null ? ' on' : ''}`} onClick={() => setCategoryId(null)}>
            No category <span className="ns-count">{notesIn(project, null).length}</span>
          </button>
        )}
        <div className="grow" />
        <div className="ns-key">
          <span>
            <StatusMark status="sorted" /> Sorted, still a note
          </span>
          <span>
            <Symbol type="object" size={12} /> Converted (its symbol)
          </span>
          <span>
            <StatusMark status="placed" /> Placed in the game
          </span>
        </div>
      </nav>

      <section className="ns-list" aria-label="Cards">
        <header className="ns-panel-head">
          <span className="ns-lbl">
            {categoryId ? categories.find((c) => c.id === categoryId)?.name : 'No category'} · {cards.length}
          </span>
          <span className="grow" />
          <span className="ns-muted">drag to reorder or merge</span>
        </header>
        <div className="ns-list-cards">
          {cards.map((c) => (
            <div
              key={c.id}
              className={`ns-list-slot${over?.id === c.id ? (over.merge ? ' merge' : ' before') : ''}`}
              onDragOver={(e) => {
                if (!isOurs(e)) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver({ id: c.id, merge: e.clientY > r.top + Math.min(18, r.height / 3) });
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => onCardDrop(e, c)}
            >
              <NoteCard project={project} note={c} selected={c.id === note?.id} onSelect={() => onSelect(c.id)} />
              {over?.id === c.id && over.merge && <span className="ns-merge-hint">Drop to merge</span>}
            </div>
          ))}
          {!cards.length && <p className="ns-empty">No cards here yet. Sort passages into this category first.</p>}
        </div>
      </section>

      {note ? (
        <CardEditor key={note.id} project={project} note={note} onCommit={onCommit} onSay={onSay} onSelect={onSelect} onShowSource={onShowSource} onOpenBible={onOpenBible} onPlace={onPlace} />
      ) : (
        <section className="ns-editor">
          <p className="ns-empty">Pick a card to refine it and say what it is.</p>
        </section>
      )}
    </div>
  );
};

const CardEditor = ({
  project,
  note,
  onCommit,
  onSay,
  onSelect,
  onShowSource,
  onOpenBible,
  onPlace,
}: {
  project: Project;
  note: ExtractedNote;
  onCommit: (p: Project) => void;
  onSay: (m: string) => void;
  onSelect: (id: string | null) => void;
  onShowSource: (note: ExtractedNote) => void;
  onOpenBible: (id: string) => void;
  onPlace: (noteId: string, objectId: string) => void;
}) => {
  const suggested = suggestedKind(project, note);
  const [kind, setKind] = useState<Kind | undefined>(suggested);
  const [linking, setLinking] = useState<Verb | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const dupes = useMemo(() => duplicatesOf(project, note), [project, note]);
  const became = liveDestinations(project, note);

  const targets = [
    ...notesOf(project)
      .notes.filter((n) => n.id !== note.id)
      .map((n) => ({ id: n.id, label: `Card · ${n.name || n.text.slice(0, 50)}`, type: undefined as undefined })),
    ...Object.values(project.objects)
      .filter((o) => o.type !== 'begin' && o.type !== 'end')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => ({ id: o.id, label: `${TYPE_LABEL[o.type]} · ${o.name}`, type: o.type })),
  ];
  const describe = (id: string) => {
    const o = project.objects[id];
    if (o) return { label: o.name, detail: TYPE_LABEL[o.type].toLowerCase(), type: o.type };
    const n = noteById(project, id);
    return { label: n ? n.name || n.text.slice(0, 50) : 'gone', detail: 'card', type: undefined };
  };

  const convert = () => {
    if (!kind) return;
    const made = convertNote(project, note.id, kind.key, note.name);
    if (!made) return;
    onCommit(made.project);
    onSay(`${note.name || 'The card'} is now a ${kind.label.toLowerCase()}, linked back to ${refOf(project, note)}. Place it in Build flow.`);
  };

  return (
    <>
      <section className="ns-editor" aria-label="The note">
        <span className="ns-lbl">The note</span>
        <textarea
          key={note.text}
          className="inp ns-note-text"
          aria-label="Note text"
          rows={4}
          defaultValue={note.text}
          onBlur={(e) => e.currentTarget.value !== note.text && onCommit(updateNote(project, note.id, { text: e.currentTarget.value }))}
        />
        <p className="ns-source-link">
          <span aria-hidden="true">⛓</span> From{' '}
          <button className="ns-link" onClick={() => onShowSource(note)}>
            {longRefOf(project, note)}
          </button>
          {note.merged?.length ? ` and ${note.merged.length} more passage${note.merged.length === 1 ? '' : 's'}` : ''} · edits here never change the source
        </p>
        <label className="ns-lbl" htmlFor={`name-${note.id}`}>
          Name it
        </label>
        <input
          id={`name-${note.id}`}
          key={note.name}
          className="inp"
          aria-label="Name"
          placeholder="Tether"
          defaultValue={note.name}
          onBlur={(e) => e.currentTarget.value !== (note.name ?? '') && onCommit(updateNote(project, note.id, { name: e.currentTarget.value.trim() || undefined }))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="ns-lbl">Connected to</span>
        {note.dependencies.map((d) => {
          const t = describe(d.targetId);
          return (
            <div key={`${d.verb}:${d.targetId}`} className="ns-dep">
              <span className="ns-verb">{d.verb}</span>
              {t.type && <Symbol type={t.type} size={12} />}
              <span className="ns-dep-name">{t.label}</span>
              <span className="ns-muted">{t.detail}</span>
              <button className="icon-btn small" aria-label={`Unlink ${t.label}`} onClick={() => onCommit(unlinkNote(project, note.id, d.verb, d.targetId))}>
                ×
              </button>
            </div>
          );
        })}
        <div className="ns-dep add">
          <span className="ns-muted">+ Link</span>
          {linking ? (
            <>
              <span className="ns-verb on">{linking}</span>
              <select
                className="inp"
                aria-label={`What it ${linking}`}
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.currentTarget.value) onCommit(linkNote(project, note.id, linking, e.currentTarget.value));
                  setLinking(null);
                }}
              >
                <option value="">Pick a card or an object…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button className="tb-btn small" onClick={() => setLinking(null)}>
                Cancel
              </button>
            </>
          ) : (
            VERBS.map((v) => (
              <button key={v} className="ns-verb" onClick={() => setLinking(v)}>
                {v}
              </button>
            ))
          )}
        </div>
        {dupes.length > 0 && (
          <div className="ns-dupe" role="note">
            <span>
              Possible duplicate: <b>“{dupes[0]!.text.slice(0, 70)}”</b> in {refOf(project, dupes[0]!)}.
            </span>
            <button className="tb-btn small" onClick={() => setComparing(comparing ? null : dupes[0]!.id)}>
              {comparing ? 'Close' : 'Compare'}
            </button>
          </div>
        )}
        {comparing && noteById(project, comparing) && (
          <div className="ns-compare" aria-label="Compare">
            {[note, noteById(project, comparing)!].map((n) => (
              <div key={n.id} className="ns-compare-col">
                <span className="ns-ref">{refOf(project, n)}</span>
                <p>{n.text}</p>
              </div>
            ))}
            <div className="ns-compare-actions">
              <button
                className="tb-btn small primary"
                onClick={() => {
                  onCommit(mergeNotes(project, note.id, comparing));
                  setComparing(null);
                  onSay('Merged into one card. Ctrl+Z splits them again.');
                }}
              >
                Merge
              </button>
              <button className="tb-btn small" onClick={() => setComparing(null)}>
                Keep both
              </button>
            </div>
          </div>
        )}
        {became.length > 0 && (
          <>
            <span className="ns-lbl">Became</span>
            {became.map((d, i) => {
              const o = project.objects[d.objectId];
              const line = !o && d.objectId ? project.lines.find((l) => l.id === d.objectId) : undefined;
              return (
                <div key={`${d.objectId}:${i}`} className="ns-became">
                  <Symbol type={d.objectType} size={13} />
                  <span>{o ? o.name : line ? `Line in ${project.objects[line.sceneId]?.name ?? 'a scene'}` : `Dialogue block${d.speaker ? ` · ${d.speaker}` : ''}`}</span>
                  <span className="ns-muted">{o ? TYPE_LABEL[o.type] : 'waiting for its scene'}</span>
                  <span className="grow" />
                  {o && (
                    <button className="tb-btn small" onClick={() => onOpenBible(o.id)}>
                      In the Bible
                    </button>
                  )}
                  <button className="tb-btn small" onClick={() => onPlace(note.id, d.objectId)}>
                    Place
                  </button>
                </div>
              );
            })}
          </>
        )}
        <div className="grow" />
        <footer className="ns-editor-foot">
          <span className="ns-muted">Source link kept.</span>
          <span className="grow" />
          <button
            className="tb-btn"
            title="Put the passage back into the raw notes, unsorted"
            onClick={() => {
              onCommit(removeNote(project, note.id));
              onSelect(null);
              onSay('The passage is back in the raw notes, unsorted. Ctrl+Z brings the card back.');
            }}
          >
            Unsort
          </button>
          <button className="tb-btn" onClick={() => onCommit(updateNote(project, note.id, { setAside: !note.setAside }))}>
            {note.setAside ? 'Bring back' : 'Set aside'}
          </button>
          <button className="tb-btn" onClick={() => setKind(undefined)}>
            Keep as note
          </button>
          <button className="tb-btn primary" disabled={!kind} onClick={convert}>
            {kind ? `Convert to ${kind.label}` : 'Choose what it is'}
          </button>
        </footer>
      </section>

      <aside className="ns-kinds" aria-label="What is it?">
        <header className="ns-panel-head">
          <span className="ns-lbl">What is it?</span>
          <span className="grow" />
          {suggested && <span className="ns-suggested">Suggested: {suggested.label}</span>}
        </header>
        {(['Story', 'World', 'Systems'] as const).map((group) => (
          <div key={group} className="ns-kind-group">
            <span className="ns-lbl small">{group}</span>
            <div className="ns-kind-grid">
              {KINDS.filter((k) => k.group === group).map((k) => (
                <button key={k.key} className={`ns-kind${kind?.key === k.key ? ' on' : ''}${suggested?.key === k.key ? ' suggested' : ''}`} aria-pressed={kind?.key === k.key} onClick={() => setKind(k)}>
                  <Symbol type={k.type} size={13} color={k.player ? '#E8E0C8' : undefined} />
                  {k.label}
                  {kind?.key === k.key && <span className="ns-tick">✓</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className={`ns-kind keep${!kind ? ' on' : ''}`} onClick={() => setKind(undefined)}>
          Keep it as a note for now
        </button>
        <div className="grow" />
        <p className="ns-muted small">One note can become more than one thing. Convert it again and both objects point back to the same source words.</p>
      </aside>
    </>
  );
};

