import { useState } from 'react';
import {
  addComment,
  canRestore,
  commentsOn,
  describeRevision,
  historyOf,
  lastChange,
  removeComment,
  replyTo,
  restoreBefore,
  ROLES,
  roleLabel,
  setDone,
  whenLabel,
  whoLabel,
  type Comment,
  type Role,
  type Target,
} from '../../model/collab';
import type { Project } from '../../model/types';
import { usePreferences, whoAmI } from '../../preferences';

/** A comment or task with its replies, done box, reply and delete. */
export const CommentItem = ({ project, comment, onCommit, children }: { project: Project; comment: Comment; onCommit: (p: Project) => void; children?: React.ReactNode }) => {
  const prefs = usePreferences();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const task = comment.kind === 'task';
  return (
    <li className={`collab-comment${comment.done ? ' done' : ''}${task ? ' task' : ''}`}>
      <div className="collab-comment-head">
        {task ? (
          <label className="check collab-done">
            <input type="checkbox" checked={!!comment.done} aria-label={`Done: ${comment.text}`} onChange={(e) => onCommit(setDone(project, comment.id, e.currentTarget.checked, whoAmI(prefs)))} />
            <span className="collab-kind">Task{comment.for ? ` · ${roleLabel(comment.for)}` : ''}</span>
          </label>
        ) : (
          <span className="collab-kind">Comment</span>
        )}
        <span className="pref-hint">
          {whoLabel(comment.by)} · {whenLabel(comment.at)}
        </span>
        <div className="grow" />
        {!task && (
          <button className="link-btn small" onClick={() => onCommit(setDone(project, comment.id, !comment.done, whoAmI(prefs)))}>
            {comment.done ? 'Reopen' : 'Resolve'}
          </button>
        )}
        <button className="icon-btn small" aria-label={`Delete “${comment.text}”`} onClick={() => onCommit(removeComment(project, comment.id))}>
          ×
        </button>
      </div>
      <p className="collab-text">{comment.text}</p>
      {children}
      {comment.done && (
        <p className="pref-hint">
          {task ? 'Done' : 'Resolved'} by {whoLabel(comment.done.by)} · {whenLabel(comment.done.at)}
        </p>
      )}
      {(comment.replies ?? []).map((r) => (
        <div key={r.id} className="collab-reply">
          <span className="pref-hint">
            {whoLabel(r.by)} · {whenLabel(r.at)}
          </span>
          <p className="collab-text">{r.text}</p>
        </div>
      ))}
      {replying ? (
        <form
          className="collab-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            onCommit(replyTo(project, comment.id, reply, whoAmI(prefs)));
            setReply('');
            setReplying(false);
          }}
        >
          <input className="inp small" aria-label="Reply" autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
          <button className="tb-btn small" type="submit" disabled={!reply.trim()}>
            Reply
          </button>
        </form>
      ) : (
        <button className="link-btn small" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </li>
  );
};

/** Write a comment or a task on a target. */
const NewComment = ({ project, target, onCommit }: { project: Project; target: Target; onCommit: (p: Project) => void }) => {
  const prefs = usePreferences();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Comment['kind']>('comment');
  const [role, setRole] = useState<Role | ''>('');
  return (
    <form
      className="collab-form collab-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onCommit(addComment(project, target, text, whoAmI(prefs), { kind, ...(role ? { for: role } : {}) }).project);
        setText('');
      }}
    >
      <textarea className="inp small" rows={2} aria-label="New comment" placeholder={kind === 'task' ? 'What needs doing…' : 'Write a comment for the team…'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="collab-form-row">
        <select className="inp small" aria-label="Comment or task" value={kind} onChange={(e) => setKind(e.target.value as Comment['kind'])}>
          <option value="comment">Comment</option>
          <option value="task">Task</option>
        </select>
        {kind === 'task' && (
          <select className="inp small" aria-label="Task for" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
            <option value="">For anyone</option>
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                For the {r.label.toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <div className="grow" />
        <button className="tb-btn small primary" type="submit" disabled={!text.trim()}>
          {kind === 'task' ? 'Add task' : 'Comment'}
        </button>
      </div>
    </form>
  );
};

/**
 * Comments, tasks and the edit history of one thing (spec §16): who last
 * changed it, what each change was, and a way to bring back what it was
 * before a change.
 */
export const CommentsHistory = ({ project, target, onCommit, what = 'this' }: { project: Project; target: Target; onCommit: (p: Project) => void; what?: string }) => {
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [showDone, setShowDone] = useState(false);
  const comments = commentsOn(project, target);
  const open = comments.filter((c) => !c.done);
  const shown = showDone ? comments : open;
  const history = target.kind === 'code' ? [] : historyOf(project, target);
  const last = lastChange(project, target);
  const since = project.handoff?.last ? Date.parse(project.handoff.last.at) : NaN;
  const afterExport = last && Number.isFinite(since) && last.at > since;
  return (
    <div className="collab" aria-label={`Comments and history of ${what}`}>
      <div className="collab-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
          Comments{open.length ? ` · ${open.length}` : ''}
        </button>
        {target.kind !== 'code' && (
          <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            History{history.length ? ` · ${history.length}` : ''}
          </button>
        )}
      </div>
      {last && (
        <p className="pref-hint collab-owner">
          Last changed by {whoLabel(last.by)} · {whenLabel(last.at)}
          {afterExport && <span className="collab-after"> · after the last export to {project.handoff!.last!.engine}: the engine’s copy is behind</span>}
        </p>
      )}
      {tab === 'comments' ? (
        <>
          {shown.length > 0 && (
            <ul className="collab-list">
              {shown.map((c) => (
                <CommentItem key={c.id} project={project} comment={c} onCommit={onCommit} />
              ))}
            </ul>
          )}
          {comments.length > open.length && (
            <button className="link-btn small" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide' : 'Show'} {comments.length - open.length} done or resolved
            </button>
          )}
          <NewComment project={project} target={target} onCommit={onCommit} />
        </>
      ) : history.length === 0 ? (
        <p className="pref-hint">No changes recorded yet. Changes are recorded from now on, with your name (set it in Preferences).</p>
      ) : (
        <ol className="collab-history" aria-label={`History of ${what}`}>
          {history.map((rev) => (
            <li key={rev.id}>
              <div className="collab-comment-head">
                <span className="collab-kind">{describeRevision(rev)}</span>
                <div className="grow" />
                {canRestore(project, target, rev) && (
                  <button className="tb-btn small" title="Bring back what it was just before this change" onClick={() => onCommit(restoreBefore(project, target, rev.id))}>
                    {rev.kind === 'deleted' ? 'Restore' : 'Restore before this'}
                  </button>
                )}
              </div>
              <span className="pref-hint">
                {whoLabel(rev.by)} · {whenLabel(rev.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
