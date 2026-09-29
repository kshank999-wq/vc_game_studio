import { useState } from 'react';
import { notesOf, standing } from '../../model/notes/sorter';
import type { ExtractedNote } from '../../model/notes/types';
import type { Project } from '../../model/types';
import { BuildTab, type Carry } from './BuildTab';
import { ConvertTab } from './ConvertTab';
import { ReviewTab } from './ReviewTab';
import { SortTab } from './SortTab';
import './notes.css';

export type NotesTab = 'sort' | 'convert' | 'build' | 'review';

const TABS: [NotesTab, string][] = [
  ['sort', 'Sort'],
  ['convert', 'Convert'],
  ['build', 'Build flow'],
  ['review', 'Review'],
];

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onUndo: () => void;
  canUndo: boolean;
  onOpenBible: (focus?: string) => void;
  onSay: (message: string) => void;
}

/**
 * The Note Sorter (Note Sorter spec, HANDOFF): bring raw notes in and turn
 * them into the game. The spec's pipeline (Raw Notes → Extract → Categorize
 * → Refine → Map → Build) is folded into four steps — Sort, Convert, Build
 * flow, Review — which are views, not a wizard: any of them, any time.
 * Everything commits to the project, so the studio's Undo covers it all.
 */
export const NoteSorter = ({ project, onCommit, onUndo, canUndo, onOpenBible, onSay }: Props) => {
  const set = notesOf(project);
  const [tab, setTab] = useState<NotesTab>(set.notes.length && !set.notes.some((n) => !n.destinations.length) ? 'build' : 'sort');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [show, setShow] = useState<{ sourceId: string; start: number } | null>(null);
  const counts = standing(project);
  const sortedPassages = counts.passages - counts.unsorted;
  const placed = counts.placed;
  const cards = set.notes.length || 1;

  const showSource = (sourceId: string, start: number) => {
    setShow({ sourceId, start });
    setTab('sort');
  };
  const showNote = (note: ExtractedNote) => showSource(note.sourceId, note.range.start);

  return (
    <div className="ns" data-tab={tab}>
      <header className="ns-head">
        <span className="ns-brand">Note sorter</span>
        <span className="ns-project">{project.name}</span>
        <nav className="ns-steps" role="tablist" aria-label="Steps">
          {TABS.map(([key, label], i) => (
            <button key={key} role="tab" aria-selected={tab === key} className={`ns-step${tab === key ? ' on' : ''}`} onClick={() => setTab(key)}>
              <span className="ns-step-n">{i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <span className="grow" />
        {set.sources.length > 0 && (
          <span className="ns-progress" aria-label={tab === 'build' ? `${placed} placed` : `${sortedPassages} of ${counts.passages} sorted`}>
            <span className="ns-progress-bar" aria-hidden="true">
              <span className="placed" style={{ width: `${(counts.placed / cards) * (sortedPassages / (counts.passages || 1)) * 100}%` }} />
              <span className="converted" style={{ width: `${(counts.converted / cards) * (sortedPassages / (counts.passages || 1)) * 100}%` }} />
              <span className="sorted" style={{ width: `${((counts.sorted + counts.setAside) / cards) * (sortedPassages / (counts.passages || 1)) * 100}%` }} />
            </span>
            {tab === 'build' ? `${placed} placed` : `${sortedPassages} of ${counts.passages} sorted`}
          </span>
        )}
        <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
      </header>
      <div className="ns-body">
        {tab === 'sort' && (
          <SortTab
            project={project}
            onCommit={onCommit}
            onSay={onSay}
            onOpenNote={(id) => {
              setNoteId(id);
              setTab('convert');
            }}
            onReview={() => setTab('review')}
            show={show}
          />
        )}
        {tab === 'convert' && (
          <ConvertTab
            project={project}
            onCommit={onCommit}
            onSay={onSay}
            noteId={noteId}
            onSelect={setNoteId}
            onShowSource={showNote}
            onOpenBible={onOpenBible}
            onPlace={(n, o) => {
              setCarry({ noteId: n, objectId: o });
              setTab('build');
            }}
          />
        )}
        {tab === 'build' && (
          <BuildTab
            project={project}
            onCommit={onCommit}
            onSay={onSay}
            carry={carry}
            onCarry={setCarry}
            onConvert={(id) => {
              setNoteId(id);
              setTab('convert');
            }}
            onShowSource={showNote}
            onReview={() => setTab('review')}
          />
        )}
        {tab === 'review' && (
          <ReviewTab
            project={project}
            onCommit={onCommit}
            onSay={onSay}
            onPlace={(c) => {
              setCarry(c);
              setTab('build');
            }}
            onConvert={(id) => {
              setNoteId(id);
              setTab('convert');
            }}
            onShowPassage={showSource}
          />
        )}
      </div>
    </div>
  );
};
