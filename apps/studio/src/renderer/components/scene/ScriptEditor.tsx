import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addLine, newCharacter, nextSpeaker, removeLine, sceneLines, speakers, updateLine } from '../../model/scene';
import type { DialogueLine, Project } from '../../model/types';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  /** A line to focus once it exists (a dialogue line dropped in from the palette). */
  focusLine?: string | null;
}

/** Grow a textarea to fit what is in it, so the script reads as one page. */
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
};

const characterColor = (project: Project, id: string | null): string =>
  (id && (project.objects[id]?.data.color as string | undefined)) || 'var(--c-character)';

/**
 * The scene's script in screenplay form (spec §12): action, then a speaker,
 * their line and an optional direction. Enter ends a block and starts the
 * next one (the other side of the exchange); Tab on an empty block switches
 * it between dialogue and action.
 */
export const ScriptEditor = ({ project, sceneId, onCommit, focusLine }: Props) => {
  const lines = sceneLines(project, sceneId);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [speakerMenu, setSpeakerMenu] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(project);
  latest.current = project;

  useEffect(() => {
    if (focusLine) setPendingFocus(focusLine);
  }, [focusLine]);

  useLayoutEffect(() => {
    root.current?.querySelectorAll('textarea').forEach((t) => fit(t));
    if (!pendingFocus) return;
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-line="${pendingFocus}"] textarea.line-text`);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      setPendingFocus(null);
    }
  });

  const commitText = (line: DialogueLine, el: HTMLTextAreaElement) => {
    if (el.value !== line.text) onCommit(updateLine(latest.current, line.id, { text: el.value }));
  };

  const add = (kind: DialogueLine['kind'], afterId?: string, speakerId: string | null = null) => {
    const added = addLine(latest.current, sceneId, kind, afterId, speakerId);
    onCommit(added.project);
    setPendingFocus(added.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, line: DialogueLine) => {
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      let current = latest.current;
      if (el.value !== line.text) current = updateLine(current, line.id, { text: el.value });
      const speaker = line.kind === 'dialogue' ? nextSpeaker(current, sceneId, line.id) : null;
      const added = addLine(current, sceneId, line.kind, line.id, speaker);
      onCommit(added.project);
      setPendingFocus(added.id);
    } else if (e.key === 'Backspace' && el.value === '' && line.direction === '') {
      e.preventDefault();
      const at = lines.findIndex((l) => l.id === line.id);
      onCommit(removeLine(latest.current, line.id));
      const previous = lines[at - 1];
      if (previous) setPendingFocus(previous.id);
    } else if (e.key === 'Tab' && el.value === '') {
      e.preventDefault();
      const kind = line.kind === 'dialogue' ? 'action' : 'dialogue';
      const speaker = kind === 'dialogue' ? nextSpeaker(latest.current, sceneId, line.id) : null;
      onCommit(updateLine(latest.current, line.id, { kind, speakerId: speaker }));
      setPendingFocus(line.id);
    }
  };

  return (
    <div className="script" ref={root}>
      {lines.length === 0 && (
        <div className="script-empty">
          <p>Write what happens: the setting, what the player sees, then who speaks.</p>
          <div className="script-empty-actions">
            <button className="tb-btn" onClick={() => add('action')}>
              Start with action
            </button>
            <button className="tb-btn" onClick={() => add('dialogue', undefined, speakers(project, sceneId).find((s) => s.present)?.character.id ?? null)}>
              Start with dialogue
            </button>
          </div>
        </div>
      )}
      {lines.map((line) =>
        line.kind === 'action' ? (
          <div key={line.id} className="line line-action" data-line={line.id}>
            <textarea
              key={line.text}
              className="line-text"
              aria-label="Action"
              defaultValue={line.text}
              placeholder="What happens…"
              rows={1}
              onInput={(e) => fit(e.currentTarget)}
              onBlur={(e) => commitText(line, e.currentTarget)}
              onKeyDown={(e) => onKeyDown(e, line)}
            />
          </div>
        ) : (
          <div key={line.id} className="line line-dialogue" data-line={line.id}>
            <span className="line-meta">
              <span title="Voice-over status">VO: {line.vo === 'recorded' ? 'recorded' : line.vo === 'todo' ? 'to record' : 'none'}</span>
              <span className="mono">#{line.order}</span>
            </span>
            <div className="speaker-wrap">
              <button
                className={`speaker${line.speakerId ? '' : ' missing'}`}
                aria-haspopup="listbox"
                aria-expanded={speakerMenu === line.id}
                onClick={() => setSpeakerMenu(speakerMenu === line.id ? null : line.id)}
              >
                <Symbol type="character" size={10} color={characterColor(project, line.speakerId)} />
                {line.speakerId ? project.objects[line.speakerId]?.name.toUpperCase() : 'WHO SPEAKS?'}
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              {speakerMenu === line.id && (
                <SpeakerMenu
                  project={project}
                  sceneId={sceneId}
                  current={line.speakerId}
                  onPick={(id) => {
                    setSpeakerMenu(null);
                    onCommit(updateLine(latest.current, line.id, { speakerId: id }));
                    setPendingFocus(line.id);
                  }}
                  onNew={(name) => {
                    const made = newCharacter(latest.current, sceneId, name);
                    setSpeakerMenu(null);
                    if (!made) return;
                    onCommit(updateLine(made.project, line.id, { speakerId: made.id }));
                    setPendingFocus(line.id);
                  }}
                  onClose={() => setSpeakerMenu(null)}
                />
              )}
            </div>
            <input
              key={line.direction}
              className="line-direction"
              aria-label="Direction"
              defaultValue={line.direction ? `(${line.direction})` : ''}
              placeholder="(direction)"
              onBlur={(e) => {
                const value = e.currentTarget.value.trim().replace(/^\(|\)$/g, '').trim();
                if (value !== line.direction) onCommit(updateLine(latest.current, line.id, { direction: value }));
                e.currentTarget.value = value ? `(${value})` : '';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                  setPendingFocus(line.id);
                }
              }}
            />
            <textarea
              key={line.text}
              className="line-text"
              aria-label={`Line for ${line.speakerId ? project.objects[line.speakerId]?.name : 'no speaker'}`}
              defaultValue={line.text}
              placeholder="What they say…"
              rows={1}
              onInput={(e) => fit(e.currentTarget)}
              onBlur={(e) => commitText(line, e.currentTarget)}
              onKeyDown={(e) => onKeyDown(e, line)}
            />
          </div>
        ),
      )}
    </div>
  );
};

export const ScriptFooter = ({ project, sceneId, onCommit }: Props) => {
  const lines = sceneLines(project, sceneId);
  const last = lines[lines.length - 1];
  const addDialogue = () => {
    const speaker = last ? nextSpeaker(project, sceneId, last.id) : speakers(project, sceneId).find((s) => s.present)?.character.id ?? null;
    onCommit(addLine(project, sceneId, 'dialogue', last?.id, speaker).project);
  };
  return (
    <div className="script-footer">
      <span>Next line:</span>
      <button onClick={addDialogue}>Dialogue</button>
      <button onClick={() => onCommit(addLine(project, sceneId, 'action', last?.id).project)}>Action</button>
      <span className="script-keys mono" title="Enter: next line · Shift+Enter: new paragraph · Tab on an empty line: dialogue ↔ action">Enter next · Tab switches</span>
    </div>
  );
};

const SpeakerMenu = ({ project, sceneId, current, onPick, onNew, onClose }: {
  project: Project;
  sceneId: string;
  current: string | null;
  onPick: (id: string) => void;
  onNew: (name: string) => void;
  onClose: () => void;
}) => {
  const [naming, setNaming] = useState(false);
  const list = speakers(project, sceneId);
  return (
    <div className="speaker-menu" role="listbox" aria-label="Speaker" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="menu-heading">FROM THE BIBLE</div>
      {list.length === 0 && <div className="menu-empty">No characters yet</div>}
      {list.map(({ character, present }) => (
        <button
          key={character.id}
          role="option"
          aria-selected={character.id === current}
          className={character.id === current ? 'on' : ''}
          onClick={() => onPick(character.id)}
        >
          <Symbol type="character" size={11} color={characterColor(project, character.id)} />
          {character.name}
          {!present && <span className="menu-note">· not in scene</span>}
        </button>
      ))}
      <div className="menu-sep" />
      {naming ? (
        <input
          className="menu-input"
          aria-label="New character name"
          placeholder="Name…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) onNew(e.currentTarget.value);
            if (e.key === 'Escape') setNaming(false);
          }}
          onBlur={() => setNaming(false)}
        />
      ) : (
        <button className="menu-new" onClick={() => setNaming(true)}>
          + New character…
        </button>
      )}
    </div>
  );
};
