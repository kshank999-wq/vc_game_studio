import { characterNamed, defaultVo, elementsIn, inScene, sceneLines, setSpeakerByName, useInScene } from './scene';
import { cueExtension, cueName, cueSuggestions, insideParentheses, type ElementType } from './screenplay';
import type { DialogueLine, Project } from './types';

/**
 * The scene's script as VC Writer's editor writes it: one flat list of typed
 * elements — action, a character cue, a parenthetical, dialogue, a
 * transition — each a line of its own. The scene keeps its script as
 * `DialogueLine`s (the timeline, the dialogue boxes and the engine handoff
 * all read those), so this is the two-way reading between them:
 *
 *  - an action or a transition is one element, and one line;
 *  - a speech is its cue, a parenthetical if it has one, and its dialogue.
 *    A parenthetical in the middle of a speech starts a line of its own that
 *    carries on under the same cue (`joined`).
 *
 * Element ids are made from the line ids, so the lines keep their identity —
 * and what hangs off them on the timeline — however the script is re-typed.
 */
export interface ScriptElement {
  id: string;
  type: ElementType;
  text: string;
}

/** JSON with its keys in order, so two lines that say the same compare equal however they were built. */
const stable = (value: unknown): string =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value)
          .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
          .join(',')}}`
    : JSON.stringify(value);

/** The line an element belongs to. */
export const lineIdOf = (elementId: string): string => elementId.split(':')[0]!;

/** A cue as written: the speaker's name (or the name typed), and its extension. */
export const cueText = (project: Project, line: DialogueLine): string => {
  const name = (line.speakerId && project.objects[line.speakerId]?.name) || line.cue || '';
  return line.extension ? `${name} ${line.extension}` : name;
};

export const toElements = (project: Project, sceneId: string): ScriptElement[] =>
  sceneLines(project, sceneId).flatMap((line): ScriptElement[] => {
    if (line.kind === 'action') return [{ id: line.id, type: line.shot ? 'shot' : 'action', text: line.text }];
    if (line.kind === 'transition') return [{ id: line.id, type: 'transition', text: line.text }];
    return [
      ...(line.joined ? [] : [{ id: line.id, type: 'character' as const, text: cueText(project, line) }]),
      ...(line.direction ? [{ id: `${line.id}:paren`, type: 'parenthetical' as const, text: `(${line.direction})` }] : []),
      { id: `${line.id}:text`, type: 'dialogue', text: line.text },
    ];
  });

/** Two element lists that say the same thing, whatever their ids. */
export const sameScript = (a: readonly ScriptElement[], b: readonly ScriptElement[]): boolean =>
  a.length === b.length && a.every((e, i) => e.type === b[i]!.type && e.text === b[i]!.text);

/**
 * The scene's lines, rewritten from its elements. A cue names a character
 * only when it names one exactly; anything else waits in the line as typed
 * until the writer leaves the cue (`resolveCue`), so R, RU, RUV do not
 * become three people.
 */
export const fromElements = (project: Project, sceneId: string, elements: readonly ScriptElement[]): Project => {
  const before = sceneLines(project, sceneId);
  const old = new Map(before.map((l) => [l.id, l]));
  const claimed = new Set<string>();
  const built: DialogueLine[] = [];
  let speech: { speakerId: string | null; cue?: string; extension?: string } | null = null;

  const start = (element: ScriptElement, kind: DialogueLine['kind']): DialogueLine => {
    let id = lineIdOf(element.id);
    for (let n = 2; claimed.has(id); n++) id = `${lineIdOf(element.id)}~${n}`;
    claimed.add(id);
    const prior = old.get(id);
    const line: DialogueLine = {
      id,
      sceneId,
      kind,
      speakerId: null,
      text: '',
      direction: '',
      order: built.length + 1,
      vo: kind !== 'dialogue' ? 'none' : prior?.kind === 'dialogue' ? prior.vo : defaultVo(),
      notes: prior?.notes ?? '',
      ...(prior?.conditions ? { conditions: prior.conditions } : {}),
      ...(prior?.choiceId ? { choiceId: prior.choiceId } : {}),
    };
    built.push(line);
    return line;
  };

  const speaking = (element: ScriptElement, joined: boolean): DialogueLine => {
    const line = start(element, 'dialogue');
    if (speech) {
      line.speakerId = speech.speakerId;
      if (speech.cue !== undefined) line.cue = speech.cue;
      if (speech.extension) line.extension = speech.extension;
    }
    if (joined) line.joined = true;
    return line;
  };

  for (const element of elements) {
    const current = built[built.length - 1];
    switch (element.type) {
      case 'character': {
        const name = cueName(element.text);
        const extension = cueExtension(element.text);
        const who = name ? characterNamed(project, name) : undefined;
        speech = { speakerId: who?.id ?? null, ...(who ? {} : { cue: name }), ...(extension ? { extension } : {}) };
        speaking(element, false);
        break;
      }
      case 'parenthetical': {
        const direction = insideParentheses(element.text);
        if (speech && current?.kind === 'dialogue' && !current.text && !current.direction) current.direction = direction;
        else speaking(element, !!speech).direction = direction;
        if (!speech) speech = { speakerId: null };
        break;
      }
      case 'dialogue': {
        if (speech && current?.kind === 'dialogue' && !current.text) current.text = element.text;
        else speaking(element, !!speech).text = element.text;
        if (!speech) speech = { speakerId: null };
        break;
      }
      case 'transition':
        speech = null;
        start(element, 'transition').text = element.text;
        break;
      default: {
        // Action, a shot, a general line — and a slugline, which in a scene
        // of its own belongs in the heading above.
        speech = null;
        const line = start(element, 'action');
        line.text = element.text;
        if (element.type === 'shot') line.shot = true;
      }
    }
  }

  // Tidy the optional fields, so an unchanged script compares equal.
  for (const line of built) {
    if (line.cue === undefined) delete line.cue;
    if (!line.extension) delete line.extension;
  }
  const same = before.length === built.length && before.every((l, i) => stable(l) === stable(built[i]));
  if (same) return project;
  let next: Project = { ...project, lines: [...project.lines.filter((l) => l.sceneId !== sceneId), ...built] };
  for (const line of built) if (line.speakerId && !inScene(next, sceneId, line.speakerId)) next = useInScene(next, sceneId, line.speakerId);
  return next;
};

/**
 * The writer has left a cue: the name typed is somebody now — the character
 * of that name, or a new one, who joins the scene. Every line of the speech
 * takes them.
 */
export const resolveCue = (project: Project, lineId: string): Project => {
  const line = project.lines.find((l) => l.id === lineId);
  if (!line || line.kind !== 'dialogue' || line.speakerId || !line.cue?.trim()) return project;
  const set = setSpeakerByName(project, lineId, line.cue);
  let next = set.project;
  if (!set.speakerId) return next;
  // The rest of the speech, under the same cue.
  const lines = sceneLines(next, line.sceneId);
  for (let i = lines.findIndex((l) => l.id === lineId) + 1; i < lines.length && lines[i]!.joined; i++) {
    next = { ...next, lines: next.lines.map((l) => (l.id === lines[i]!.id ? (({ cue: _, ...rest }) => ({ ...rest, speakerId: set.speakerId }))(l) : l)) };
  }
  return next;
};

/**
 * Names to offer while a cue is typed, best first (VC Writer's order): who
 * spoke in this scene most recently, but not whoever spoke last; then the
 * scene's cast; then everyone else in the project.
 */
export const cueNames = (project: Project, sceneId: string, beforeLineId?: string): string[] => {
  const lines = sceneLines(project, sceneId);
  const upTo = beforeLineId ? lines.findIndex((l) => l.id === beforeLineId) : -1;
  const spoken = (upTo >= 0 ? lines.slice(0, upTo) : lines)
    .filter((l) => l.kind === 'dialogue' && !l.joined && l.speakerId)
    .map((l) => project.objects[l.speakerId!]!.name);
  const cast = elementsIn(project, sceneId, 'characters').map((c) => c.name);
  const everyone = Object.values(project.objects)
    .filter((o) => o.type === 'character')
    .map((o) => o.name)
    .sort((a, b) => a.localeCompare(b));
  return cueSuggestions([...cast, ...everyone], spoken);
};
