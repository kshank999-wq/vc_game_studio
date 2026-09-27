import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePreferences } from '../../preferences';
import { newId } from '../../model/project';
import { addLine, characterNamed, continues, headingSuggestions, inScene, nextSpeaker, sceneHeading, sceneLines, setSceneHeading, speakers, transitionSuggestions } from '../../model/scene';
import { cueNames, cueText, fromElements, lineIdOf, resolveCue, sameScript, toElements, type ScriptElement } from '../../model/script-elements';
import { autoType, cueName, EXTENSION_GROUPS, EXTENSIONS, hasExtension, onEnter, onTab, reformatText, retype, STYLE_SHORTCUTS, withExtension, type ElementType, type Typing } from '../../model/screenplay';
import type { Project } from '../../model/types';
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

const characterColor = (project: Project, id: string | null | undefined): string =>
  (id && (project.objects[id]?.data.color as string | undefined)) || 'var(--c-character)';

/** The styles a line can be set to here; the scene heading is the script's first line, above. */
const LINE_TYPES: readonly ElementType[] = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general'];

const LABEL: Record<ElementType, string> = {
  scene_heading: 'Scene heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
};

const PLACEHOLDER: Partial<Record<ElementType, string>> = {
  action: 'What happens…',
  character: 'CHARACTER',
  parenthetical: '(parenthetical)',
  dialogue: 'What they say…',
  transition: 'CUT TO:',
  shot: 'ANGLE ON',
  general: 'General',
};

const isSpeech = (type: ElementType) => type === 'character' || type === 'parenthetical' || type === 'dialogue';

/** The completion list open under a cue or a transition, and the highlighted entry (-1: none yet). */
interface Offer {
  id: string;
  index: number;
}

/**
 * The scene's script, written with VC Writer's editor (spec §12): one line
 * per element — action, a character cue, a parenthetical, dialogue, a
 * transition, a shot — and the keyboard every screenwriting program has
 * trained into its writers. The rules are VC Writer's (`model/screenplay.ts`):
 *
 *  - **Tab** re-types the line you are on — action to a character cue, a cue
 *    to a parenthetical, dialogue to a parenthetical — and **Shift+Tab**
 *    walks back. Tab beside a name first asks which voice it is: (V.O.),
 *    (O.S.), (INTO PHONE)…
 *  - **Return** starts the next line in the style that continues the work:
 *    a cue gives dialogue, dialogue gives action.
 *  - **Ctrl/Cmd+1…7** set the style outright (1 goes to the scene heading).
 *  - A line of action that reads `CUT TO:` becomes a transition.
 *  - A script pasted as text comes in as sluglines, cues and dialogue.
 *  - Cues complete from the cast, whoever is likeliest to speak next first. A
 *    name nobody has yet makes a new character when the writer leaves the
 *    cue, and they join the scene. A cue whose speaker spoke last, with only
 *    action between, is marked (CONT’D).
 *
 * The lines are the scene's `DialogueLine`s underneath (`script-elements.ts`),
 * so the timeline, the dialogue boxes and the handoff read what is written.
 */
export const ScriptEditor = ({ project, sceneId, onCommit, focusLine }: Props) => {
  const { contd } = usePreferences();
  const [elements, setElementsState] = useState<ScriptElement[]>(() => toElements(project, sceneId));
  const els = useRef(elements);
  const latest = useRef(project);
  latest.current = project;
  // The project this script was last read from or written to. Anything else
  // is a change from outside — an undo, the timeline, the inspector — and
  // the script is read again.
  const basis = useRef({ project, sceneId });
  if (basis.current.project !== project || basis.current.sceneId !== sceneId) {
    basis.current = { project, sceneId };
    const fresh = toElements(project, sceneId);
    if (!sameScript(fresh, els.current)) {
      els.current = fresh;
      setElementsState(fresh);
    }
  }

  const [focus, setFocus] = useState<{ id: string; caret?: number } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [extensionsFor, setExtensionsFor] = useState<string | null>(null);
  // Cues whose extensions have been offered: the next Tab walks on.
  const offered = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusLine) return;
    const target = els.current.find((e) => lineIdOf(e.id) === focusLine && e.type === 'dialogue') ?? els.current.find((e) => lineIdOf(e.id) === focusLine);
    if (target) setFocus({ id: target.id });
  }, [focusLine]);

  useLayoutEffect(() => {
    root.current?.querySelectorAll('textarea').forEach((t) => fit(t));
    if (!focus) return;
    const el = focus.id === 'heading' ? root.current?.querySelector<HTMLInputElement>('input.line-heading') : root.current?.querySelector<HTMLTextAreaElement>(`[data-el="${focus.id}"]`);
    if (!el) return;
    el.focus();
    const at = focus.caret ?? el.value.length;
    el.setSelectionRange(at, at);
    setFocus(null);
  });

  const setElements = (next: ScriptElement[]) => {
    els.current = next;
    setElementsState(next);
  };

  /** Write the script into the scene's lines. */
  const save = (next: ScriptElement[] = els.current): Project => {
    const written = fromElements(latest.current, sceneId, next);
    if (written !== latest.current) {
      basis.current = { project: written, sceneId };
      latest.current = written;
      onCommit(written);
    }
    return written;
  };

  /** Save, and the cue just left names somebody: its character, or a new one. */
  const leaveCue = (element: ScriptElement) => {
    const written = save();
    const resolved = resolveCue(written, lineIdOf(element.id));
    if (resolved === written) return;
    basis.current = { project: resolved, sceneId };
    latest.current = resolved;
    onCommit(resolved);
    // The cue reads as the character's name now, however it was typed.
    const line = resolved.lines.find((l) => l.id === lineIdOf(element.id));
    if (line) setElements(els.current.map((e) => (e.id === element.id ? { ...e, text: cueText(resolved, line) } : e)));
  };

  const update = (id: string, patch: Partial<ScriptElement>) => setElements(els.current.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const insertAfter = (index: number, wanted: ElementType, text = '') => {
    // A slugline in the middle of a scene would be another scene; here it is action.
    const type = wanted === 'scene_heading' ? 'action' : wanted;
    const made = retype(text, type, type);
    const element: ScriptElement = { id: newId('line'), type, text: made.text };
    const next = [...els.current];
    next.splice(index + 1, 0, element);
    setElements(next);
    save(next);
    setFocus({ id: element.id, caret: made.caret });
  };

  /** This line, re-typed as another style, with its punctuation put right. */
  const becomes = (given: ScriptElement, type: ElementType) => {
    const element = els.current.find((e) => e.id === given.id) ?? given;
    if (type === 'scene_heading') {
      save();
      setFocus({ id: 'heading' });
      return;
    }
    const made = retype(element.text, element.type, type);
    const next = els.current.map((e) => (e.id === element.id ? { ...e, type, text: made.text } : e));
    setElements(next);
    save(next);
    setFocus({ id: element.id, caret: made.caret });
  };

  const apply = (typing: Typing, element: ScriptElement, index: number) => {
    if (typing.newLine) insertAfter(index, typing.type);
    else becomes(element, typing.type);
  };

  const removeAt = (index: number) => {
    const previous = els.current[index - 1];
    const next = els.current.filter((_, i) => i !== index);
    setElements(next);
    save(next);
    setFocus(previous ? { id: previous.id } : { id: 'heading' });
  };

  /** Text as it is typed, and the style the line turns out to be. */
  const writeText = (element: ScriptElement, text: string) => {
    const become = autoType(element.type, text);
    update(element.id, become && become !== 'scene_heading' ? { text, type: become } : { text });
    if (element.type === 'character' || element.type === 'transition') setOffer({ id: element.id, index: text.trim() ? 0 : -1 });
  };

  // ------------------------------------------------------------ completion

  /** The speech an element belongs to: its cue, walking back. */
  const cueOf = (index: number): ScriptElement | undefined => {
    for (let i = index; i >= 0; i--) {
      const e = els.current[i]!;
      if (e.type === 'character') return e;
      if (!isSpeech(e.type)) return undefined;
    }
    return undefined;
  };

  /** Names for the cue being typed, best first. */
  const cueList = (element: ScriptElement): string[] => {
    const typed = element.text.trim().toLowerCase();
    if (typed.includes('(')) return [];
    const names = cueNames(latest.current, sceneId, lineIdOf(element.id));
    const list = typed ? [...names.filter((n) => n.toLowerCase().startsWith(typed)), ...names.filter((n) => !n.toLowerCase().startsWith(typed) && n.toLowerCase().split(/\s+/).some((w) => w.startsWith(typed)))] : names;
    // The name already typed in full needs no offering.
    return list.length === 1 && list[0]!.toLowerCase() === typed ? [] : list.slice(0, 6);
  };

  const listFor = (element: ScriptElement): string[] => {
    if (offer?.id !== element.id) return [];
    if (element.type === 'character') return cueList(element);
    if (element.type === 'transition') {
      const list = element.text.trim() ? transitionSuggestions(element.text) : [];
      return list.length === 1 && list[0] === element.text.trim().toUpperCase() ? [] : list;
    }
    return [];
  };

  /** Take a completion into the line. */
  const take = (element: ScriptElement, pick: string): ScriptElement => {
    const text = element.type === 'character' ? (characterNamed(latest.current, pick)?.name ?? pick) : pick;
    const taken = { ...element, text };
    update(element.id, { text });
    setOffer(null);
    return taken;
  };

  // ------------------------------------------------------------ the keyboard

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, original: ScriptElement, index: number) => {
    const input = e.currentTarget;
    let element = els.current[index] ?? original;
    const chord = e.ctrlKey || e.metaKey;

    // The completion list, while it is open.
    const list = listFor(element);
    if (list.length) {
      const at = Math.min(offer?.index ?? -1, list.length - 1);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setOffer({ id: element.id, index: at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOffer(null);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
        if (at >= 0) {
          element = take(element, list[at]!);
          if (e.key === 'Tab') {
            // Completed; the next Tab asks which voice it is.
            e.preventDefault();
            save(els.current);
            return;
          }
        }
      }
    }

    const empty = element.text.trim().length === 0;

    // Ctrl/Cmd+1…9 sets the style outright.
    if (chord && !e.altKey && STYLE_SHORTCUTS[e.key]) {
      e.preventDefault();
      if (element.type === 'character') leaveCue(element);
      becomes(element, STYLE_SHORTCUTS[e.key]!);
      return;
    }

    // Return continues what you are doing.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setOffer(null);
      if (element.type === 'character') leaveCue(element);
      apply(onEnter(element.type, empty), element, index);
      return;
    }

    // Tab reaches for the next mode rather than moving focus.
    if (e.key === 'Tab') {
      e.preventDefault();
      setOffer(null);
      const typing = onTab(element.type, { empty, extensionOffered: offered.current.has(element.id) || hasExtension(element.text), direction: e.shiftKey ? -1 : 1 });
      if (typing.extensions) {
        offered.current.add(element.id);
        setExtensionsFor(element.id);
        return;
      }
      setExtensionsFor(null);
      if (element.type === 'character') leaveCue(element);
      apply(typing, element, index);
      return;
    }

    // Backspace at the very start of an empty line removes it.
    if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (element.text.length === 0 || (element.type === 'parenthetical' && element.text === '()')) {
        e.preventDefault();
        setOffer(null);
        removeAt(index);
      }
      return;
    }

    if (e.key === 'ArrowUp' && input.selectionStart === 0 && !list.length) {
      e.preventDefault();
      const previous = els.current[index - 1];
      setFocus(previous ? { id: previous.id } : { id: 'heading' });
      return;
    }

    if (e.key === 'ArrowDown' && input.selectionStart === input.value.length && !list.length) {
      const next = els.current[index + 1];
      if (next) {
        e.preventDefault();
        setFocus({ id: next.id, caret: 0 });
      }
    }
  };

  const onBlur = (id: string) => {
    const element = els.current.find((e) => e.id === id);
    if (offer?.id === id) setOffer(null);
    if (!element) return;
    if (element.type === 'parenthetical') {
      // A parenthetical left half-open closes itself.
      const closed = retype(element.text, 'parenthetical', 'parenthetical').text;
      if (closed !== element.text) setElements(els.current.map((e) => (e.id === id ? { ...e, text: closed } : e)));
    }
    if (element.type === 'transition' && element.text !== element.text.toUpperCase()) setElements(els.current.map((e) => (e.id === id ? { ...e, text: e.text.toUpperCase() } : e)));
    if (element.type === 'character') leaveCue(element);
    else save();
  };

  /** A script pasted as text comes in as the elements it is. */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, element: ScriptElement, index: number) => {
    const parts = reformatText(e.clipboardData.getData('text/plain'));
    if (parts.length <= 1) return;
    e.preventDefault();
    let project = latest.current;
    // A slugline first, into a scene without one, is the scene's heading.
    if (parts[0]!.type === 'scene_heading' && !sceneHeading(project, sceneId)) {
      project = setSceneHeading(project, sceneId, parts.shift()!.text);
      latest.current = project;
    }
    const input = e.currentTarget;
    const before = element.text.slice(0, input.selectionStart);
    const after = element.text.slice(input.selectionEnd);
    const made = parts.map((p): ScriptElement => ({ id: newId('line'), type: p.type === 'scene_heading' ? 'action' : p.type, text: p.text }));
    if (!made.length) return;
    const next = [...els.current];
    if (before.trim()) {
      next[index] = { ...element, text: before };
      next.splice(index + 1, 0, ...made);
    } else next.splice(index, 1, ...made);
    const last = made[made.length - 1]!;
    last.text += after;
    setElements(next);
    save(next);
    setFocus({ id: last.id, caret: last.text.length - after.length });
  };

  // ------------------------------------------------------------ the scene heading

  const [heading, setHeading] = useState<{ query: string; index: number } | null>(null);
  const headingList = heading ? headingSuggestions(latest.current, sceneId, heading.query).slice(0, 8) : [];

  /** The heading as typed becomes the scene's; with `go`, the caret goes on to the first line. */
  const commitHeading = (el: HTMLInputElement, go: boolean) => {
    setHeading(null);
    const typed = el.value.trim();
    let next = save();
    if (typed && typed !== sceneHeading(next, sceneId)) next = setSceneHeading(next, sceneId, typed);
    el.value = sceneHeading(next, sceneId);
    if (next !== latest.current) {
      basis.current = { project: next, sceneId };
      latest.current = next;
      onCommit(next);
    }
    if (!go) return;
    const first = els.current[0];
    if (first) setFocus({ id: first.id });
    else insertAfter(-1, 'action');
  };

  const onHeadingKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const list = headingList;
    const index = Math.min(heading?.index ?? 0, Math.max(0, list.length - 1));
    if ((e.ctrlKey || e.metaKey) && /^[2-9]$/.test(e.key)) {
      // From the heading, a style shortcut goes to the first line.
      e.preventDefault();
      commitHeading(el, true);
    } else if (e.key === 'ArrowDown' && !list.length && els.current[0]) {
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

  // ------------------------------------------------------------ drawing

  const row = (element: ScriptElement, index: number) => {
    const line = latest.current.lines.find((l) => l.id === lineIdOf(element.id));
    const cue = element.type === 'dialogue' ? cueOf(index) : undefined;
    const speakerName = cue ? cueName(cue.text) : '';
    const list = listFor(element);
    const at = Math.min(offer?.index ?? -1, list.length - 1);
    const label = element.type === 'dialogue' ? `Line for ${(speakerName && (characterNamed(latest.current, speakerName)?.name ?? speakerName)) || 'no speaker'}` : LABEL[element.type];
    const ghost = element.type === 'character' && !element.text ? cueNames(latest.current, sceneId, lineIdOf(element.id))[0] : undefined;
    return (
      <div key={element.id} className={`element element-${element.type}`} data-line={lineIdOf(element.id)}>
        <select className="element-type" value={element.type} aria-label="Element type" tabIndex={-1} onChange={(e) => becomes(element, e.currentTarget.value as ElementType)}>
          {LINE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LABEL[t]}
            </option>
          ))}
        </select>
        <div className="field">
          {element.type === 'character' && <Symbol type="character" size={10} color={characterColor(latest.current, line?.speakerId)} />}
          <textarea
            data-el={element.id}
            className={element.type === 'character' ? `line-cue${line?.speakerId || !element.text ? '' : ' unnamed'}` : element.type === 'parenthetical' ? 'line-direction' : 'line-text'}
            rows={1}
            aria-label={label}
            aria-autocomplete={element.type === 'character' || element.type === 'transition' ? 'list' : undefined}
            aria-expanded={element.type === 'character' ? list.length > 0 : undefined}
            placeholder={ghost ?? PLACEHOLDER[element.type]}
            spellCheck={element.type !== 'character' && element.type !== 'transition'}
            autoComplete="off"
            value={element.text}
            // A cue is as wide as its name, so (CONT’D) sits beside it.
            style={element.type === 'character' ? { width: `calc(${(element.text || ghost || 'CHARACTER').length + 1}ch + 20px)` } : undefined}
            onFocus={() => (element.type === 'character' || element.type === 'transition') && setOffer({ id: element.id, index: element.text.trim() ? 0 : -1 })}
            onChange={(e) => {
              writeText(element, e.currentTarget.value);
              fit(e.currentTarget);
            }}
            onKeyDown={(e) => onKey(e, element, index)}
            onBlur={() => onBlur(element.id)}
            onPaste={(e) => onPaste(e, element, index)}
          />
          {element.type === 'character' && contd && line?.speakerId && !hasExtension(element.text) && continues(latest.current, line.id) && (
            <span className="line-contd" title="The same character spoke last, with only action between">
              (CONT’D)
            </span>
          )}
          {list.length > 0 && (
            <Suggestions
              label={element.type === 'character' ? 'Characters' : 'Transitions'}
              items={list.map((name) => {
                const who = element.type === 'character' ? characterNamed(latest.current, name) : undefined;
                return {
                  key: name,
                  label: name.toUpperCase(),
                  ...(who ? { color: characterColor(latest.current, who.id), note: inScene(latest.current, sceneId, who.id) ? undefined : 'not in this scene yet' } : {}),
                };
              })}
              index={at}
              onPick={(name) => {
                const taken = take(element, name);
                if (element.type === 'character') {
                  leaveCue(taken);
                  insertAfter(index, 'dialogue');
                } else {
                  save();
                  insertAfter(index, 'action');
                }
              }}
            />
          )}
        </div>
        {extensionsFor === element.id && (
          <ExtensionMenu
            onPick={(mark) => {
              const text = withExtension(element.text, mark);
              const next = els.current.map((e) => (e.id === element.id ? { ...e, text } : e));
              setElements(next);
              save(next);
              setExtensionsFor(null);
              setFocus({ id: element.id });
            }}
            onClose={() => {
              setExtensionsFor(null);
              setFocus({ id: element.id });
            }}
          />
        )}
      </div>
    );
  };

  // A speech — cue, parentheticals, dialogue — is drawn as one block.
  const blocks: { speech: boolean; items: { element: ScriptElement; index: number }[] }[] = [];
  elements.forEach((element, index) => {
    const speech = isSpeech(element.type);
    const last = blocks[blocks.length - 1];
    if (speech && last?.speech && element.type !== 'character') last.items.push({ element, index });
    else blocks.push({ speech, items: [{ element, index }] });
  });

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
      {elements.length === 0 && (
        <div className="script-empty">
          <p>Write what happens: the setting, what the player sees, then who speaks.</p>
          <div className="script-empty-actions">
            <button className="tb-btn" onClick={() => insertAfter(-1, 'action')}>
              Start with action
            </button>
            <button className="tb-btn" onClick={() => insertAfter(-1, 'character')}>
              Start with a character
            </button>
          </div>
        </div>
      )}
      {blocks.map((block) =>
        block.speech ? (
          <div key={`speech-${block.items[0]!.element.id}`} className="line line-dialogue">
            <SpeechMeta project={project} lineId={lineIdOf(block.items[0]!.element.id)} />
            {block.items.map(({ element, index }) => row(element, index))}
          </div>
        ) : (
          <Fragment key={block.items[0]!.element.id}>{block.items.map(({ element, index }) => row(element, index))}</Fragment>
        ),
      )}
    </div>
  );
};

/** A speech's voice-over status and its place in the scene, shown where the writer is. */
const SpeechMeta = ({ project, lineId }: { project: Project; lineId: string }) => {
  const line = project.lines.find((l) => l.id === lineId);
  if (!line || line.kind !== 'dialogue') return null;
  return (
    <span className="line-meta">
      <span title="Voice-over status">VO: {line.vo === 'recorded' ? 'recorded' : line.vo === 'todo' ? 'to record' : 'none'}</span>
      <span className="mono">#{line.order}</span>
    </span>
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
        title="As in VC Writer and Final Draft — Tab changes the line: action → character → (extension) → parenthetical; in dialogue, a parenthetical · Shift+Tab walks back · Return starts the next line: a cue gives dialogue, dialogue gives action · Ctrl/Cmd+1–7: heading, action, character, parenthetical, dialogue, transition, shot · Backspace on an empty line removes it · paste a script as text and it comes in formatted"
      >
        Return next · Tab changes
      </span>
    </div>
  );
};

/** A list of completions under what is being typed; a click takes one without losing the caret. */
const Suggestions = ({ label, items, index, onPick }: { label: string; items: { key: string; label: string; color?: string; note?: string }[]; index: number; onPick: (key: string) => void }) => (
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
        {item.color && <Symbol type="character" size={10} color={item.color} />}
        {item.label}
        {item.note && <span className="menu-note">{item.note}</span>}
      </li>
    ))}
  </ul>
);

/**
 * The extensions a cue can carry, grouped the way they are used and each
 * saying what it means (VC Writer's menu).
 */
const ExtensionMenu = ({ onPick, onClose }: { onPick(mark: string): void; onClose(): void }) => {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div
      ref={panel}
      className="extension-menu"
      role="menu"
      aria-label="Extension"
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = [...(panel.current?.querySelectorAll('button') ?? [])];
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }
      }}
    >
      {EXTENSION_GROUPS.map((group) => {
        const marks = EXTENSIONS.filter((x) => x.group === group.id);
        return marks.length ? (
          <Fragment key={group.id}>
            <h5>{group.label}</h5>
            {marks.map((x) => (
              <button key={x.mark} type="button" role="menuitem" className="extension-item" onClick={() => onPick(x.mark)}>
                <span className="extension-mark">{x.mark}</span>
                <span className="extension-term">{x.term}</span>
                <span className="extension-what">{x.what}</span>
              </button>
            ))}
          </Fragment>
        ) : null;
      })}
      <button type="button" role="menuitem" className="extension-item" onClick={() => onPick('')}>
        <span className="extension-mark">—</span>
        <span className="extension-term">No extension</span>
      </button>
    </div>
  );
};
