import { useState } from 'react';
import { staged } from '../../model/notes/convert';
import { liveDestinations, notesOf, passagesOf, refOf, standing, statusOf, updateNote } from '../../model/notes/sorter';
import { acceptSuggestion, dismissSuggestion, setSuggestionsOn, sourceProgress, suggestionsFor } from '../../model/notes/suggest';
import type { ExtractedNote, NoteStatus, Suggestion } from '../../model/notes/types';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project } from '../../model/types';
import { Symbol } from '../Symbol';
import { STATUS_LABEL, StatusMark } from './parts';
import type { Carry } from './BuildTab';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onSay: (message: string) => void;
  onPlace: (carry: Carry) => void;
  onConvert: (noteId: string) => void;
  onShowPassage: (sourceId: string, start: number) => void;
}

const FILTERS: NoteStatus[] = ['unsorted', 'sorted', 'converted', 'placed', 'setAside'];

const TITLE: Record<NoteStatus, [string, string]> = {
  unsorted: ['Unsorted', 'passages still plain text in the notes'],
  sorted: ['Sorted, still a note', 'cards that could still become something'],
  converted: ['Converted, not placed', 'ideas that could still get lost'],
  placed: ['Placed in the game', 'in the story, a level, a system or the Bible'],
  setAside: ['Set aside', 'out of the counts, never deleted'],
};

const SUGGESTION_HEAD: Record<Suggestion['kind'], string> = {
  duplicate: 'Possible duplicate',
  category: 'New category',
  destination: 'Where it might go',
  entity: 'Found in raw notes',
};

const ACTIONS: Record<Suggestion['kind'], [string, string]> = {
  duplicate: ['Merge', 'Keep both'],
  category: ['Add', 'Dismiss'],
  destination: ['Place there', 'Not now'],
  entity: ['Show me', 'Dismiss'],
};

interface Row {
  key: string;
  status: NoteStatus;
  type?: ObjectType;
  text: string;
  became?: string;
  from: string;
  sourceId: string;
  action?: { label: string; run: () => void };
}

/**
 * Step 4, Review (HANDOFF §4, spec §15, §16): where every note stands, how far
 * each source has got, and the list the designer asks for — by default the
 * converted cards not yet placed, the ideas most likely to get lost. On the
 * right, suggestions: nothing there changes the game until it's approved.
 */
export const ReviewTab = ({ project, onCommit, onSay, onPlace, onConvert, onShowPassage }: Props) => {
  const [filter, setFilter] = useState<NoteStatus>('converted');
  const [type, setType] = useState<string>('');
  const [sourceId, setSourceId] = useState<string>('');
  const set = notesOf(project);
  const counts = standing(project);
  const items = staged(project);

  const noteRow = (note: ExtractedNote): Omit<Row, 'action'> => {
    const d = liveDestinations(project, note)[0];
    const o = d ? project.objects[d.objectId] : undefined;
    return {
      key: note.id,
      status: statusOf(project, note),
      ...(d ? { type: d.objectType } : {}),
      text: note.name ? `${note.name}: ${note.text}` : note.text,
      ...(d ? { became: o ? `${TYPE_LABEL[o.type]}` : `Dialogue${d.speaker ? ` · ${d.speaker}` : ''}` } : {}),
      from: refOf(project, note),
      sourceId: note.sourceId,
    };
  };

  const rows: Row[] =
    filter === 'unsorted'
      ? set.sources.flatMap((source) =>
          passagesOf(source)
            .filter((p) => !set.notes.some((n) => [{ sourceId: n.sourceId, range: n.range }, ...(n.merged ?? [])].some((m) => m.sourceId === source.id && m.range.start < p.end && m.range.end > p.start)))
            .map((p) => ({
              key: `${source.id}:${p.start}`,
              status: 'unsorted' as const,
              text: source.content.slice(p.start, p.end),
              from: `${source.short} ¶${p.index}`,
              sourceId: source.id,
              action: { label: 'Sort', run: () => onShowPassage(source.id, p.start) },
            })),
        )
      : filter === 'converted' || filter === 'placed'
        ? items
            .filter((s) => (filter === 'placed' ? s.placed : !s.placed) && !s.note.setAside)
            .map((s) => {
              const o = project.objects[s.destination.objectId];
              return {
                ...noteRow(s.note),
                key: `${s.note.id}:${s.destination.objectId}`,
                status: filter,
                type: s.destination.objectType,
                became: o ? TYPE_LABEL[o.type] : `Dialogue${s.destination.speaker ? ` · ${s.destination.speaker}` : ''}`,
                ...(o ? { text: o.name === s.note.text ? o.name : `${o.name}: ${s.note.text}` } : {}),
                action: { label: filter === 'placed' ? 'Move' : 'Place', run: () => onPlace({ noteId: s.note.id, objectId: s.destination.objectId }) },
              };
            })
        : set.notes
            .filter((n) => statusOf(project, n) === filter)
            .map((n) => ({
              ...noteRow(n),
              action:
                filter === 'setAside'
                  ? { label: 'Bring back', run: () => onCommit(updateNote(project, n.id, { setAside: false })) }
                  : { label: 'Convert', run: () => onConvert(n.id) },
            }));

  const types = [...new Set(rows.map((r) => r.type).filter(Boolean))] as ObjectType[];
  const visible = rows.filter((r) => (!type || r.type === type) && (!sourceId || r.sourceId === sourceId));
  const suggestions = suggestionsFor(project);

  const act = (s: Suggestion) => {
    if (s.kind === 'entity') {
      const name = (s.payload.names as string[])[0]!;
      const source = set.sources.find((x) => x.content.includes(name.replace(/^the /, ''))) ?? set.sources[0];
      if (source) onShowPassage(source.id, Math.max(0, source.content.indexOf(name.replace(/^the /, ''))));
      onCommit(acceptSuggestion(project, s));
      return;
    }
    onCommit(acceptSuggestion(project, s));
    onSay(`${ACTIONS[s.kind][0]}: done. Ctrl+Z takes it back.`);
  };

  return (
    <div className="ns-review">
      <aside className="ns-standing" aria-label="Where every note stands">
        <span className="ns-lbl">Where every note stands</span>
        {FILTERS.map((f) => (
          <button key={f} className={`ns-filter${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            <StatusMark status={f} />
            {STATUS_LABEL[f]}
            <span className="grow" />
            <span className="ns-count">{counts[f]}</span>
          </button>
        ))}
        <span className="ns-lbl">Sources</span>
        {sourceProgress(project).map(({ source, progress, notes }) => {
          const total = progress.unsorted + progress.sorted + progress.converted + progress.placed + progress.setAside || 1;
          const pct = (n: number) => `${(n / total) * 100}%`;
          const state = progress.untouched === progress.passages ? 'just imported' : progress.untouched === 0 ? 'every passage sorted' : `partly sorted · ${progress.untouched} passage${progress.untouched === 1 ? '' : 's'} untouched`;
          return (
            <div key={source.id} className="ns-src" aria-label={`${source.name}: ${state}`}>
              <span className="ns-src-head">
                {source.name}
                <span className="ns-mono">
                  {notes} note{notes === 1 ? '' : 's'}
                </span>
              </span>
              <span className="ns-stack" aria-hidden="true">
                <span className="placed" style={{ width: pct(progress.placed) }} />
                <span className="converted" style={{ width: pct(progress.converted) }} />
                <span className="sorted" style={{ width: pct(progress.sorted + progress.setAside) }} />
              </span>
              <span className="ns-muted small">{state}</span>
            </div>
          );
        })}
        {!set.sources.length && <p className="ns-empty">No notes imported yet.</p>}
        <div className="grow" />
        <div className="ns-key">
          <span>
            <i className="ns-swatch placed" /> Placed
          </span>
          <span>
            <i className="ns-swatch converted" /> Converted
          </span>
          <span>
            <i className="ns-swatch sorted" /> Sorted
          </span>
          <span>
            <i className="ns-swatch unsorted" /> Unsorted
          </span>
        </div>
      </aside>

      <section className="ns-table-wrap" aria-label={TITLE[filter][0]}>
        <header className="ns-table-head">
          <h2>{TITLE[filter][0]}</h2>
          <span className="ns-count">{visible.length}</span>
          <span className="ns-muted">{TITLE[filter][1]}</span>
          <span className="grow" />
          <select className="inp" aria-label="Type" value={type} onChange={(e) => setType(e.currentTarget.value)}>
            <option value="">Type: all</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="inp" aria-label="Source" value={sourceId} onChange={(e) => setSourceId(e.currentTarget.value)}>
            <option value="">Source: all</option>
            {set.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </header>
        <table className="ns-table">
          <thead>
            <tr>
              <th aria-label="Status" />
              <th>Note</th>
              <th>Became</th>
              <th>From</th>
              <th aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key}>
                <td>{r.type && r.status !== 'placed' ? <Symbol type={r.type} size={13} /> : <StatusMark status={r.status} />}</td>
                <td className="ns-table-note">{r.text}</td>
                <td>{r.became && <span className="ns-became-chip">{r.became}</span>}</td>
                <td className="ns-mono">{r.from}</td>
                <td>
                  {r.action && (
                    <button className="tb-btn small" onClick={r.action.run}>
                      {r.action.label}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="ns-empty">Nothing here.</p>}
        {filter === 'converted' && visible.length > 0 && <p className="ns-muted">Placing opens Build flow with the card already picked up.</p>}
      </section>

      <aside className="ns-suggestions" aria-label="Suggestions">
        <header className="ns-panel-head">
          <span className="ns-spark" aria-hidden="true">
            ✺
          </span>
          <span className="ns-lbl">Suggestions · {suggestions.length}</span>
          <span className="grow" />
          <label className="ns-check">
            <input type="checkbox" checked={set.suggestionsOn} onChange={(e) => onCommit(setSuggestionsOn(project, e.currentTarget.checked))} /> On
          </label>
        </header>
        <p className="ns-muted">Nothing here changes your game until you approve it. Suggestions come from simple rules over your notes, worked out on this machine.</p>
        {suggestions.map((s) => (
          <div key={s.id} className="ns-suggestion" role="group" aria-label={SUGGESTION_HEAD[s.kind]}>
            <span className="ns-lbl small">{SUGGESTION_HEAD[s.kind]}</span>
            <p>{s.text}</p>
            <div className="ns-suggestion-actions">
              <button className="tb-btn small primary" onClick={() => act(s)}>
                {ACTIONS[s.kind][0]}
              </button>
              <button className="tb-btn small" onClick={() => onCommit(dismissSuggestion(project, s.id))}>
                {ACTIONS[s.kind][1]}
              </button>
            </div>
          </div>
        ))}
        {set.suggestionsOn && !suggestions.length && <p className="ns-empty">No suggestions right now.</p>}
      </aside>
    </div>
  );
};
