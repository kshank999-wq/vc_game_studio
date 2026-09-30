import { useRef, useState } from 'react';
import { downloadText, fileNameFor, readText } from '../../files';
import type { Play } from '../../model/play';
import { playFromSave, saveText, savesStorageKey, SLOTS, type PlaySave } from '../../model/save-game';
import type { Project } from '../../model/types';

/** The save slots kept in this browser for a project (each a save's text, or null when empty). */
const readSlots = (projectId: string): (string | null)[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(savesStorageKey(projectId)) ?? '[]') as unknown;
    const slots = Array.isArray(stored) ? stored.map((s) => (typeof s === 'string' ? s : null)) : [];
    return Array.from({ length: SLOTS }, (_, i) => slots[i] ?? null);
  } catch {
    return Array.from({ length: SLOTS }, () => null);
  }
};

const summaryOf = (text: string | null): Pick<PlaySave, 'at' | 'savedAt'> | null => {
  if (!text) return null;
  try {
    const save = JSON.parse(text) as Partial<PlaySave>;
    return { at: save.at ?? 'Somewhere', savedAt: save.savedAt ?? 0 };
  } catch {
    return null;
  }
};

const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const saveFileNameFor = (project: Project): string => fileNameFor(project).replace(/\.[^.]+$/, '') + ' save.json';

/**
 * Saving and loading the play-through: slots kept in this browser, and a
 * file to keep or pass on. Loading carries on from the very line saved at;
 * Step back takes a load back.
 */
export const SavesPanel = ({ project, play, onLoad, onClose }: { project: Project; play: Play; onLoad: (play: Play) => void; onClose: () => void }) => {
  const [slots, setSlots] = useState(() => readSlots(project.id));
  const [status, setStatus] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const keep = (next: (string | null)[]) => {
    setSlots(next);
    try {
      localStorage.setItem(savesStorageKey(project.id), JSON.stringify(next));
      return true;
    } catch {
      setStatus('This browser will not keep saves (a private window, say). Save to a file instead.');
      return false;
    }
  };
  const load = (text: string) => {
    const read = playFromSave(project, text);
    if ('error' in read) return setStatus(read.error);
    onLoad(read.play);
    setStatus(`Loaded: ${read.save.at}, saved ${when(read.save.savedAt)}. Step back undoes it.`);
  };
  return (
    <div className="play-codex play-saves" role="dialog" aria-label="Saved games">
      <div className="play-codex-head">
        <span className="rule-label">Saved games</span>
        <span className="pref-hint">The whole play-through: loading carries on from the very line it was saved at. Slots are kept in this browser.</span>
        <button className="tb-btn small" onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="play-save-slots">
        {slots.map((text, i) => {
          const s = summaryOf(text);
          const name = `Slot ${i + 1}`;
          return (
            <li key={i} className="play-save-slot">
              <span className="play-save-name">{name}</span>
              <span className="play-save-at">{s ? `${s.at} · ${when(s.savedAt)}` : 'Empty'}</span>
              <button
                className="tb-btn small"
                aria-label={`Save in ${name}`}
                onClick={() => {
                  const next = [...slots];
                  next[i] = saveText(project, play);
                  if (keep(next)) setStatus(`Saved in ${name}.`);
                }}
              >
                Save here
              </button>
              <button className="tb-btn small" aria-label={`Load ${name}`} disabled={!text} onClick={() => text && load(text)}>
                Load
              </button>
              <button
                className="tb-btn small"
                aria-label={`Delete ${name}`}
                disabled={!text}
                onClick={() => {
                  const next = [...slots];
                  next[i] = null;
                  if (keep(next)) setStatus(`${name} deleted.`);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
      <div className="play-codex-notes-actions">
        <span className="pref-hint">File</span>
        <button
          className="tb-btn small"
          title="Save the play-through as a file, to keep or pass on"
          onClick={() => {
            downloadText(saveFileNameFor(project), saveText(project, play), 'application/json');
            setStatus('Saved as a file.');
          }}
        >
          Save to a file
        </button>
        <button className="tb-btn small" title="Load a play-through saved as a file" onClick={() => file.current?.click()}>
          Load a file
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="Saved game file to load"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void readText(f).then(load);
          }}
        />
      </div>
      {status && (
        <p className="play-note" role="status">
          {status}
        </p>
      )}
    </div>
  );
};
