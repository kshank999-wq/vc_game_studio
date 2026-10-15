import { useMemo, useRef, useState } from 'react';
import { downloadBlob, downloadText, printHtml } from '../../files';
import { attachTake, AUDIO_ACCEPT, isAudioFile, matchTakes, storeTake, takeFiles } from '../../model/audio-takes';
import { zip } from '../../model/handoff/zip';
import { TakeControl } from './TakeControl';
import { usePreferences } from '../../preferences';
import { projectFountain, recordingCsv, recordingHtml, recordingScript, scriptFileName, scriptHtml } from '../../model/script-export';
import { secondsLabel } from '../../model/subtitles';
import type { Project } from '../../model/types';

export type ScriptExportKind = 'script' | 'recording' | 'takes';

/**
 * Export the script: as a screenplay (Fountain, which Final Draft, Highland,
 * WriterSolo and VC Writer open, or printed), or as a recording script for
 * the voice actors — every line in the order it plays, numbered, with its
 * file name, direction and cue in — for everyone or for one actor.
 */
export const ScriptExportDialog = ({
  project,
  sceneId,
  kind: start = 'script',
  onCommit,
  onClose,
}: {
  project: Project;
  sceneId?: string | null;
  kind?: ScriptExportKind;
  onCommit: (p: Project) => void;
  onClose: () => void;
}) => {
  const latest = useRef(project);
  latest.current = project;
  const many = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { contd } = usePreferences();
  const [kind, setKind] = useState<ScriptExportKind>(start);
  const scene = sceneId ? project.objects[sceneId] : undefined;
  const [scope, setScope] = useState<'all' | 'scene'>(scene ? 'scene' : 'all');
  const [who, setWho] = useState<string>('');
  const [note, setNote] = useState('');
  const sceneIds = scope === 'scene' && scene ? [scene.id] : undefined;
  const speakers = useMemo(() => {
    const ids = new Set(project.lines.filter((l) => l.kind === 'dialogue' && l.speakerId && (!sceneIds || sceneIds.includes(l.sceneId))).map((l) => l.speakerId!));
    return [...ids].map((id) => project.objects[id]).filter((o) => o?.type === 'character').sort((a, b) => a!.name.localeCompare(b!.name));
  }, [project, sceneIds?.[0]]);
  const recording = useMemo(() => recordingScript(project, { sceneIds, characterId: who || null }), [project, scope, who]);
  const page = useMemo(() => (kind === 'script' ? scriptHtml(project, { contd, sceneIds }) : recordingHtml(recording)), [kind, project, contd, scope, recording]);
  const takeLines = recording.scenes.flatMap((sc) => sc.items.flatMap((i) => (i.kind === 'line' ? [{ ...i, scene: sc }] : [])));
  const recorded = takeLines.filter((i) => project.lines.find((l) => l.id === i.lineId)?.take).length;
  /** Takes dropped in together: each goes to the line its file is named for. */
  const uploadMany = async (list: FileList | File[]) => {
    const files = [...list].filter(isAudioFile);
    const skipped = list.length - files.length;
    const { matched, unmatched } = matchTakes(latest.current, files, takeLines.map((i) => i.lineId));
    setBusy(true);
    setNote('');
    try {
      let next = latest.current;
      for (const m of matched) next = attachTake(next, m.lineId, await storeTake(m.file));
      if (matched.length) onCommit(next);
      const parts = [`${matched.length} take${matched.length === 1 ? '' : 's'} matched to ${matched.length === 1 ? 'its line' : 'their lines'}`];
      if (unmatched.length) parts.push(`${unmatched.length} not matched (${unmatched.slice(0, 3).map((f) => f.name).join(', ')}${unmatched.length > 3 ? '…' : ''}): name each file for its line, like ${takeLines[0]?.key ?? 'sc_01_line_01'}.wav`);
      if (skipped) parts.push(`${skipped} not audio`);
      setNote(`${parts.join('; ')}.`);
    } catch {
      setNote('This computer wouldn’t keep the audio (it may be out of room).');
    } finally {
      setBusy(false);
    }
  };
  const downloadTakes = async () => {
    setNote('');
    const { files, missing } = await takeFiles(latest.current, takeLines.map((i) => i.lineId));
    if (files.length) downloadBlob(scriptFileName(project, 'takes', 'zip'), new Blob([zip(files)], { type: 'application/zip' }));
    if (missing.length) setNote(`${missing.length} recorded line${missing.length === 1 ? '’s' : 's’'} audio isn’t on this computer; upload ${missing.length === 1 ? 'it' : 'them'} again.`);
    else if (!files.length) setNote('No takes uploaded yet.');
  };
  const what = kind === 'script' ? (scene && scope === 'scene' ? scene.name : 'script') : `recording script${recording.forName ? ` ${recording.forName}` : ''}${scene && scope === 'scene' ? ` ${scene.name}` : ''}`;
  const print = async () => {
    setNote('');
    if (!(await printHtml(page))) setNote('Printing isn’t allowed here: download the page and print it from your browser.');
  };
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog wide script-export"
        role="dialog"
        aria-modal="true"
        aria-label="Export the script"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          <h2>Export the script</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div role="tablist" className="scene-tabs script-export-tabs">
          <button role="tab" aria-selected={kind === 'script'} className={kind === 'script' ? 'on' : ''} onClick={() => setKind('script')}>
            Screenplay
          </button>
          <button role="tab" aria-selected={kind === 'recording'} className={kind === 'recording' ? 'on' : ''} onClick={() => setKind('recording')}>
            Recording script
          </button>
          <button role="tab" aria-selected={kind === 'takes'} className={kind === 'takes' ? 'on' : ''} onClick={() => setKind('takes')}>
            Takes
          </button>
        </div>
        <p className="pref-hint">
          {kind === 'script'
            ? 'Each scene as a screenplay: its heading, what happens, and who says what, in the order of its beats. Fountain opens in Final Draft, Highland, WriterSolo and VC Writer.'
            : kind === 'recording'
              ? 'For the voice actors: every line in the order it plays, numbered, with how it’s said, the file name the engines play it by and its subtitle. For one actor, just their lines, each with the line before it to come in on.'
              : 'Upload each recorded take and its line is marked recorded. Drop in a whole session at once: files named for their lines (as the recording script names them) go to their lines.'}
        </p>
        <div className="setup-row script-export-opts">
          {scene && (
            <label>
              Scenes{' '}
              <select className="inp small" value={scope} onChange={(e) => setScope(e.currentTarget.value as 'all' | 'scene')}>
                <option value="scene">This scene ({scene.name})</option>
                <option value="all">Every scene, in story order</option>
              </select>
            </label>
          )}
          {kind !== 'script' && (
            <label>
              Lines for{' '}
              <select className="inp small" aria-label="Lines for" value={who} onChange={(e) => setWho(e.currentTarget.value)}>
                <option value="">Everyone (the whole session)</option>
                {speakers.map((c) => (
                  <option key={c!.id} value={c!.id}>
                    {c!.name} only
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'takes' && (
            <span className="pref-hint" role="status">
              {recorded} of {takeLines.length} recorded
            </span>
          )}
          {kind === 'recording' && (
            <span className="pref-hint">
              {recording.total} line{recording.total === 1 ? '' : 's'}
              {recording.cast.length > 1 ? ` · ${recording.cast.length} voices` : ''}
            </span>
          )}
        </div>
        {kind === 'takes' ? (
          <div
            className="takes-list"
            onDragOver={(e) => {
              if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void uploadMany(e.dataTransfer.files);
            }}
          >
            {takeLines.length ? (
              <ol aria-label="Lines to record">
                {takeLines.map((i) => (
                  <li key={i.lineId} className="takes-row">
                    <span className="no">{i.take}</span>
                    <div className="takes-line">
                      <div>
                        <span className="cue">{i.cue}</span>
                        {i.direction && <span className="dir"> ({i.direction})</span>} <span className="key mono">{i.key}</span>
                      </div>
                      <div className="say">{i.text}</div>
                      <div className="takes-subtitle muted">
                        Subtitle · {secondsLabel(i.subtitleSeconds)}: {i.subtitle}
                      </div>
                    </div>
                    <TakeControl project={project} lineId={i.lineId} onCommit={onCommit} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No lines to record here.</p>
            )}
          </div>
        ) : (
          <iframe className="script-export-preview" title="Preview" srcDoc={page} sandbox="" />
        )}
        {note && (
          <p className="pref-hint" role="status">
            {note}
          </p>
        )}
        <div className="dialog-actions">
          {kind === 'takes' ? (
            <>
              <input
                ref={many}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                hidden
                aria-label="Audio files for these lines"
                onChange={(e) => {
                  if (e.currentTarget.files) void uploadMany(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
              <button type="button" className="tb-btn primary" disabled={busy || !takeLines.length} onClick={() => many.current?.click()}>
                {busy ? 'Uploading…' : 'Upload takes…'}
              </button>
              <button type="button" className="tb-btn" disabled={!recorded} onClick={() => void downloadTakes()} title="Every take, named for its line as the engines play it: audio/vo/sc_03_line_02.wav">
                Download takes (.zip)
              </button>
            </>
          ) : kind === 'script' ? (
            <button type="button" className="tb-btn primary" onClick={() => downloadText(scriptFileName(project, what, 'fountain'), projectFountain(project, { contd, sceneIds }))}>
              Download .fountain
            </button>
          ) : (
            <button type="button" className="tb-btn primary" disabled={!recording.total} onClick={() => downloadText(scriptFileName(project, what, 'csv'), recordingCsv(recording), 'text/csv')}>
              Download spreadsheet (.csv)
            </button>
          )}
          {kind !== 'takes' && (
            <>
              <button type="button" className="tb-btn" onClick={() => downloadText(scriptFileName(project, what, 'html'), page, 'text/html')}>
                Download page (.html)
              </button>
              <button type="button" className="tb-btn" onClick={() => void print()}>
                Print…
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
