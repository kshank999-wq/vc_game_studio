/**
 * The screenplay editor's rules, taken from VC Writer (packages/domain
 * `editing.ts` and `reformat.ts`), screenplay format only.
 *
 * A screenplay editor earns its keep by knowing what comes next: press Return
 * after a character cue and you are writing dialogue, press it after dialogue
 * and you are back in action. Tab changes the line you are on when the guess
 * is wrong. The tables live here rather than in the component so the
 * behaviour is pinned by tests instead of by whichever keydown handler ran.
 */

export type ElementType = 'scene_heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'shot' | 'general';

/** What pressing Return at the end of an element should create next. */
const ON_ENTER: Record<ElementType, ElementType> = {
  scene_heading: 'action',
  action: 'action',
  shot: 'action',
  general: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  transition: 'scene_heading',
};

/** The order Shift+Tab walks back through. */
export const CYCLE: readonly ElementType[] = ['scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot'];

export const cycleType = (current: ElementType, direction: 1 | -1 = 1): ElementType => {
  const index = CYCLE.indexOf(current);
  if (index === -1) return CYCLE[0]!;
  return CYCLE[(index + direction + CYCLE.length) % CYCLE.length]!;
};

export const isDialogueElement = (type: ElementType): boolean => type === 'character' || type === 'parenthetical' || type === 'dialogue';

/**
 * What a keystroke does to the line being written: which style it becomes,
 * and whether that style starts a new line or re-types the one in hand.
 */
export interface Typing {
  type: ElementType;
  /** True: start a new element. False: re-type the current element in place. */
  newLine: boolean;
  /**
   * Offer the list of extensions for the cue in hand instead of changing the
   * line: Tab beside a character's name asks *which* voice this is, and only
   * the next Tab moves on.
   */
  extensions?: true;
}

const line = (type: ElementType): Typing => ({ type, newLine: true });
const here = (type: ElementType): Typing => ({ type, newLine: false });

export interface TabContext {
  /** Nothing has been typed on the line yet. */
  empty?: boolean;
  /** The extensions have already been offered for this cue, or one is on it. */
  extensionOffered?: boolean;
  direction?: 1 | -1;
}

/**
 * The two keys a screenplay is written with, as Final Draft defines them:
 * **Tab changes the line you are on** into the style that comes next when
 * you are changing mode — action to a character cue, a cue to a
 * parenthetical, dialogue to a parenthetical — and **Return** starts a new
 * line in the style that continues what you are doing. Shift+Tab walks back
 * through the styles.
 */
export const onTab = (current: ElementType, context: TabContext = {}): Typing => {
  const direction = context.direction ?? 1;
  if (direction === -1) return here(cycleType(current, -1));
  switch (current) {
    case 'scene_heading':
      return here('action');
    case 'action':
      return here('character');
    case 'character':
      // Beside a name: which voice is this? Only the Tab after that moves on.
      // An empty cue has no name to qualify, so it walks straight past.
      return context.empty || context.extensionOffered ? here('parenthetical') : { type: 'character', newLine: false, extensions: true };
    case 'parenthetical':
      return here('dialogue');
    case 'dialogue':
      // A parenthetical qualifies the speech you are in the middle of.
      return here('parenthetical');
    case 'transition':
      return here('scene_heading');
    default:
      return here('action');
  }
};

export const onEnter = (current: ElementType, isEmpty: boolean): Typing => {
  // A parenthetical is opened and closed on its own line; Return leaves it
  // for the speech it qualifies, in place if nothing was typed in it.
  if (current === 'parenthetical') return isEmpty ? here('dialogue') : line('dialogue');
  return line(ON_ENTER[current] ?? 'action');
};

/**
 * A line re-typed into another style, and where the caret lands in it. A
 * parenthetical is written **inside** its parentheses, which arrive the
 * moment the line becomes one; re-typing it as something else takes them off.
 */
export interface Retyped {
  text: string;
  caret: number;
}

/** The words inside a parenthetical, with any brackets and spacing taken off. */
export const insideParentheses = (text: string): string => {
  let inner = text.trim();
  while (inner.startsWith('(') || inner.endsWith(')')) inner = inner.replace(/^\(+/, '').replace(/\)+$/, '').trim();
  return inner;
};

export const retype = (text: string, from: ElementType, to: ElementType): Retyped => {
  if (to === 'parenthetical') {
    const inner = insideParentheses(text);
    return { text: `(${inner})`, caret: inner.length + 1 };
  }
  if (from === 'parenthetical') {
    const inner = insideParentheses(text);
    return { text: inner, caret: inner.length };
  }
  return { text, caret: text.length };
};

// ---------------------------------------------------------------- auto-type: the style a line turns out to be

/** A line of action that starts this way is a scene heading. */
export const SCENE_PREFIX = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s/i;

/** Lines that are transitions when they are the whole line. */
export const TRANSITION_WORDS = ['CUT TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'DISSOLVE TO:', 'FADE TO:', 'WIPE TO:', 'FADE IN:', 'FADE OUT.', 'CUT TO BLACK.', 'FADE TO BLACK.', 'THE END'] as const;

/** Lines that are shot descriptions when a line starts with one. */
export const SHOT_WORDS = ['ANGLE ON', 'CLOSE ON', 'CLOSER ON', 'WIDE ON', 'BACK TO SCENE', 'INSERT', 'POV', 'PAN TO', 'PUSH IN', 'PULL BACK', 'TRACKING SHOT', 'AERIAL SHOT', 'REVERSE ANGLE'] as const;

export interface AutoTypeOptions {
  /** Shot detection is off by default: "INSERT" is a word writers use in action. */
  detectShots?: boolean;
}

/**
 * The style a line of action turns out to be from what has been typed into
 * it: a slugline when it opens with INT./EXT., a transition when the whole
 * line is one, a shot when shot detection is on. Null when the line is what
 * it says it is. Only ever re-types plain action.
 */
export const autoType = (current: ElementType, text: string, options: AutoTypeOptions = {}): ElementType | null => {
  if (current !== 'action' && current !== 'general') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (SCENE_PREFIX.test(trimmed)) return 'scene_heading';
  if (TRANSITION_WORDS.some((word) => upper === word)) return 'transition';
  if (options.detectShots && SHOT_WORDS.some((word) => upper.startsWith(word))) return 'shot';
  return null;
};

// ---------------------------------------------------------------- character extensions

/**
 * The extensions a character cue can carry, grouped the way they are used,
 * each saying what it means — "(P.A.)" on a menu tells nobody anything.
 */
export interface CharacterExtension {
  mark: string;
  term: string;
  what: string;
  group: 'standard' | 'audio' | 'frame' | 'language';
}

export const EXTENSIONS: readonly CharacterExtension[] = [
  { mark: '(V.O.)', term: 'Voiceover', what: 'Not in the scene at all: a narrator, an inner monologue, a voice we never cut to.', group: 'standard' },
  { mark: '(O.S.)', term: 'Off-screen', what: 'In the room, out of shot — shouting from the kitchen, hidden in a closet.', group: 'standard' },
  { mark: '(O.C.)', term: 'Off-camera', what: 'Off-screen, as multi-camera sitcoms write it.', group: 'standard' },
  { mark: "(CONT'D)", term: 'Continued', what: 'The same person carrying on after action interrupted them. Usually written for you.', group: 'standard' },
  { mark: '(FILTERED)', term: 'Filtered', what: 'Through a device: a radio, a phone, a helmet, a recording. Often alongside (V.O.).', group: 'audio' },
  { mark: '(P.A.)', term: 'Public address', what: 'Over a loudspeaker, an intercom or a megaphone, heard by the room.', group: 'audio' },
  { mark: '(TAPE)', term: 'Tape recording', what: 'The characters are listening to a recording.', group: 'audio' },
  { mark: '(O.F.)', term: 'Off-frame', what: 'In the room, just outside the frame. A variant of (O.S.).', group: 'frame' },
  { mark: '(INTO PHONE)', term: 'Into phone', what: 'On screen, speaking into the receiver rather than to the room.', group: 'frame' },
  { mark: '(LOUDSPEAKER)', term: 'Loudspeaker', what: 'An alternative to (P.A.), in historical and military scripts.', group: 'frame' },
  { mark: '(SUBTITLED)', term: 'Subtitled', what: 'A foreign language or sign language: text must be laid over the picture.', group: 'language' },
];

export const EXTENSION_GROUPS: ReadonlyArray<{ id: CharacterExtension['group']; label: string }> = [
  { id: 'standard', label: 'The standard three' },
  { id: 'audio', label: 'Through a device' },
  { id: 'frame', label: 'Where they are' },
  { id: 'language', label: 'Language' },
];

export const CHARACTER_EXTENSIONS = EXTENSIONS.map((e) => e.mark);

/** Whether a cue already carries an extension, which is what Tab looks at. */
export const hasExtension = (cue: string): boolean => /\([^)]*\)\s*$/.test(cue.trim());

/** The cue with an extension on it, replacing one already there. */
export const withExtension = (cue: string, mark: string): string => {
  const name = cueName(cue);
  return mark.length === 0 ? name : `${name} ${mark}`;
};

/** A cue's name without its extension: MAEVE, `MAEVE (V.O.)` and `MAEVE (CONT'D)` are one person. */
export const cueName = (cue: string): string => cue.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();

/** A cue's extension, "(V.O.)", or empty. */
export const cueExtension = (cue: string): string => /(\([^)]*\))\s*$/.exec(cue.trim())?.[1] ?? '';

/**
 * Character cues to offer while typing one, best first: whoever spoke in this
 * scene most recently comes first — but not the speaker of the line just
 * above, because dialogue alternates. Everyone else follows, in the order
 * `everyone` gives them (the scene's cast first).
 */
export const cueSuggestions = (everyone: readonly string[], spokenInOrder: readonly string[]): string[] => {
  const recent: string[] = [];
  for (let i = spokenInOrder.length - 1; i >= 0; i--) {
    const name = spokenInOrder[i]!.toUpperCase();
    if (!recent.includes(name)) recent.push(name);
  }
  const justSpoke = recent.shift();
  const rest = [...new Set(everyone.map((n) => n.toUpperCase()))].filter((n) => !recent.includes(n) && n !== justSpoke);
  return [...recent, ...rest, ...(justSpoke ? [justSpoke] : [])];
};

/** The paragraph styles bound to Ctrl/Cmd+1…9, the way a screenwriting program numbers them. */
export const STYLE_SHORTCUTS: Record<string, ElementType> = {
  '1': 'scene_heading',
  '2': 'action',
  '3': 'character',
  '4': 'parenthetical',
  '5': 'dialogue',
  '6': 'transition',
  '7': 'shot',
  '9': 'general',
};

// ---------------------------------------------------------------- reading a script pasted as text

export interface ReformattedElement {
  type: ElementType;
  text: string;
}

/** A line that is a character cue and not a shout in the middle of action. */
const looksLikeCue = (line: string): boolean => {
  const text = line.trim();
  if (!text || text.length > 40 || !/[A-Z]/.test(text)) return false;
  if (text !== text.toUpperCase()) return false;
  if (/[.!?]$/.test(text.replace(/\s*\(.*\)\s*$/, ''))) return false;
  return true;
};

const looksLikeTransitionLine = (line: string): boolean => {
  const text = line.trim().toUpperCase();
  if (!text || text.length > 30) return false;
  return TRANSITION_WORDS.some((word) => text === word) || /\bTO:$/.test(text);
};

const isParenthetical = (line: string): boolean => /^\(.*\)$/.test(line.trim());

const PASTE_SCENE_PREFIX = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)[\s.]/i;

/** Lines that belong together, split where the text was left blank. */
const blocksOf = (text: string): string[][] => {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const l = raw.trim();
    if (!l) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(l);
  }
  if (current.length) blocks.push(current);
  return blocks;
};

/** Hard-wrapped lines are one paragraph again. */
const joined = (lines: readonly string[]): string => lines.join(' ').replace(/\s+/g, ' ').trim();

const speechFrom = (lines: readonly string[]): ReformattedElement[] => {
  const out: ReformattedElement[] = [];
  let speech: string[] = [];
  const flush = () => {
    if (speech.length) out.push({ type: 'dialogue', text: joined(speech) });
    speech = [];
  };
  for (const l of lines) {
    if (isParenthetical(l)) {
      flush();
      out.push({ type: 'parenthetical', text: l.trim() });
    } else speech.push(l);
  }
  flush();
  return out;
};

/**
 * Plain text as typed elements: the shape of a screenplay is in the capitals,
 * the indents and the blank lines, and Fountain's forcing characters
 * (`.slug`, `@CUE`, `>TRANSITION:`) are read too. Empty text gives nothing.
 */
export const reformatText = (text: string): ReformattedElement[] => {
  const blocks = blocksOf(text);
  const out: ReformattedElement[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const first = block[0]!.trim();
    const rest = block.slice(1);
    if (/^\.[^.]/.test(first)) {
      out.push({ type: 'scene_heading', text: first.slice(1).trim() });
      if (rest.length) out.push({ type: 'action', text: joined(rest) });
      continue;
    }
    if (first.startsWith('@')) {
      out.push({ type: 'character', text: first.slice(1).trim() }, ...speechFrom(rest));
      continue;
    }
    if (first.startsWith('>')) {
      const t = first.replace(/^>\s*/, '').replace(/\s*<$/, '');
      out.push({ type: first.endsWith('<') ? 'general' : 'transition', text: t });
      if (rest.length) out.push({ type: 'action', text: joined(rest) });
      continue;
    }
    if (PASTE_SCENE_PREFIX.test(first)) {
      out.push({ type: 'scene_heading', text: first });
      if (rest.length) out.push({ type: 'action', text: joined(rest) });
      continue;
    }
    if (block.length === 1 && looksLikeTransitionLine(first)) {
      out.push({ type: 'transition', text: first });
      continue;
    }
    if (looksLikeCue(first)) {
      if (rest.length) {
        out.push({ type: 'character', text: first }, ...speechFrom(rest));
        continue;
      }
      const following = blocks[index + 1];
      if (following && !looksLikeCue(following[0]!) && !PASTE_SCENE_PREFIX.test(following[0]!.trim())) {
        out.push({ type: 'character', text: first }, ...speechFrom(following));
        index++;
        continue;
      }
      out.push({ type: 'action', text: first });
      continue;
    }
    out.push({ type: 'action', text: joined(block) });
  }
  return out;
};
