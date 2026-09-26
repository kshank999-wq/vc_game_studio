import { useEffect, useMemo, useState } from 'react';
import { VIEWS, viewCount, viewGroups, voProgress, type Entry, type ViewKey } from '../../model/bible';
import type { Destination } from '../../model/details';
import { makeObject, nextCode } from '../../model/project';
import { REPORTS, buildReport, type ReportKey } from '../../model/reports';
import { speakers, updateLine } from '../../model/scene';
import { TYPE_LABEL } from '../../model/semantics';
import { findIssues } from '../../model/validate';
import type { ObjectType, Project } from '../../model/types';
import { ElementDetail } from '../detail/ElementDetail';
import { Symbol } from '../Symbol';
import { ReportPreview } from './ReportPreview';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  /** The element to open on, when the Bible was opened from one. */
  focus?: string;
  onNavigate: (to: Destination) => void;
  onOpenCode?: (id: string) => void;
}

/** Views whose list can add a new canonical element straight from the Bible. */
const CREATES: Partial<Record<ViewKey, ObjectType>> = {
  characters: 'character',
  locations: 'environment',
  objects: 'object',
  puzzles: 'puzzle',
  logic: 'state',
};

const CREATE_CODE: Partial<Record<ObjectType, { prefix: string; pad: number }>> = {
  character: { prefix: 'CH-', pad: 2 },
  environment: { prefix: 'ENV-', pad: 2 },
  object: { prefix: 'OBJ-', pad: 2 },
  puzzle: { prefix: 'PZ-', pad: 2 },
  state: { prefix: 'ST-', pad: 2 },
};

const viewFor = (project: Project, id: string | undefined): ViewKey => {
  const type = id ? project.objects[id]?.type : undefined;
  if (!type) return id && project.lines.some((l) => l.id === id) ? 'dialogue' : 'all';
  return VIEWS.find((v) => v.types?.includes(type))?.key ?? 'all';
};

/**
 * The Game Bible (spec §19, mockup 06): the whole project as a catalogue.
 * Every view reads the same objects the graph and scenes use, so an edit
 * here is an edit everywhere; where-used links go back to each place.
 */
export const GameBible = ({ project, onCommit, focus, onNavigate, onOpenCode }: Props) => {
  const [view, setView] = useState<ViewKey>(() => viewFor(project, focus));
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'grouped' | 'list'>('grouped');
  const [exportOpen, setExportOpen] = useState(false);
  const [report, setReport] = useState<ReportKey | null>(null);

  useEffect(() => {
    if (focus) {
      setView(viewFor(project, focus));
      setSelected(focus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const groups = viewGroups(project, view, query);
  const entries = groups.flatMap((g) => g.entries);
  const issues = useMemo(() => new Map(findIssues(project).map((i) => [i.id, i.message])), [project]);
  const current = VIEWS.find((v) => v.key === view)!;
  const creates = CREATES[view];

  // Keep a selection that the view still shows; otherwise the first entry.
  const selection = selected && (project.objects[selected] || project.lines.some((l) => l.id === selected)) ? selected : (entries[0]?.id ?? null);

  const create = (type: ObjectType) => {
    const format = CREATE_CODE[type];
    const object = makeObject(type, `New ${TYPE_LABEL[type].split(' / ')[0]!.toLowerCase()}`, new Date().toISOString(), format ? { code: nextCode(project, format) } : {});
    onCommit({ ...project, objects: { ...project.objects, [object.id]: object } });
    setSelected(object.id);
    setQuery('');
  };

  const subtitle = (entry: Entry): string => {
    if (entry.kind === 'line') {
      const scene = project.objects[entry.line.sceneId];
      return `${scene?.data.code ?? ''} · #${entry.line.order} · VO ${entry.line.vo === 'recorded' ? 'recorded' : entry.line.vo === 'todo' ? 'to record' : '—'}`;
    }
    const o = entry.object;
    if (o.type === 'character') {
      const lines = project.lines.filter((l) => l.speakerId === o.id).length;
      const scenes = project.connections.filter((c) => c.kind === 'contains' && c.targetId === o.id).length;
      return [o.data.role, `${scenes} scene${scenes === 1 ? '' : 's'}`, `${lines} line${lines === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    }
    if (o.type === 'scene') return (o.data.summary as string | undefined) ?? `${project.connections.filter((c) => c.kind === 'contains' && c.sourceId === o.id).length} elements`;
    const scenes = project.connections.filter((c) => c.kind === 'contains' && c.targetId === o.id).length;
    return o.notes || (scenes ? `in ${scenes} scene${scenes === 1 ? '' : 's'}` : TYPE_LABEL[o.type]);
  };

  const row = (entry: Entry) => {
    const issue = issues.get(entry.id);
    const symbol: ObjectType = entry.kind === 'line' ? 'dialogue' : entry.object.type;
    const color = entry.kind === 'object' && entry.object.type === 'character' ? (entry.object.data.color as string | undefined) : undefined;
    return (
      <button key={entry.id} className={`bible-row${selection === entry.id ? ' on' : ''}`} onClick={() => setSelected(entry.id)}>
        <Symbol type={symbol} size={14} color={color} />
        <span className="bible-row-main">
          <span className="bible-row-name">{entry.kind === 'line' ? entry.line.text || '…' : entry.object.name}</span>
          <span className={`bible-row-sub${issue ? ' warn' : ''}`}>{issue ?? subtitle(entry)}</span>
        </span>
        {entry.kind === 'object' && entry.object.data.code && <span className="mono bible-row-code">{entry.object.data.code}</span>}
        {issue && <span className="issue-dot" aria-label={issue} />}
      </button>
    );
  };

  const line = selection ? project.lines.find((l) => l.id === selection) : undefined;
  const logicIssues = [...issues.keys()].filter((id) => ['trigger', 'gate', 'state'].includes(project.objects[id]?.type ?? '')).length;

  return (
    <div className="bible">
      <nav className="bible-views" aria-label="Bible views">
        <div className="lbl bible-views-title">Views</div>
        {VIEWS.map((v) => {
          const count = viewCount(project, v.key);
          const warn = v.key === 'logic' && logicIssues > 0;
          return (
            <button
              key={v.key}
              className={`bible-view${view === v.key ? ' on' : ''}`}
              aria-current={view === v.key}
              onClick={() => {
                setView(v.key);
                setSelected(null);
              }}
            >
              {v.key !== 'all' && <Symbol type={v.symbol} size={12} />}
              {v.label}
              <span className={`bible-count${warn ? ' warn' : ''}`}>
                {count}
                {warn ? ' !' : ''}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="bible-list" aria-label={current.label}>
        <div className="bible-list-head">
          <span className="bible-list-title">{current.label}</span>
          <div className="grow" />
          <div role="group" aria-label="Layout" className="view-toggle small">
            <button className={layout === 'list' ? 'on' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
              List
            </button>
            <button className={layout === 'grouped' ? 'on' : ''} aria-pressed={layout === 'grouped'} onClick={() => setLayout('grouped')}>
              Grouped
            </button>
          </div>
        </div>
        <label className="bible-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input aria-label="Search the Bible" placeholder={`Search ${current.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <div className="bible-rows">
          {entries.length === 0 && <p className="bible-empty">{query ? `Nothing matches “${query}”.` : 'Nothing here yet.'}</p>}
          {layout === 'grouped'
            ? groups.map((g) => (
                <div key={g.label}>
                  <div className="lbl bible-group">
                    {g.label} · {g.entries.length}
                  </div>
                  {g.entries.map(row)}
                </div>
              ))
            : entries.map(row)}
          {creates && (
            <button className="chip-add bible-new" onClick={() => create(creates)}>
              + New {TYPE_LABEL[creates].split(' / ')[0]!.toLowerCase()}
            </button>
          )}
        </div>
      </section>

      <section className="bible-detail">
        <div className="bible-toolbar">
          <div className="grow" />
          <div className="export-wrap">
            <button className="tb-btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 6V2h8v4M4 12H2V7h12v5h-2" />
                <rect x="4" y="10" width="8" height="4" />
              </svg>
              Print / Export ▾
            </button>
            {exportOpen && (
              <div className="add-menu export-menu" role="menu">
                <div className="menu-heading">PRODUCTION REPORTS</div>
                {REPORTS.map((r) => (
                  <button
                    key={r.key}
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      setReport(r.key);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="bible-detail-body">
          {line ? (
            <LineDetail project={project} lineId={line.id} onCommit={onCommit} onNavigate={onNavigate} />
          ) : selection && project.objects[selection] ? (
            <>
              <ElementDetail project={project} id={selection} onCommit={onCommit} onNavigate={onNavigate} onOpenCode={onOpenCode} variant="bible" />
              {project.objects[selection]!.type === 'character' && <VoMeter project={project} id={selection} />}
              {project.objects[selection]!.type === 'scene' && (
                <div className="detail-actions">
                  <button className="tb-btn small" onClick={() => onNavigate({ kind: 'scene', sceneId: selection, mode: 'open' })}>
                    Open scene
                  </button>
                  <button className="tb-btn small" onClick={() => onNavigate({ kind: 'scene', sceneId: selection, mode: 'timeline' })}>
                    Timeline
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="bible-empty">Pick something from the list.</p>
          )}
        </div>
      </section>

      {report && <ReportPreview report={buildReport(project, report)} projectName={project.name} onClose={() => setReport(null)} />}
    </div>
  );
};

/** Voice-over progress for a character: lines recorded out of lines to record. */
const VoMeter = ({ project, id }: { project: Project; id: string }) => {
  const { recorded, total } = voProgress(project.lines.filter((l) => l.speakerId === id));
  if (total === 0) return null;
  return (
    <div className="vo-meter">
      <span className="lbl">VO recorded</span>
      <span className="mono">
        {recorded} / {total}
      </span>
      <div className="vo-bar">
        <div style={{ width: `${(recorded / total) * 100}%` }} />
      </div>
    </div>
  );
};

/** A script line in Dialogue / Voice: the same line the script and timeline show. */
const LineDetail = ({ project, lineId, onCommit, onNavigate }: { project: Project; lineId: string; onCommit: (p: Project) => void; onNavigate: (to: Destination) => void }) => {
  const line = project.lines.find((l) => l.id === lineId)!;
  const scene = project.objects[line.sceneId];
  return (
    <aside className="detail detail-bible">
      <div className="detail-head">
        <span className="detail-symbol big">
          <Symbol type="dialogue" size={28} />
        </span>
        <div className="detail-names">
          <span className="detail-name static">Line #{line.order}</span>
          <span className="detail-kind">
            Dialogue · {scene?.data.code} {scene?.name}
          </span>
        </div>
      </div>
      <section className="detail-section">
        <label className="dfld">
          <span>Speaker</span>
          <select className="inp" value={line.speakerId ?? ''} onChange={(e) => onCommit(updateLine(project, line.id, { speakerId: e.currentTarget.value || null }))}>
            <option value="">No speaker</option>
            {speakers(project, line.sceneId).map(({ character, present }) => (
              <option key={character.id} value={character.id}>
                {character.name}
                {present ? '' : ' (not in scene)'}
              </option>
            ))}
          </select>
        </label>
        <label className="dfld">
          <span>Line</span>
          <textarea key={line.text} className="inp script-font" rows={3} defaultValue={line.text} onBlur={(e) => e.currentTarget.value !== line.text && onCommit(updateLine(project, line.id, { text: e.currentTarget.value }))} />
        </label>
        <label className="dfld">
          <span>Direction</span>
          <input key={line.direction} className="inp script-font" defaultValue={line.direction} placeholder="(wading forward)" onBlur={(e) => onCommit(updateLine(project, line.id, { direction: e.currentTarget.value.replace(/^\(|\)$/g, '').trim() }))} />
        </label>
        <div className="dfld">
          <span>VO / audio</span>
          <div className="chips">
            {(
              [
                ['todo', 'To record'],
                ['recorded', 'Recorded'],
                ['none', 'No VO'],
              ] as const
            ).map(([vo, label]) => (
              <button key={vo} className={`vo-chip${line.vo === vo ? ` on vo-${vo}` : ''}`} aria-pressed={line.vo === vo} onClick={() => onCommit(updateLine(project, line.id, { vo }))}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="dfld">
          <span>Notes</span>
          <textarea key={line.notes} className="inp" rows={2} defaultValue={line.notes} placeholder="Delivery, context for the actor…" onBlur={(e) => onCommit(updateLine(project, line.id, { notes: e.currentTarget.value }))} />
        </label>
      </section>
      <div className="detail-actions">
        <button className="tb-btn small" onClick={() => onNavigate({ kind: 'scene', sceneId: line.sceneId, mode: 'open' })}>
          Open in the script
        </button>
        <button className="tb-btn small" onClick={() => onNavigate({ kind: 'scene', sceneId: line.sceneId, mode: 'timeline' })}>
          Timeline
        </button>
      </div>
    </aside>
  );
};
