import { useMemo, useState } from 'react';
import { downloadText, printHtml } from '../../files';
import { usePreferences } from '../../preferences';
import { projectFountain, recordingCsv, recordingHtml, recordingScript, scriptFileName, scriptHtml } from '../../model/script-export';
import type { Project } from '../../model/types';

export type ScriptExportKind = 'script' | 'recording';

/**
 * Export the script: as a screenplay (Fountain, which Final Draft, Highland,
 * WriterSolo and VC Writer open, or printed), or as a recording script for
 * the voice actors — every line in the order it plays, numbered, with its
 * file name, direction and cue in — for everyone or for one actor.
 */
export const ScriptExportDialog = ({ project, sceneId, kind: start = 'script', onClose }: { project: Project; sceneId?: string | null; kind?: ScriptExportKind; onClose: () => void }) => {
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
        </div>
        <p className="pref-hint">
          {kind === 'script'
            ? 'Each scene as a screenplay: its heading, what happens, and who says what, in the order of its beats. Fountain opens in Final Draft, Highland, WriterSolo and VC Writer.'
            : 'For the voice actors: every line in the order it plays, numbered, with how it’s said and the file name the engines play it by. For one actor, just their lines, each with the line before it to come in on.'}
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
          {kind === 'recording' && (
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
          {kind === 'recording' && (
            <span className="pref-hint">
              {recording.total} line{recording.total === 1 ? '' : 's'}
              {recording.cast.length > 1 ? ` · ${recording.cast.length} voices` : ''}
            </span>
          )}
        </div>
        <iframe className="script-export-preview" title="Preview" srcDoc={page} sandbox="" />
        {note && (
          <p className="pref-hint" role="status">
            {note}
          </p>
        )}
        <div className="dialog-actions">
          {kind === 'script' ? (
            <button type="button" className="tb-btn primary" onClick={() => downloadText(scriptFileName(project, what, 'fountain'), projectFountain(project, { contd, sceneIds }))}>
              Download .fountain
            </button>
          ) : (
            <button type="button" className="tb-btn primary" disabled={!recording.total} onClick={() => downloadText(scriptFileName(project, what, 'csv'), recordingCsv(recording), 'text/csv')}>
              Download spreadsheet (.csv)
            </button>
          )}
          <button type="button" className="tb-btn" onClick={() => downloadText(scriptFileName(project, what, 'html'), page, 'text/html')}>
            Download page (.html)
          </button>
          <button type="button" className="tb-btn" onClick={() => void print()}>
            Print…
          </button>
        </div>
      </div>
    </div>
  );
};
