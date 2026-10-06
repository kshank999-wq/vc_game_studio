import { CommentsHistory } from '../collab/CommentsHistory';
import { openCount } from '../../model/collab';
import { useEffect, useMemo, useState } from 'react';
import type { Destination } from '../../model/details';
import { ENGINES, hunksOf, lineDiff, planHandoff, recordExport, reviewSend, setTarget, type Row, type SendFile, type SendReview } from '../../model/handoff';
import { levelsOf } from '../../model/level/level';
import type { OutputGroup } from '../../model/handoff/engines';
import { zip } from '../../model/handoff/zip';
import { CAPABILITIES, SUPPORT_LABEL } from '../../model/handoff/capabilities';
import type { Project } from '../../model/types';
import { desktop } from '../../desktop';
import { canPickFolder, pickBrowserFolder, type FolderAccess } from '../../folder-access';
import { canExport, isPreview, licenseBridge, PURCHASE_URL } from '../../edition';
import { useNav } from '../../nav';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  /** Handoff settings and the export record change without an undo step. */
  onReplace: (project: Project) => void;
  onNavigate: (to: Destination) => void;
  onSay: (message: string) => void;
  /** An element to show the code for, when opened from its detail. */
  focus?: string;
  /** Comments on generated files are project edits (spec §16). */
  onCommit?: (project: Project) => void;
}

const GROUPS: OutputGroup[] = ['Story', 'People + words', 'World', 'Logic'];
const STATUS_LABEL = { ready: 'Ready', changed: 'Changed', issue: 'Issue' } as const;

/** Where an export goes: the desktop app's folder, or one the browser may write to. */
interface SendTarget {
  label: string;
  read: (paths: readonly string[]) => Promise<Record<string, string | null>>;
  write: (files: readonly { path: string; content: string }[]) => Promise<number>;
  /** The desktop folder's path, to remember as the project folder. */
  folder?: string;
  /** Whether the last export's record describes this folder (to notice edits made in the engine). */
  sameAsLast: boolean;
}

/** A file's changes, a few lines around each. */
const DiffView = ({ file }: { file: SendFile }) => {
  const hunks = hunksOf(lineDiff(file.before ?? '', file.content));
  return (
    <div className="review-diff" aria-label={`Changes to ${file.path}`}>
      {hunks.length === 0 && <p className="handoff-note">No changes.</p>}
      {hunks.map((h, n) => (
        <pre key={n} className="review-hunk">
          <span className="review-at">Line {h.at}</span>
          {h.lines.map((l, i) => (
            <span key={i} className={`review-line ${l.kind}`}>
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
              {l.text}
              {'\n'}
            </span>
          ))}
        </pre>
      ))}
    </div>
  );
};

const saveZip = (name: string, files: { path: string; content: string }[]) => {
  const blob = new Blob([zip(files)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * The engine handoff (HANDOFF iteration 2, mockup 08): pick the engine you
 * work in, see what every element becomes there, read the code if you like
 * (it's generated, read-only, and hideable), and send it once the checks are
 * clear: Godot 4, Unity 6, Unreal Engine 5, or plain JSON for any other engine.
 */
export const EngineHandoff = ({ project, onReplace, onNavigate, onSay, focus, onCommit }: Props) => {
  const plan = useMemo(() => planHandoff(project), [project]);
  const bridge = desktop();
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [fileIndex, setFileIndex] = useState(0);
  const [codeHidden, setCodeHidden] = useState(false);
  const [folderState, setFolderState] = useState<{ exists: boolean; engineProject: boolean; unity?: boolean; unreal?: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  // The review before writing over an earlier export (spec §13), and the file whose changes are shown.
  const [review, setReview] = useState<{ dest: SendTarget; review: SendReview; open: string | null } | null>(null);
  // A folder the browser may write to, once picked (for this visit).
  const [browserFolder, setBrowserFolder] = useState<FolderAccess | null>(null);
  const nav = useNav();
  const { adapter, target, output } = plan;

  useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);

  useEffect(() => {
    if (!bridge || !target.projectFolder) {
      setFolderState(null);
      return;
    }
    void bridge.checkFolder(target.projectFolder).then(setFolderState);
  }, [bridge, target.projectFolder]);

  const row: Row | undefined = plan.rows.find((r) => r.id === selected) ?? plan.rows.find((r) => r.symbol === 'choice') ?? plan.rows[0];
  const files = row ? row.files.map((path) => output?.files.find((f) => f.path === path)).filter((f): f is NonNullable<typeof f> => !!f) : [];
  const file = files[Math.min(fileIndex, files.length - 1)];
  const issueCount = plan.rows.filter((r) => r.status === 'issue').length;
  const last = project.handoff?.last?.engine === target.engine ? project.handoff.last : undefined;
  const engineName = adapter.name.split(' ')[0]!;
  const levelSet = levelsOf(project);
  const levelName = (id: string) => levelSet.levels.find((l) => l.id === id)?.name ?? levelSet.items.find((i) => i.id === id)?.name;
  const { added, changed: changedItems, removed } = plan.levelChanges;
  const itemName = (guid: string) => plan.levels.flatMap((l) => l.items).find((i) => i.guid === guid)?.name ?? 'An item';

  const pickFolder = async () => {
    if (!bridge) return;
    const folder = await bridge.pickFolder();
    if (folder) onReplace(setTarget(project, { projectFolder: folder }));
  };

  const desktopDest = (folder: string): SendTarget => ({
    label: folder,
    folder,
    read: async (paths) => (bridge?.readFiles ? bridge.readFiles(folder, [...paths]) : {}),
    write: async (files) => (await bridge!.writeFiles(folder, [...files])).written,
    sameAsLast: folder === target.projectFolder,
  });

  /** Write what the review says: each file with the custom code carried over; files changed in the engine that the person keeps are left out. */
  const writeReviewed = async (dest: SendTarget, r: SendReview, keepEdited: boolean) => {
    const kept = keepEdited ? r.edited : [];
    const written = await dest.write(r.files.filter((f) => !kept.includes(f.path)).map((f) => ({ path: f.path, content: f.content })));
    onReplace(recordExport(dest.folder ? setTarget(project, { projectFolder: dest.folder }) : project, plan, undefined, kept));
    const custom = r.kept ? ` Kept your custom code in ${r.kept} ${r.kept === 1 ? 'place' : 'places'}.` : '';
    onSay(`Sent ${written} files to ${dest.label}.${kept.length ? ` Left ${kept.length} as ${engineName} had ${kept.length === 1 ? 'it' : 'them'}.` : ''}${custom}`);
  };

  /** Look at what is there first: writing over an earlier export is reviewed, and never replaces custom code or engine edits silently. */
  const sendTo = async (dest: SendTarget) => {
    const onDisk = await dest.read(output!.files.map((f) => f.path));
    const r = reviewSend(output!.files, onDisk, dest.sameAsLast ? last : undefined);
    if (r.files.some((f) => f.status === 'changed') || r.edited.length || r.lost.length) {
      setReview({ dest, review: r, open: r.files.find((f) => f.edited)?.path ?? null });
      return;
    }
    await writeReviewed(dest, r, false);
  };

  const send = async () => {
    if (!output || plan.blocking.length || sending) return;
    setSending(true);
    try {
      if (bridge) {
        let folder = target.projectFolder;
        if (!folder) {
          folder = (await bridge.pickFolder()) ?? '';
          if (!folder) return;
        }
        await sendTo(desktopDest(folder));
      } else if (browserFolder) {
        await sendTo({ label: browserFolder.name, read: browserFolder.read, write: browserFolder.write, sameAsLast: true });
      } else {
        saveZip(`${plan.adapter.id}-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, output.files);
        onReplace(recordExport(project, plan));
        onSay(`Downloaded ${output.files.length} files. Unzip them into your ${engineName} project folder.`);
      }
    } catch (error) {
      onSay(error instanceof Error ? error.message : 'Sending failed.');
    } finally {
      setSending(false);
    }
  };

  const confirm = async (keepEdited: boolean) => {
    if (!review) return;
    const { dest, review: r } = review;
    setReview(null);
    setSending(true);
    try {
      await writeReviewed(dest, r, keepEdited);
    } catch (error) {
      onSay(error instanceof Error ? error.message : 'Sending failed.');
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      onSay('Copied.');
    } catch {
      onSay('Copying isn’t allowed here. Select the code and copy it instead.');
    }
  };

  return (
    <div className={`handoff${codeHidden || !output ? ' no-code' : ''}`}>
      <aside className="handoff-target" aria-label="Target engine">
        <div className="lbl">You’re working in</div>
        <div className="engines" role="radiogroup" aria-label="Engine">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={target.engine === e.id}
              disabled={!e.available}
              className={`engine${target.engine === e.id ? ' on' : ''}`}
              title={e.plan}
              onClick={() => onReplace(setTarget(project, { engine: e.id }))}
            >
              <span className="radio" />
              <span className="engine-names">
                <span className="engine-name">{e.name}</span>
                <span className="engine-lang">{e.language}</span>
              </span>
              <span className={`engine-state${e.available ? '' : ' later'}`}>{e.available ? (target.engine === e.id ? 'selected' : '') : 'coming later'}</span>
            </button>
          ))}
        </div>

        <div className="lbl">Output</div>
        <div className="kv">
          <span>Project folder</span>
          {bridge ? (
            <span className="kv-value">
              <span className="mono folder" title={target.projectFolder || undefined}>
                {target.projectFolder ? target.projectFolder.split(/[\\/]/).filter(Boolean).pop() + '/' : 'Not chosen'}
              </span>
              <button className="tb-btn small" onClick={pickFolder}>
                Choose…
              </button>
            </span>
          ) : canPickFolder() ? (
            <span className="kv-value">
              <span className="mono folder" title={browserFolder ? browserFolder.name : 'Downloads as a .zip, or choose a folder to send to'}>
                {browserFolder ? `${browserFolder.name}/` : 'A .zip download'}
              </span>
              <button className="tb-btn small" onClick={() => void pickBrowserFolder().then((f) => f && setBrowserFolder(f))}>
                Choose…
              </button>
            </span>
          ) : (
            <span className="kv-value muted">Downloads as a .zip in the browser</span>
          )}
        </div>
        {folderState && !folderState.exists && adapter.id === 'custom' && <p className="handoff-note warn">That folder isn’t there any more.</p>}
        {folderState && adapter.id === 'unity' && !folderState.unity && (
          <p className="handoff-note warn">{folderState.exists ? 'That folder isn’t a Unity project (it has no Assets and ProjectSettings). Choose your Unity project’s folder.' : 'That folder isn’t there any more.'}</p>
        )}
        {folderState && adapter.id === 'unreal' && !folderState.unreal && (
          <p className="handoff-note warn">{folderState.exists ? 'That folder has no .uproject file. Choose your Unreal project’s folder.' : 'That folder isn’t there any more.'}</p>
        )}
        {folderState && !folderState.engineProject && adapter.id === 'godot' && (
          <p className="handoff-note warn">{folderState.exists ? `There’s no project.godot in that folder. Choose your ${engineName} project’s folder.` : 'That folder isn’t there any more.'}</p>
        )}
        <label className="kv">
          <span>Generated into</span>
          <input
            key={target.outputPath}
            className="inp mono small"
            defaultValue={target.outputPath}
            aria-label="Generated into"
            onBlur={(e) => e.currentTarget.value.trim() && onReplace(setTarget(project, { outputPath: e.currentTarget.value.trim() }))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <div className="kv">
          <span>Runtime</span>
          <span className="kv-value">{adapter.runtimeName} · included</span>
        </div>
        {adapter.id === 'godot' && (
          <label className="kv toggle-row" title="A .tscn per scene with placeholders for its elements and an on-screen player, plus play_story.tscn">
            <span>Placeholder scenes</span>
            <input
              type="checkbox"
              className="toggle"
              aria-label="Placeholder scenes"
              checked={target.placeholderScenes !== false}
              onChange={(e) => onReplace(setTarget(project, { placeholderScenes: e.currentTarget.checked }))}
            />
          </label>
        )}
        {bridge && (
          <label className="kv toggle-row">
            <span>Export on save</span>
            <input type="checkbox" className="toggle" checked={target.exportOnSave} onChange={(e) => onReplace(setTarget(project, { exportOnSave: e.currentTarget.checked }))} />
          </label>
        )}
        {adapter.setup.length > 0 && (
          <div className="setup">
            <span className="lbl">Once per project</span>
            <ol>
              {adapter.setup.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}

        <details className="capabilities">
          <summary>What {adapter.name} gets</summary>
          <table aria-label={`What ${adapter.name} gets`}>
            <tbody>
              {CAPABILITIES.map((c) => {
                const here = c.engines[adapter.id];
                return (
                  <tr key={c.feature}>
                    <th scope="row">{c.feature}</th>
                    <td>
                      <span className={`cap cap-${here.support}`}>{SUPPORT_LABEL[here.support]}</span>
                      {here.note ? <span className="cap-note">{here.note}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>

        {plan.levels.length > 0 && (
          <div className="kv level-changes" aria-label="Level changes">
            <span>Levels</span>
            <span className="kv-value">
              {!last
                ? `${plan.levels.length} ${plan.levels.length === 1 ? 'level' : 'levels'} · ${added.length} items, none sent yet`
                : added.length + changedItems.length + removed.length === 0
                  ? 'Nothing changed since the last export'
                  : [added.length && `${added.length} new`, changedItems.length && `${changedItems.length} changed`, removed.length && `${removed.length} removed`].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {last && changedItems.length > 0 && (
          <p className="handoff-note" title={changedItems.map(itemName).join(', ')}>
            Changed: {changedItems.slice(0, 4).map(itemName).join(', ')}
            {changedItems.length > 4 ? ` and ${changedItems.length - 4} more` : ''}.
          </p>
        )}
        {last && removed.length > 0 && <p className="handoff-note">Removed items stay in {engineName} until you delete them there; the update lists them.</p>}

        <div className="grow" />

        {plan.blocking.map((b) => (
          <div key={b} className="handoff-issue blocking">
            <span className="issue-badge static">!</span>
            {b}
          </div>
        ))}
        {plan.issues.slice(0, 3).map((i) => {
          const level = !project.objects[i.id] ? levelName(i.id) : undefined;
          const name = project.objects[i.id]?.name ?? level ?? 'Something';
          return (
            <div key={i.id} className="handoff-issue">
              <span className="issue-badge static">!</span>
              <span>
                <b>{name}</b>: {i.message} It will export, but check it before you play.{' '}
                {level !== undefined ? (
                  nav.openLevels && (
                    <button className="link-btn" onClick={() => nav.openLevels!()}>
                      Fix in the Level Designer
                    </button>
                  )
                ) : (
                  <button
                    className="link-btn"
                    onClick={() => onNavigate(i.sceneId ? { kind: 'scene', sceneId: i.sceneId, mode: 'exploded' } : { kind: 'graph', id: i.id })}
                  >
                    Fix {i.sceneId ? `in ${project.objects[i.sceneId]?.data.code ?? 'the scene'}` : 'on the graph'}
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {plan.issues.length > 3 && <p className="handoff-note">+ {plan.issues.length - 3} more to look at</p>}

        {!canExport() ? (
          // The preview edition, or the VC Game Writer plan: the handoff is shown, sending is VC Game Studio's.
          <a
            className="send-btn"
            href={PURCHASE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={
              __LICENSING__
                ? (e) => {
                    const bridge = licenseBridge();
                    if (!bridge) return;
                    e.preventDefault();
                    void bridge.open(isPreview() ? 'pricing' : 'account');
                  }
                : undefined
            }
          >
            {__LICENSING__ && !isPreview() ? 'UPGRADE TO VC GAME STUDIO' : 'SUBSCRIBE'} TO SEND TO {engineName.toUpperCase()}
          </a>
        ) : (
          <button className="send-btn" disabled={!output || plan.blocking.length > 0 || sending} onClick={() => void send()}>
            {sending ? 'SENDING…' : bridge || browserFolder ? `SEND TO ${engineName.toUpperCase()}` : `DOWNLOAD FOR ${engineName.toUpperCase()}`}
          </button>
        )}
        <p className="handoff-note center">
          {output
            ? last
              ? `${plan.changed} changed since the last export (${new Date(last.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}) · ${plan.rows.length} elements total`
              : `Never sent yet · ${plan.rows.length} elements total`
            : ''}
        </p>
      </aside>

      <section className="handoff-elements" aria-label="Elements and what they generate">
        {output ? (
          <>
            <div className="handoff-head">
              <span className="handoff-title">What each element becomes in {engineName}</span>
              <div className="grow" />
              <span className="st chg">{plan.changed} changed</span>
              {issueCount > 0 && <span className="st err">{issueCount} issue{issueCount === 1 ? '' : 's'}</span>}
            </div>
            <div className="handoff-table">
              <div className="handoff-row head">
                <span />
                <span>Element</span>
                <span>Generates</span>
                <span>Status</span>
                <span />
              </div>
              {GROUPS.map((group) => {
                const rows = plan.rows.filter((r) => r.group === group);
                if (!rows.length) return null;
                return (
                  <div key={group}>
                    <div className="lbl handoff-group">{group}</div>
                    {rows.map((r) => (
                      <div key={r.id} className={`handoff-row${row?.id === r.id ? ' on' : ''}`} onClick={() => {
                        setSelected(r.id);
                        setFileIndex(0);
                        setCodeHidden(false);
                      }}>
                        <Symbol type={r.symbol} size={12} />
                        <span className="h-name">{r.label}</span>
                        <span className="h-gen">{r.generates}</span>
                        <span className={`st ${r.status === 'ready' ? 'ok' : r.status === 'changed' ? 'chg' : 'err'}`} title={r.issue}>
                          {r.status === 'issue' && r.symbol === 'state' ? 'No setter' : STATUS_LABEL[r.status]}
                        </span>
                        <button className="code-btn" aria-label={`View the code for ${r.label}`}>
                          &lt;/&gt;
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="handoff-later">
            <h2>{adapter.name} is coming</h2>
            <p>{adapter.plan}</p>
            <p>Everything it needs is already in the project. Pick another engine to hand off today.</p>
          </div>
        )}
      </section>

      {output && !codeHidden && (
        <aside className="handoff-code" aria-label="Generated code">
          <div className="code-head">
            <span className="lbl">Generated code</span>
            <span className="muted small">read-only</span>
            <div className="grow" />
            <button className="tb-btn small" onClick={() => void copy()} disabled={!file}>
              Copy
            </button>
            <button className="icon-btn small" aria-label="Hide code" onClick={() => setCodeHidden(true)}>
              ×
            </button>
          </div>
          <div className="code-tabs" role="tablist">
            {files.map((f, i) => (
              <button key={f.path} role="tab" aria-selected={f === file} className={f === file ? 'on' : ''} onClick={() => setFileIndex(i)}>
                {f.path.split('/').pop()}
              </button>
            ))}
          </div>
          <pre className="code" aria-label={file?.path}>
            {file?.content}
          </pre>
          {file && onCommit && (
            <details className="code-comments" open={openCount(project, { kind: 'code', id: file.path }) > 0 || undefined}>
              <summary>
                Comments on {file.path.split('/').pop()}
                {openCount(project, { kind: 'code', id: file.path }) ? ` · ${openCount(project, { kind: 'code', id: file.path })}` : ''}
              </summary>
              <CommentsHistory key={file.path} project={project} target={{ kind: 'code', id: file.path }} onCommit={onCommit} what={file.path} />
            </details>
          )}
          <p className="code-foot">
            You never have to touch this. Change {row?.label ?? 'the element'} in the story and the code regenerates on the next export; code of your own between its BEGIN CUSTOM and END CUSTOM lines is kept.
          </p>
        </aside>
      )}
      {output && codeHidden && (
        <button className="tb-btn show-code" onClick={() => setCodeHidden(false)}>
          &lt;/&gt; Code
        </button>
      )}
      {review && (() => {
        const r = review.review;
        const shown = r.files.filter((f) => f.status !== 'same');
        const added = shown.filter((f) => f.status === 'new').length;
        const openFile = r.files.find((f) => f.path === review.open);
        return (
          <div className="dialog-backdrop" onPointerDown={() => setReview(null)}>
            <div className="dialog handoff-review" role="alertdialog" aria-modal="true" aria-label="Review before sending" onPointerDown={(e) => e.stopPropagation()}>
              <div className="dialog-head">
                <h2>Review before sending</h2>
                <button className="icon-btn small" aria-label="Close" onClick={() => setReview(null)}>
                  ×
                </button>
              </div>
              <p className="dialog-text">
                {shown.length} of {r.files.length} files in {review.dest.label} change{added ? ` (${added} new)` : ''}.
                {r.kept ? ` Your custom code is kept in ${r.kept} ${r.kept === 1 ? 'place' : 'places'}.` : ' Code between BEGIN CUSTOM and END CUSTOM lines is kept on every export.'}
              </p>
              {r.edited.length > 0 && (
                <div className="handoff-issue">
                  <span className="issue-badge static">!</span>
                  <span>
                    {r.edited.length === 1 ? 'This file was' : `These ${r.edited.length} files were`} changed in {engineName} outside the custom code since the last export. VC Game Studio makes{' '}
                    {r.edited.length === 1 ? 'it' : 'them'}, so sending would replace the changes. Keep {engineName}’s version, or overwrite{' '}
                    {r.edited.length === 1 ? 'it' : 'them'}.
                  </span>
                </div>
              )}
              {r.lost.length > 0 && (
                <div className="handoff-issue">
                  <span className="issue-badge static">!</span>
                  <span>Custom code in {r.lost.join(', ')} has nowhere to go in the new file. Copy it out before sending.</span>
                </div>
              )}
              <ul className="review-files" aria-label="Files that change">
                {shown.map((f) => (
                  <li key={f.path}>
                    <button className={`review-file${review.open === f.path ? ' on' : ''}`} onClick={() => setReview({ ...review, open: review.open === f.path ? null : f.path })} aria-expanded={review.open === f.path}>
                      <span className="mono">{f.path}</span>
                      <span className="review-counts">
                        {f.status === 'new' ? <span className="st ok">new</span> : <>
                          <span className="review-add">+{f.added}</span> <span className="review-del">−{f.removed}</span>
                        </>}
                        {f.kept.length > 0 && <span className="st ok">custom code kept</span>}
                        {f.edited && <span className="st err">changed in {engineName}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {openFile && openFile.status !== 'new' && <DiffView file={openFile} />}
              <div className="dialog-actions">
                <button className="tb-btn" onClick={() => setReview(null)}>
                  Cancel
                </button>
                <div className="grow" />
                {r.edited.length > 0 ? (
                  <>
                    <button className="tb-btn" onClick={() => void confirm(true)}>
                      Keep {engineName}’s version
                    </button>
                    <button className="tb-btn primary" onClick={() => void confirm(false)}>
                      Overwrite them
                    </button>
                  </>
                ) : (
                  <button className="tb-btn primary" onClick={() => void confirm(false)}>
                    Send {shown.length} {shown.length === 1 ? 'file' : 'files'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
