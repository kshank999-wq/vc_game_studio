import { useEffect, useMemo, useState } from 'react';
import type { Destination } from '../../model/details';
import { ENGINES, planHandoff, recordExport, setTarget, type Row } from '../../model/handoff';
import type { OutputGroup } from '../../model/handoff/engines';
import { zip } from '../../model/handoff/zip';
import type { Project } from '../../model/types';
import { desktop } from '../../desktop';
import { isPreview, PURCHASE_URL } from '../../edition';
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
 * clear. Godot 4 is first; the others are set up and marked as coming.
 */
export const EngineHandoff = ({ project, onReplace, onNavigate, onSay, focus }: Props) => {
  const plan = useMemo(() => planHandoff(project), [project]);
  const bridge = desktop();
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [fileIndex, setFileIndex] = useState(0);
  const [codeHidden, setCodeHidden] = useState(false);
  const [folderState, setFolderState] = useState<{ exists: boolean; engineProject: boolean } | null>(null);
  const [sending, setSending] = useState(false);
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

  const pickFolder = async () => {
    if (!bridge) return;
    const folder = await bridge.pickFolder();
    if (folder) onReplace(setTarget(project, { projectFolder: folder }));
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
        const result = await bridge.writeFiles(folder, output.files);
        onReplace(recordExport(setTarget(project, { projectFolder: folder }), plan));
        onSay(`Sent ${result.written} files to ${folder}.`);
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
        {folderState && !folderState.engineProject && (
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

        <div className="grow" />

        {plan.blocking.map((b) => (
          <div key={b} className="handoff-issue blocking">
            <span className="issue-badge static">!</span>
            {b}
          </div>
        ))}
        {plan.issues.slice(0, 3).map((i) => {
          const name = project.objects[i.id]?.name ?? 'Something';
          return (
            <div key={i.id} className="handoff-issue">
              <span className="issue-badge static">!</span>
              <span>
                <b>{name}</b>: {i.message} It will export, but check it before you play.{' '}
                <button
                  className="link-btn"
                  onClick={() => onNavigate(i.sceneId ? { kind: 'scene', sceneId: i.sceneId, mode: 'exploded' } : { kind: 'graph', id: i.id })}
                >
                  Fix {i.sceneId ? `in ${project.objects[i.sceneId]?.data.code ?? 'the scene'}` : 'on the graph'}
                </button>
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
            <p>Everything it needs is already in the project. Pick Godot 4 to hand off today.</p>
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
    </div>
  );
};
