import { useMemo, useState } from 'react';
import { addPath, checkAllPaths, describeDecision, pathOf, removePath, updatePath } from '../../model/paths';
import type { Play } from '../../model/play';
import type { Project } from '../../model/types';

const nameOf = (project: Project, id: string) => {
  const o = project.objects[id];
  return o ? `${o.data.code ? `${o.data.code} ` : ''}${o.name}` : '?';
};

/**
 * Expected paths (spec §15): save the run in view as the way the story
 * should go, and check every saved path against the story as it is now:
 * each is played again with the same decisions, and says where it first goes
 * differently, and why. Show takes the play-through to where it broke.
 */
export const PathsPanel = ({ project, play, from, onCommit, onShow, onClose }: { project: Project; play: Play; from?: string; onCommit?: (project: Project) => void; onShow: (play: Play) => void; onClose: () => void }) => {
  const paths = project.paths ?? [];
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const results = useMemo(() => checkAllPaths(project), [project]);
  const passing = results.filter((r) => r.check.ok).length;
  const decisions = play.decisions ?? [];
  const suggested = `Path ${paths.length + 1}${play.cursor.at === 'end' ? ` · ${play.cursor.text}` : ''}`;
  return (
    <div className="play-codex play-paths" role="dialog" aria-label="Expected paths">
      <div className="play-codex-head">
        <span className="rule-label">Expected paths</span>
        <span className="pref-hint">Save a run as the way the story should go; after changing the story, check every path still goes that way.</span>
        <button className="tb-btn small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="play-codex-notes-actions">
        <input
          className="play-codex-search play-paths-name"
          aria-label="Name for this path"
          placeholder={suggested}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="tb-btn small"
          disabled={!onCommit}
          title={`${decisions.length} ${decisions.length === 1 ? 'decision' : 'decisions'} so far${play.cursor.at === 'end' ? ', to the end' : ''}`}
          onClick={() => {
            const path = pathOf(play, name.trim() || suggested, from);
            onCommit?.(addPath(project, path));
            setName('');
            setStatus(`Saved “${path.name}”: ${decisions.length} ${decisions.length === 1 ? 'decision' : 'decisions'}, through ${path.through.length} scenes and plot points${path.ending ? `, to “${path.ending.text}”` : ' (not to the end)'}.`);
          }}
        >
          Save this run
        </button>
      </div>
      {status && (
        <p className="play-note" role="status">
          {status}
        </p>
      )}
      {results.length === 0 ? (
        <p className="play-note">No expected paths yet. Play the way the story should go, then save the run.</p>
      ) : (
        <>
          <p className={`play-paths-summary${passing === results.length ? ' ok' : ' bad'}`} aria-label="Paths checked">
            {passing === results.length ? `All ${results.length} paths still go their way.` : `${results.length - passing} of ${results.length} paths go differently now.`}
          </p>
          <ul className="play-paths-list">
            {results.map(({ path, check }) => (
              <li key={path.id} className={`play-path${check.ok ? ' ok' : ' bad'}`}>
                <div className="play-path-head">
                  <span className="play-path-mark" aria-hidden="true">
                    {check.ok ? '✓' : '✗'}
                  </span>
                  <button className="link-btn play-path-name" aria-expanded={open === path.id} onClick={() => setOpen(open === path.id ? null : path.id)}>
                    {path.name}
                  </button>
                  <span className="pref-hint">
                    {path.decisions.length} {path.decisions.length === 1 ? 'decision' : 'decisions'}
                    {path.ending ? ` · ${path.ending.text}` : ''}
                  </span>
                  <div className="grow" />
                  {!check.ok && (
                    <button className="tb-btn small" title="Take the play-through to where this path goes differently" onClick={() => onShow(check.play)}>
                      Show
                    </button>
                  )}
                  <button
                    className="tb-btn small"
                    disabled={!onCommit}
                    title="Make the run in view this path's expected way (after a change made on purpose)"
                    onClick={() => {
                      onCommit?.(updatePath(project, path.id, play));
                      setStatus(`“${path.name}” now expects the run in view.`);
                    }}
                  >
                    Use this run
                  </button>
                  <button className="tb-btn small" disabled={!onCommit} aria-label={`Delete ${path.name}`} onClick={() => onCommit?.(removePath(project, path.id))}>
                    Delete
                  </button>
                </div>
                {!check.ok && <p className="play-path-problem">{check.problem}</p>}
                {open === path.id && (
                  <ol className="play-path-steps" aria-label={`${path.name}’s decisions`}>
                    {path.decisions.map((d, i) => (
                      <li key={i} className={i < check.followed || check.ok ? 'done' : i === check.followed ? 'broke' : ''}>
                        {describeDecision(project, d)}
                      </li>
                    ))}
                    {path.decisions.length === 0 && <li>No decisions: the story as it plays by itself.</li>}
                  </ol>
                )}
                {open === path.id && (check.extra.length > 0 || check.missed.length > 0) && (
                  <p className="pref-hint">
                    {check.extra.length > 0 && `Now also through ${check.extra.map((id) => nameOf(project, id)).join(', ')}. `}
                    {check.missed.length > 0 && `No longer through ${check.missed.map((id) => nameOf(project, id)).join(', ')}.`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
