import { useRef, useState } from 'react';
import { parse, readText } from '../../files';
import { applyMerge, claimOf, mergePlan, workingCopyOf, type MergePlan, type Side } from '../../model/level/coop';
import type { Project } from '../../model/types';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const STATE: Record<string, string> = { same: 'as it was', added: 'added', changed: 'changed', removed: 'removed' };

/**
 * Working on a structure together (structure spec V2): claim it, hand it out
 * as a working copy (a project file the teammate opens as usual), send a
 * working copy back, and merge one back here, choosing each conflict.
 */
export const TeamDialog = ({
  project,
  levelId,
  levelName,
  me,
  onClaim,
  onRelease,
  onHandOut,
  onSendBack,
  onMerged,
  onClose,
}: {
  project: Project;
  levelId: string;
  levelName: string;
  /** Your name, from Preferences. */
  me: string;
  onClaim: (by: string) => void;
  onRelease: () => void;
  onHandOut: (to: string) => void;
  onSendBack: () => void;
  onMerged: (project: Project, taken: number, kept: number) => void;
  onClose: () => void;
}) => {
  const claim = claimOf(project, levelId);
  const working = workingCopyOf(project);
  const [name, setName] = useState(me);
  const [to, setTo] = useState('');
  const [copy, setCopy] = useState<Project | null>(null);
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [problem, setProblem] = useState('');
  const [choices, setChoices] = useState<Record<string, Side>>({});
  const file = useRef<HTMLInputElement>(null);
  const read = async (files: FileList | null) => {
    const f = files?.[0];
    if (file.current) file.current.value = '';
    if (!f) return;
    const p = parse(await readText(f));
    if (!p) {
      setProblem('That isn’t a VC Game Studio project file.');
      return;
    }
    const got = mergePlan(project, p);
    if (!('entries' in got)) {
      setProblem(got.problems[0] ?? 'That can’t be merged here.');
      setPlan(null);
      return;
    }
    setProblem('');
    setCopy(p);
    setPlan(got);
    setChoices({});
  };
  const theirs = plan ? plan.entries.filter((e) => e.take === 'theirs') : [];
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form className="dialog lvl-world-dialog lvl-team" role="dialog" aria-modal="true" aria-label="Work on it together" onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => e.preventDefault()}>
        <div className="dialog-head">
          <h2>Work on {levelName} together</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {working && (
          <div className="lvl-team-block" role="note">
            <p>
              <strong>This is a working copy</strong> of {working.levelName}, handed out from {working.from} by {working.by} to {working.to} on {when(working.at)}. Only {working.levelName} goes back when it is merged; anything else you change here stays here.
            </p>
            {working.levelId === levelId && (
              <button type="button" className="tb-btn primary small" onClick={onSendBack}>
                Send it back (save the copy to give {working.by})
              </button>
            )}
          </div>
        )}
        <div className="lvl-team-block">
          <h3>Who is working on it</h3>
          <p role="status">{claim ? `${claim.by} has claimed it, since ${when(claim.at)}${claim.copyId ? ', with a working copy' : ''}.${claim.note ? ` “${claim.note}”` : ''}` : 'Nobody has claimed it.'}</p>
          <div className="lvl-structure-actions">
            <input className="inp small" aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="tb-btn small" disabled={!name.trim()} onClick={() => onClaim(name)}>
              Claim it
            </button>
            {claim && (
              <button type="button" className="tb-btn small" onClick={onRelease}>
                Release the claim
              </button>
            )}
          </div>
          <p className="pref-hint">A claim tells everyone who opens the project that someone is on it. It warns; it doesn’t lock.</p>
        </div>
        {!working && (
          <div className="lvl-team-block">
            <h3>Hand out a working copy</h3>
            <div className="lvl-structure-actions">
              <input className="inp small" aria-label="Hand out to" placeholder="Their name" value={to} onChange={(e) => setTo(e.target.value)} />
              <button type="button" className="tb-btn small" disabled={!to.trim()} onClick={() => onHandOut(to)}>
                Hand out a working copy
              </button>
            </div>
            <p className="pref-hint">Saves a project file to give them, with {levelName} as it is now kept inside, and claims it for them. They open it as usual, work, and send it back.</p>
          </div>
        )}
        <div className="lvl-team-block">
          <h3>Merge a working copy back</h3>
          <button type="button" className="tb-btn small" onClick={() => file.current?.click()}>
            Open the working copy…
          </button>
          <input ref={file} type="file" accept=".vcgs,application/json" hidden aria-label="Working copy file" onChange={(e) => void read(e.target.files)} />
          {problem && <p className="lvl-issue warning">{problem}</p>}
          {plan && copy && (
            <>
              <p role="status" aria-label="Merge summary">
                From {plan.from.to}: {theirs.length} {theirs.length === 1 ? 'change' : 'changes'} to take, {plan.conflicts.length} {plan.conflicts.length === 1 ? 'conflict' : 'conflicts'}
                {plan.objects.length ? `, ${plan.objects.length} new story ${plan.objects.length === 1 ? 'object' : 'objects'}` : ''}.
              </p>
              {plan.problems.map((p, n) => (
                <p key={n} className="lvl-issue warning">
                  {p}
                </p>
              ))}
              {theirs.length > 0 && (
                <details>
                  <summary>Their changes</summary>
                  <ul className="lvl-team-list">
                    {theirs.map((e) => (
                      <li key={e.id}>
                        {e.name}: {STATE[e.theirs]}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {plan.conflicts.length > 0 && (
                <ul className="lvl-team-list" aria-label="Conflicts">
                  {plan.conflicts.map((c) => (
                    <li key={c.id} className="lvl-team-conflict">
                      <span>
                        <strong>{c.name}</strong>: {STATE[c.mine]} here, {STATE[c.theirs]} by {plan.from.to}
                        {c.fields?.length ? ` (${c.fields.join(', ')})` : ''}
                      </span>
                      <span role="radiogroup" aria-label={`Keep for ${c.name}`} className="view-toggle">
                        {(['mine', 'theirs'] as const).map((side) => (
                          <button key={side} type="button" role="radio" aria-checked={(choices[c.id] ?? 'mine') === side} className={(choices[c.id] ?? 'mine') === side ? 'on' : ''} onClick={() => setChoices((x) => ({ ...x, [c.id]: side }))}>
                            {side === 'mine' ? 'Keep mine' : 'Take theirs'}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="tb-btn primary"
                  onClick={() => {
                    const out = applyMerge(project, copy, choices);
                    onMerged(out.project, out.taken, out.kept);
                  }}
                >
                  Merge
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
};
