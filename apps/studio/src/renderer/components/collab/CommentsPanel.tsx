import { useState } from 'react';
import { allComments, changedSinceExport, describeRevision, describeTarget, parseTargetKey, ROLES, whenLabel, whoLabel, type Revision, type Role, type Target } from '../../model/collab';
import type { Project } from '../../model/types';
import { usePreferences } from '../../preferences';
import { CommentItem } from './CommentsHistory';

const KIND: Record<Target['kind'], string> = { object: 'Element', connection: 'Connection', level: 'Level', levelItem: 'Level item', code: 'Code' };

/** Every change recorded in the project, newest first. */
const recentChanges = (project: Project, limit = 60): { target: Target; rev: Revision }[] =>
  Object.entries(project.revisions ?? {})
    .flatMap(([key, list]) => list.map((rev) => ({ target: parseTargetKey(key), rev })))
    .sort((a, b) => b.rev.at - a.rev.at)
    .slice(0, limit);

/**
 * The project's comments and tasks in one place (spec §16), for a role or
 * everyone, and what has changed: the latest edits, and what changed after
 * the last export to an engine. Each opens the thing it is about.
 */
export const CommentsPanel = ({ project, onCommit, onGo, onClose }: { project: Project; onCommit: (p: Project) => void; onGo: (target: Target) => void; onClose: () => void }) => {
  const prefs = usePreferences();
  const [tab, setTab] = useState<'comments' | 'changes'>('comments');
  const [role, setRole] = useState<Role | ''>((prefs.authorRole as Role) || '');
  const [tasksOnly, setTasksOnly] = useState(false);
  const [done, setDone] = useState(false);
  const list = allComments(project, { ...(role ? { role } : {}), tasksOnly, done });
  const open = (project.comments ?? []).filter((c) => !c.done).length;
  const changes = recentChanges(project);
  const behind = changedSinceExport(project);
  const Go = ({ target }: { target: Target }) => {
    const t = describeTarget(project, target);
    return (
      <button className="link-btn collab-target" disabled={!t.exists && target.kind !== 'object'} title={t.detail} onClick={() => onGo(target)}>
        <span className="muted">{KIND[target.kind]} · </span>
        {t.label}
        {!t.exists && <span className="muted"> (deleted)</span>}
      </button>
    );
  };
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
    <div className="dialog wide collab-panel" role="dialog" aria-modal="true" aria-label="Comments and changes" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dialog-head">
        <h2>Comments and changes</h2>
        <button className="icon-btn small" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="collab-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
          Comments and tasks{open ? ` · ${open} open` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>
          Changes{behind.length ? ` · ${behind.length} since export` : ''}
        </button>
      </div>
      {tab === 'comments' ? (
        <>
          <div className="collab-form-row collab-filters">
            <select className="inp small" aria-label="Tasks for" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
              <option value="">Every role</option>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={tasksOnly} onChange={(e) => setTasksOnly(e.currentTarget.checked)} /> Tasks only
            </label>
            <label className="check">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.currentTarget.checked)} /> Show done and resolved
            </label>
          </div>
          {list.length === 0 ? (
            <p className="pref-hint">Nothing here. Comment on anything from its detail panel or inspector: a scene, a character, a branch, a level item, a generated file.</p>
          ) : (
            <ul className="collab-list" aria-label="All comments and tasks">
              {list.map((c) => (
                <CommentItem key={c.id} project={project} comment={c} onCommit={onCommit}>
                  <Go target={c.target} />
                </CommentItem>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {project.handoff?.last && (
            <p className={`pref-hint${behind.length ? ' collab-after' : ''}`}>
              {behind.length
                ? `${behind.length} ${behind.length === 1 ? 'thing has' : 'things have'} changed since the last export to ${project.handoff.last.engine} (${whenLabel(Date.parse(project.handoff.last.at))}). Export again to bring the engine up to date.`
                : `Nothing has changed since the last export to ${project.handoff.last.engine}.`}
            </p>
          )}
          {changes.length === 0 ? (
            <p className="pref-hint">No changes recorded yet.</p>
          ) : (
            <ol className="collab-history" aria-label="Recent changes">
              {changes.map(({ target, rev }) => (
                <li key={rev.id}>
                  <div className="collab-comment-head">
                    <Go target={target} />
                    <div className="grow" />
                    <span className="pref-hint">
                      {whoLabel(rev.by)} · {whenLabel(rev.at)}
                    </span>
                  </div>
                  <span className="collab-kind">{describeRevision(rev)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
    </div>
  );
};
