import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addLine, headingSuggestions, inScene, looksLikeTransition, nextSpeaker, removeLine, sceneHeading, sceneLines, setSceneHeading, setSpeakerByName, speakerSuggestions, speakers, transitionSuggestions, updateLine } from '../../model/scene';
import type { DialogueLine, Project, StoryObject } from '../../model/types';
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

/** Which part of a block to put the caret in. */
type Field = 'text' | 'cue' | 'paren' | 'heading';
type Focus = { id: string; field: Field; select?: boolean };

/** The cue being typed: its line, what is typed, and the highlighted suggestion. */
interface Typing {
  id: string;
  query: string;
  index: number;
}

/**
 * The scene's script, written as in screenplay software (spec §12): Action,
 * then a Character cue, an optional (parenthetical) and their Dialogue.
 *
 * - Typing a cue suggests the characters whose names start with it, the
 *   scene's cast first; Tab or Enter takes the suggestion. A name nobody has
 *   yet makes a new character, who joins the scene.
 * - Enter after dialogue starts the next cue (Tab there takes the other side
 *   of the exchange); Enter on an empty cue makes it Action instead.
 * - In dialogue, Tab or an opening "(" adds a parenthetical; Shift+Enter is a
 *   new paragraph. Tab on an empty action line makes it a cue. Backspace on
 *   an empty part steps back, and removes an empty block.
 * - The scene heading (INT. VAULT CHAMBER — NIGHT) is the script's first line:
 *   it completes INT./EXT., the project's places and the time of day, and
 *   sets the scene's own, as the pickers above do.
 * - A Transition (CUT TO:) sits on the right, completing the usual ones. An
 *   action line typed as one ("CUT TO:") becomes one on Enter; Tab on an empty
 *   cue with no one to offer makes one too.
 * - As in Final Draft, Ctrl/Cmd+1 to 6 make the block a Scene heading, Action,
 *   Character, Parenthetical, Dialogue or Transition.
 */
export const ScriptEditor = ({ project, sceneId, onCommit, focusLine }: Props) => {
  const lines = sceneLines(project, sceneId);
  const [pending, setPending] = useState<Focus | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  // Blocks whose parenthetical is open though still empty.
  const [paren, setParen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A cue just taken: its blur must not take the half-typed text as a name too.
  const taken = useRef<string | null>(null);
  const latest = useRef(project);
  latest.current = project;

  useEffect(() => {
    if (focusLine) setPending({ id: focusLine, field: 'text' });
  }, [focusLine]);

  useLayoutEffect(() => {
    root.current?.querySelectorAll('textarea').forEach((t) => fit(t));
    if (!pending) return;
    const selector = pending.field === 'cue' ? 'input.line-cue' : pending.field === 'paren' ? 'input.line-direction' : pending.field === 'heading' ? 'input.line-heading' : '.line-text';
    const el = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(pending.field === 'heading' ? selector : `[data-line="${pending.id}"] ${selector}`);
    if (el) {
      el.focus();
      if (pending.select) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
      setPending(null);
    }
  });

  const commit = (next: Project, focus?: Focus) => {
    onCommit(next);
    if (focus) setPending(focus);
  };

  /** What the block's text box holds now, saved before the block changes. */
  const withText = (current: Project, line: DialogueLine): Project => {
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-line="${line.id}"] .line-text`);
    return el && el.value !== line.text ? updateLine(current, line.id, { text: el.value }) : current;
  };

  const add = (kind: DialogueLine['kind'], afterId?: string, speakerId: string | null = null, field: Field = 'text') => {
    const added = addLine(latest.current, sceneId, kind, afterId, speakerId);
    commit(added.project, { id: added.id, field });
  };

  const removeBlock = (line: DialogueLine) => {
    const at = lines.findIndex((l) => l.id === line.id);
    const previous = lines[at - 1];
    commit(removeLine(latest.current, line.id), previous ? { id: previous.id, field: 'text' } : undefined);
  };

  // ------------------------------------------------------------ element shortcuts (Final Draft's Ctrl/Cmd+1…6)

  /** Make the block another element; true when the key was one of the shortcuts. */
  const shortcut = (e: React.KeyboardEvent, line: DialogueLine): boolean => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !/^[1-6]$/.test(e.key)) return false;
    e.preventDefault();
    const current = withText(latest.current, line);
    switch (e.key) {
      case '1':
        commit(current, { id: 'heading', field: 'heading' });
        break;
      case '2':
        commit(updateLine(current, line.id, { kind: 'action' }), { id: line.id, field: 'text' });
        break;
      case '3':
        commit(updateLine(current, line.id, { kind: 'dialogue' }), { id: line.id, field: 'cue' });
        break;
      case '4':
        commit(updateLine(current, line.id, { kind: 'dialogue' }));
        setParen(line.id);
        setPending({ id: line.id, field: 'paren' });
        break;
      case '5':
        commit(updateLine(current, line.id, { kind: 'dialogue' }), { id: line.id, field: line.speakerId || line.kind === 'dialogue' ? 'text' : 'cue' });
        break;
      case '6':
        commit(updateLine(current, line.id, { kind: 'transition', text: line.text.toUpperCase() }), { id: line.id, field: 'text' });
        break;
    }
    return true;
  };

  // ------------------------------------------------------------ the scene heading

  const [heading, setHeading] = useState<{ query: string; index: number } | null>(null);
  const headingList = heading ? headingSuggestions(latest.current, sceneId, heading.query).slice(0, 8) : [];

  /** The heading as typed becomes the scene's; the caret goes on to the first line. */
  const commitHeading = (el: HTMLInputElement, go: boolean) => {
    setHeading(null);
    const typed = el.value.trim();
    let next = latest.current;
    if (typed && typed !== sceneHeading(next, sceneId)) next = setSceneHeading(next, sceneId, typed);
    el.value = sceneHeading(next, sceneId);
    if (!go) {
      if (next !== latest.current) onCommit(next);
      return;
    }
    const first = sceneLines(next, sceneId)[0];
    if (first) commit(next, { id: first.id, field: first.kind === 'dialogue' ? 'cue' : 'text' });
    else {
      const added = addLine(next, sceneId, 'action');
      commit(added.project, { id: added.id, field: 'text' });
    }
  };

  const onHeadingKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const list = headingList;
    const index = Math.min(heading?.index ?? 0, Math.max(0, list.length - 1));
    if ((e.ctrlKey || e.metaKey) && /^[2-6]$/.test(e.key)) {
      // From the heading, an element shortcut goes to the first line.
      e.preventDefault();
      commitHeading(el, true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      setHeading({ query: el.value, index: (index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length });
    } else if (e.key === 'Escape') {
      setHeading(null);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      const pick = list[index];
      // A place or a prefix: keep writing the heading. A whole heading: on to the script.
      if (pick && (e.key === 'Tab' || /\s$/.test(pick))) {
        el.value = pick;
        el.setSelectionRange(pick.length, pick.length);
        if (/\s$/.test(pick)) setHeading({ query: pick, index: 0 });
        else commitHeading(el, e.key === 'Enter');
        return;
      }
      if (pick) el.value = pick;
      commitHeading(el, true);
    }
  };

  // ------------------------------------------------------------ transitions

  const onTransitionKey = (e: React.KeyboardEvent<HTMLInputElement>, line: DialogueLine) => {
    if (shortcut(e, line)) return;
    const el = e.currentTarget;
    const list = typing?.id === line.id ? transitionSuggestions(typing.query) : [];
    const index = typing?.id === line.id ? Math.min(typing.index, Math.max(0, list.length - 1)) : 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      setTyping({ id: line.id, query: el.value, index: (index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length });
    } else if (e.key === 'Escape') {
      setTyping(null);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setTyping(null);
      if (!el.value.trim() && e.key === 'Tab') {
        commit(updateLine(latest.current, line.id, { kind: 'action' }), { id: line.id, field: 'text' });
        return;
      }
      const text = (list[index] ?? el.value).trim().toUpperCase();
      el.value = text;
      // After a transition, what happens next.
      const added = addLine(updateLine(latest.current, line.id, { text }), sceneId, 'action', line.id);
      commit(added.project, { id: added.id, field: 'text' });
    } else if (e.key === 'Backspace' && el.value === '') {
      e.preventDefault();
      setTyping(null);
      removeBlock(line);
    }
  };

  // ------------------------------------------------------------ action

  const onActionKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, line: DialogueLine) => {
    if (shortcut(e, line)) return;
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      let current = withText(latest.current, line);
      // "CUT TO:" typed as action is a transition.
      if (looksLikeTransition(el.value)) current = updateLine(current, line.id, { kind: 'transition', text: el.value.trim() });
      const added = addLine(current, sceneId, 'action', line.id);
      commit(added.project, { id: added.id, field: 'text' });
    } else if (e.key === 'Tab' && !e.shiftKey && el.value === '') {
      // An empty action line becomes a character cue.
      e.preventDefault();
      commit(updateLine(latest.current, line.id, { kind: 'dialogue', speakerId: null }), { id: line.id, field: 'cue' });
    } else if (e.key === 'Backspace' && el.value === '') {
      e.preventDefault();
      removeBlock(line);
    }
  };

  // ------------------------------------------------------------ cues

  const suggestionsFor = (line: DialogueLine): StoryObject[] => (typing?.id === line.id ? speakerSuggestions(latest.current, sceneId, typing.query).slice(0, 6) : []);

  /** The speaker the cue would take on Tab when it's empty: the other side of the exchange. */
  const ghostFor = (line: DialogueLine): StoryObject | undefined => {
    if (line.speakerId) return undefined;
    const id = nextSpeaker(latest.current, sceneId, line.id);
    return id ? latest.current.objects[id] : undefined;
  };

  /** Take a name for the cue (an existing character's, or a new one's) and go on to the dialogue. */
  const takeCue = (line: DialogueLine, name: string) => {
    setTyping(null);
    taken.current = line.id;
    const input = root.current?.querySelector<HTMLInputElement>(`[data-line="${line.id}"] input.line-cue`);
    if (input) input.value = name;
    const current = withText(latest.current, line);
    if (!name.trim()) return;
    const set = setSpeakerByName(current, line.id, name);
    commit(set.project, { id: line.id, field: 'text' });
  };

  const onCueKey = (e: React.KeyboardEvent<HTMLInputElement>, line: DialogueLine) => {
    if (shortcut(e, line)) return;
    const el = e.currentTarget;
    const list = suggestionsFor(line);
    const index = typing?.id === line.id ? Math.min(typing.index, Math.max(0, list.length - 1)) : 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      setTyping({ id: line.id, query: el.value, index: (index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length });
    } else if (e.key === 'Escape') {
      setTyping(null);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      const typed = el.value.trim();
      if (list.length && typed) takeCue(line, list[index]!.name);
      else if (typed) takeCue(line, typed);
      else if (e.key === 'Tab') {
        const ghost = ghostFor(line);
        if (ghost) takeCue(line, ghost.name);
        // Nobody to offer: an empty cue on Tab is a transition.
        else commit(updateLine(latest.current, line.id, { kind: 'transition' }), { id: line.id, field: 'text' });
      } else {
        // Enter on an empty cue: this block is action after all.
        setTyping(null);
        commit(updateLine(withText(latest.current, line), line.id, { kind: 'action', direction: '' }), { id: line.id, field: 'text' });
      }
    } else if (e.key === 'Backspace' && el.value === '' && !line.text && !line.direction) {
      e.preventDefault();
      setTyping(null);
      removeBlock(line);
    }
  };

  // ------------------------------------------------------------ dialogue and parentheticals

  const onTextKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, line: DialogueLine) => {
    if (shortcut(e, line)) return;
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      // The next cue, empty: type who speaks, Tab for the other side of the exchange, Enter for action.
      e.preventDefault();
      const current = withText(latest.current, line);
      const added = addLine(current, sceneId, 'dialogue', line.id, null);
      commit(added.project, { id: added.id, field: 'cue' });
    } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === '(' && el.value === '')) {
      e.preventDefault();
      commit(withText(latest.current, line));
      setParen(line.id);
      setPending({ id: line.id, field: 'paren' });
    } else if (e.key === 'Backspace' && el.value === '') {
      e.preventDefault();
      setPending({ id: line.id, field: line.direction ? 'paren' : 'cue' });
    }
  };

  const saveParen = (line: DialogueLine, el: HTMLInputElement) => {
    const value = el.value.trim().replace(/^\(|\)$/g, '').trim();
    if (value !== line.direction) onCommit(updateLine(latest.current, line.id, { direction: value }));
    el.value = value ? `(${value})` : '';
    if (!value && paren === line.id) setParen(null);
  };

  const onParenKey = (e: React.KeyboardEvent<HTMLInputElement>, line: DialogueLine) => {
    if (shortcut(e, line)) return;
    const el = e.currentTarget;
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      saveParen(line, el);
      setPending({ id: line.id, field: 'text' });
    } else if (e.key === 'Backspace' && el.value.replace(/[()]/g, '') === '') {
      e.preventDefault();
      el.value = '';
      saveParen(line, el);
      setParen(null);
      setPending({ id: line.id, field: 'cue' });
    }
  };

  return (
    <div className="script" ref={root}>
      <div className="line line-heading-wrap">
        <input
          key={sceneHeading(project, sceneId)}
          className="line-heading"
          aria-label="Scene heading"
          aria-autocomplete="list"
          defaultValue={sceneHeading(project, sceneId)}
          placeholder="INT. PLACE — DAY"
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => setHeading({ query: e.currentTarget.value, index: 0 })}
          onInput={(e) => setHeading({ query: e.currentTarget.value, index: 0 })}
          onKeyDown={onHeadingKey}
          onBlur={(e) => commitHeading(e.currentTarget, false)}
        />
        {headingList.length > 0 && (
          <Suggestions
            label="Heading"
            items={headingList.map((h) => ({ key: h, label: h.trim() }))}
            index={Math.min(heading?.index ?? 0, headingList.length - 1)}
            onPick={(h) => {
              const el = root.current?.querySelector<HTMLInputElement>('input.line-heading');
              if (!el) return;
              el.value = h;
              if (/\s$/.test(h)) setHeading({ query: h, index: 0 });
              else commitHeading(el, true);
            }}
          />
        )}
      </div>
      {lines.length === 0 && (
        <div className="script-empty">
          <p>Write what happens: the setting, what the player sees, then who speaks.</p>
          <div className="script-empty-actions">
            <button className="tb-btn" onClick={() => add('action')}>
              Start with action
            </button>
            <button className="tb-btn" onClick={() => add('dialogue', undefined, null, 'cue')}>
              Start with a character
            </button>
          </div>
        </div>
      )}
      {lines.map((line) => {
        if (line.kind === 'transition') {
          const list = typing?.id === line.id ? transitionSuggestions(typing.query) : [];
          return (
            <div key={line.id} className="line line-transition" data-line={line.id}>
              <input
                key={line.text}
                className="line-text line-transition-text"
                aria-label="Transition"
                aria-autocomplete="list"
                defaultValue={line.text}
                placeholder="CUT TO:"
                spellCheck={false}
                autoComplete="off"
                onInput={(e) => setTyping({ id: line.id, query: e.currentTarget.value, index: 0 })}
                onKeyDown={(e) => onTransitionKey(e, line)}
                onBlur={(e) => {
                  setTyping(null);
                  const text = e.currentTarget.value.trim().toUpperCase();
                  if (text !== line.text) onCommit(updateLine(latest.current, line.id, { text }));
                }}
              />
              {list.length > 0 && (
                <Suggestions
                  label="Transitions"
                  items={list.map((t) => ({ key: t, label: t }))}
                  index={Math.min(typing?.index ?? 0, list.length - 1)}
                  onPick={(t) => {
                    setTyping(null);
                    const added = addLine(updateLine(latest.current, line.id, { text: t }), sceneId, 'action', line.id);
                    commit(added.project, { id: added.id, field: 'text' });
                  }}
                />
              )}
            </div>
          );
        }
        if (line.kind === 'action') {
          return (
            <div key={line.id} className="line line-action" data-line={line.id}>
              <textarea
                key={line.text}
                className="line-text"
                aria-label="Action"
                defaultValue={line.text}
                placeholder="What happens…"
                rows={1}
                onInput={(e) => fit(e.currentTarget)}
                onBlur={(e) => e.currentTarget.value !== line.text && onCommit(updateLine(latest.current, line.id, { text: e.currentTarget.value }))}
                onKeyDown={(e) => onActionKey(e, line)}
              />
            </div>
          );
        }
        const speaker = line.speakerId ? project.objects[line.speakerId] : undefined;
        const list = suggestionsFor(line);
        const ghost = ghostFor(line);
        const index = typing?.id === line.id ? Math.min(typing.index, Math.max(0, list.length - 1)) : 0;
        const showParen = !!line.direction || paren === line.id;
        return (
          <div key={line.id} className="line line-dialogue" data-line={line.id}>
            <span className="line-meta">
              <span title="Voice-over status">VO: {line.vo === 'recorded' ? 'recorded' : line.vo === 'todo' ? 'to record' : 'none'}</span>
              <span className="mono">#{line.order}</span>
            </span>
            <div className="cue-wrap">
              <Symbol type="character" size={10} color={characterColor(project, line.speakerId)} />
              <input
                key={line.speakerId ?? 'none'}
                className={`line-cue${speaker ? '' : ' missing'}`}
                aria-label="Character"
                aria-autocomplete="list"
                aria-expanded={list.length > 0}
                defaultValue={speaker?.name ?? ''}
                placeholder={ghost ? `${ghost.name.toUpperCase()} · Tab` : 'CHARACTER'}
                spellCheck={false}
                autoComplete="off"
                onFocus={() => {
                  if (taken.current === line.id) taken.current = null;
                }}
                onInput={(e) => setTyping({ id: line.id, query: e.currentTarget.value, index: 0 })}
                onKeyDown={(e) => onCueKey(e, line)}
                onBlur={(e) => {
                  if (taken.current === line.id) {
                    taken.current = null;
                    return;
                  }
                  // A name typed and left: the character it starts (as if Tab took it), or a new one.
                  const typed = e.currentTarget.value.trim();
                  setTyping(null);
                  if (typed && typed.toLowerCase() !== (speaker?.name ?? '').toLowerCase()) {
                    const name = speakerSuggestions(latest.current, sceneId, typed).find((o) => o.name.toLowerCase().startsWith(typed.toLowerCase()))?.name ?? typed;
                    onCommit(setSpeakerByName(latest.current, line.id, name).project);
                  } else if (!typed && speaker) e.currentTarget.value = speaker.name;
                }}
              />
              {list.length > 0 && (
                <ul
                  className="cue-suggest"
                  role="listbox"
                  aria-label="Characters"
                  // At the foot of the script, scroll so the list isn't cut off.
                  ref={(el) => el?.scrollIntoView?.({ block: 'nearest' })}
                >
                  {list.map((o, i) => (
                    <li
                      key={o.id}
                      role="option"
                      aria-selected={i === index}
                      className={i === index ? 'on' : ''}
                      // Keep the caret in the cue while picking.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        takeCue(line, o.name);
                      }}
                    >
                      <Symbol type="character" size={10} color={characterColor(project, o.id)} />
                      {o.name.toUpperCase()}
                      {!inScene(project, sceneId, o.id) && <span className="menu-note">not in this scene yet</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {showParen && (
              <input
                key={line.direction}
                className="line-direction"
                aria-label="Parenthetical"
                defaultValue={line.direction ? `(${line.direction})` : ''}
                placeholder="(parenthetical)"
                onBlur={(e) => saveParen(line, e.currentTarget)}
                onKeyDown={(e) => onParenKey(e, line)}
              />
            )}
            <textarea
              key={line.text}
              className="line-text"
              aria-label={`Line for ${speaker?.name ?? 'no speaker'}`}
              defaultValue={line.text}
              placeholder="What they say…"
              rows={1}
              onInput={(e) => fit(e.currentTarget)}
              onBlur={(e) => e.currentTarget.value !== line.text && onCommit(updateLine(latest.current, line.id, { text: e.currentTarget.value }))}
              onKeyDown={(e) => onTextKey(e, line)}
            />
          </div>
        );
      })}
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
      <span>Next:</span>
      <button onClick={addDialogue}>Character</button>
      <button onClick={() => onCommit(addLine(project, sceneId, 'action', last?.id).project)}>Action</button>
      <button onClick={() => onCommit(addLine(project, sceneId, 'transition', last?.id).project)}>Transition</button>
      <span
        className="script-keys mono"
        title="In a cue: type a name, Tab or Enter takes the suggestion · after dialogue, Enter starts the next cue · Enter on an empty cue: action · Tab in dialogue: (parenthetical) · Tab on an empty action line: a cue · Ctrl/Cmd+1–6: heading, action, character, parenthetical, dialogue, transition"
      >
        Enter next · Tab switches
      </span>
    </div>
  );
};

/** A list of completions under what is being typed; a click takes one without losing the caret. */
const Suggestions = ({ label, items, index, onPick }: { label: string; items: { key: string; label: string }[]; index: number; onPick: (key: string) => void }) => (
  <ul className="cue-suggest" role="listbox" aria-label={label} ref={(el) => el?.scrollIntoView?.({ block: 'nearest' })}>
    {items.map((item, i) => (
      <li
        key={item.key}
        role="option"
        aria-selected={i === index}
        className={i === index ? 'on' : ''}
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(item.key);
        }}
      >
        {item.label}
      </li>
    ))}
  </ul>
);
