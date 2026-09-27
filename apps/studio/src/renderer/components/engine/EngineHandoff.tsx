import { useEffect, useMemo, useState } from 'react';
import type { Destination } from '../../model/details';
import { engineEdits, ENGINES, planHandoff, recordExport, setTarget, type Row } from '../../model/handoff';
import { levelsOf } from '../../model/level/level';
import type { OutputGroup } from '../../model/handoff/engines';
import { zip } from '../../model/handoff/zip';
import type { Project } from '../../model/types';
import { desktop } from '../../desktop';
import { isPreview, PURCHASE_URL } from '../../edition';
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
}

const GROUPS: OutputGroup[] = ['Story', 'People + words', 'World', 'Logic'];
const STATUS_LABEL = { ready: 'Ready', changed: 'Changed', issue: 'Issue' } as const;

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
export const EngineHandoff = ({ project, onReplace, onNavigate, onSay, focus }: Props) => {
  const plan = useMemo(() => planHandoff(project), [project]);
  const bridge = desktop();
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [fileIndex, setFileIndex] = useState(0);
  const [codeHidden, setCodeHidden] = useState(false);
  const [folderState, setFolderState] = useState<{ exists: boolean; engineProject: boolean; unity?: boolean; unreal?: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [conflict, setConflict] = useState<{ folder: string; paths: string[] } | null>(null);
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

  /** Write to the folder; files the engine changed and the person chose to keep are left out. */
  const write = async (folder: string, kept: string[]) => {
    const files = output!.files.filter((f) => !kept.includes(f.path));
    const result = await bridge!.writeFiles(folder, files);
    onReplace(recordExport(setTarget(project, { projectFolder: folder }), plan, undefined, kept));
    onSay(`Sent ${result.written} files to ${folder}.${kept.length ? ` Left ${kept.length} as ${engineName} had ${kept.length === 1 ? 'it' : 'them'}.` : ''}`);
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
        // Generated files edited in the engine since the last export are never overwritten silently (spec §11.4).
        if (bridge.readFiles && last?.fileHashes && folder === target.projectFolder) {
          const onDisk = await bridge.readFiles(folder, Object.keys(last.fileHashes));
          const edited = engineEdits(plan, last, onDisk);
          if (edited.length) {
            setConflict({ folder, paths: edited });
            return;
          }
        }
        await write(folder, []);
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

  const resolve = async (keep: boolean) => {
    if (!conflict) return;
    const { folder, paths } = conflict;
    setConflict(null);
    setSending(true);
    try {
      await write(folder, keep ? paths : []);
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

        {isPreview() ? (
          <a className="send-btn" href={PURCHASE_URL} target="_blank" rel="noreferrer">
            BUY TO SEND TO {engineName.toUpperCase()}
          </a>
        ) : (
          <button className="send-btn" disabled={!output || plan.blocking.length > 0 || sending} onClick={() => void send()}>
            {sending ? 'SENDING…' : bridge ? `SEND TO ${engineName.toUpperCase()}` : `DOWNLOAD FOR ${engineName.toUpperCase()}`}
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
          <p className="code-foot">
            You never have to touch this. Change {row?.label ?? 'the element'} in the story and the code regenerates on the next export.
          </p>
        </aside>
      )}
      {output && codeHidden && (
        <button className="tb-btn show-code" onClick={() => setCodeHidden(false)}>
          &lt;/&gt; Code
        </button>
      )}
      {conflict && (
        <div className="dialog-backdrop" onPointerDown={() => setConflict(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={`Changed in ${engineName}`} onPointerDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2>Changed in {engineName}</h2>
              <button className="icon-btn small" aria-label="Close" onClick={() => setConflict(null)}>
                ×
              </button>
            </div>
            <p className="dialog-text">
              {conflict.paths.length === 1 ? 'This file was' : `These ${conflict.paths.length} files were`} changed in {engineName} since the last export. VC Game Studio
              makes {conflict.paths.length === 1 ? 'it' : 'them'}, so sending would replace the changes.
            </p>
            <ul className="dialog-list mono">
              {conflict.paths.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {conflict.paths.length > 8 && <li>and {conflict.paths.length - 8} more</li>}
            </ul>
            <div className="dialog-actions">
              <button className="tb-btn" onClick={() => setConflict(null)}>
                Cancel
              </button>
              <div className="grow" />
              <button className="tb-btn" onClick={() => void resolve(true)}>
                Keep {engineName}’s version
              </button>
              <button className="tb-btn primary" onClick={() => void resolve(false)}>
                Overwrite them
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
