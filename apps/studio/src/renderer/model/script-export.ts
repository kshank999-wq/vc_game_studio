import { toKey } from './keys';
import { markupInline, plainInline } from './inline';
import { lineSubtitle, secondsLabel } from './subtitles';
import { continues, cueLabel, sceneHeading, sceneLines, saidBy } from './scene';
import { hasExtension } from './screenplay';
import type { DialogueLine, Project, StoryObject } from './types';

/**
 * The script, out of the studio: each scene as a screenplay reads — its
 * heading (INT. HOTEL — DAY), what happens, and who says what — as a
 * Fountain file any screenwriting program opens, as a page to print, and as
 * a recording script for the voice actors: every line numbered with the id
 * the engines play it by, who says it, how, and what comes before it.
 *
 * The order is the scene's own: reorder its beats and the script follows.
 */

export interface ScriptOptions {
  /** Mark a speaker carrying on after action with (CONT’D). */
  contd?: boolean;
}

/** The scenes in the order the story plays them: along the graph left to right, then any not on it. */
export const scriptScenes = (project: Project): StoryObject[] => {
  const scenes = Object.values(project.objects).filter((o) => o.type === 'scene');
  const byCode = (a: StoryObject, b: StoryObject) => (a.data.code ?? a.name).localeCompare(b.data.code ?? b.name, undefined, { numeric: true });
  const placed = scenes.filter((s) => project.placements[s.id]).sort((a, b) => project.placements[a.id]!.x - project.placements[b.id]!.x || byCode(a, b));
  return [...placed, ...scenes.filter((s) => !project.placements[s.id]).sort(byCode)];
};

/** The scenes to export: those asked for, else every scene with something written, in story order. */
const scenesFor = (project: Project, sceneIds?: readonly string[]): StoryObject[] =>
  sceneIds ? sceneIds.map((id) => project.objects[id]).filter((s): s is StoryObject => !!s) : scriptScenes(project).filter((s) => project.lines.some((l) => l.sceneId === s.id && l.text.trim()));

/** A scene's heading, or its name as one when it has no place or time yet. */
const headingOf = (project: Project, scene: StoryObject): string => sceneHeading(project, scene.id) || scene.name.toUpperCase();

/** The cue a line is printed under: MARA, RADIO (V.O.), MARA (V.O., RADIO), MARA (INTO PHONE), with (CONT’D) where it carries on. */
export const cueFor = (project: Project, line: DialogueLine, options: ScriptOptions = {}): string => {
  if (line.voiceFrom && project.objects[line.voiceFrom]) return cueLabel(project, line);
  const name = (saidBy(project, line) || 'NO SPEAKER').toUpperCase();
  const cue = line.extension ? `${name} ${line.extension}` : name;
  return options.contd && !hasExtension(cue) && continues(project, line.id) ? `${cue} (CONT’D)` : cue;
};

/** The id a line is played by in the engines (the handoff's): scene code, then its place in the scene. */
export const lineKey = (project: Project, line: DialogueLine): string =>
  `${toKey(String(project.objects[line.sceneId]?.data.code ?? '') || 'scene')}_line_${String(line.order).padStart(2, '0')}`;

// ---------------------------------------------------------------- Fountain

/** A Fountain scene number: letters, digits, dashes and dots. */
const sceneNumber = (scene: StoryObject): string => {
  const n = String(scene.data.code ?? '').replace(/[^A-Za-z0-9.-]+/g, '');
  return n ? ` #${n}#` : '';
};

/** An action line Fountain would read as something else (a heading, a cue, a transition) is forced to action. */
const fountainAction = (text: string): string => {
  const first = text.split('\n')[0]!.trim();
  const shouty = first === first.toUpperCase() && /\p{L}/u.test(first);
  const heading = /^(int|ext|est|int\.?\/ext|i\/e)[.\s]/i.test(first) || first.startsWith('.');
  return heading || first.startsWith('>') || first.startsWith('@') || first.startsWith('!') || (shouty && /TO:$/.test(first)) ? `!${text}` : text;
};

const fountainTransition = (text: string): string => {
  const t = text.trim().toUpperCase();
  return /TO:$/.test(t) ? t : `> ${t}`;
};

/** A scene in Fountain, heading first. */
export const sceneFountain = (project: Project, sceneId: string, options: ScriptOptions = {}): string => {
  const scene = project.objects[sceneId];
  if (!scene) return '';
  const head = headingOf(project, scene);
  // A heading without INT./EXT. is forced to be one.
  const out: string[] = [`${/^(INT|EXT|EST|I\/E)/.test(head) ? '' : '.'}${head}${sceneNumber(scene)}`];
  let speech: string[] | null = null;
  const end = () => {
    if (speech) out.push(speech.join('\n'));
    speech = null;
  };
  for (const line of sceneLines(project, sceneId)) {
    if (line.kind !== 'dialogue') {
      end();
      if (!line.text.trim()) continue;
      out.push(line.kind === 'transition' ? fountainTransition(line.text) : line.shot ? fountainAction(line.text.toUpperCase()) : fountainAction(line.text));
      continue;
    }
    const body = [...(line.direction ? [`(${line.direction})`] : []), line.text.trim() || '…'];
    if (line.joined && speech) {
      (speech as string[]).push(...body);
      continue;
    }
    end();
    const cue = cueFor(project, line, options);
    // A cue with lower-case letters (or none) is forced to be one.
    speech = [`${cue === cue.toUpperCase() && /\p{L}/u.test(cue) ? '' : '@'}${cue}${line.dual ? ' ^' : ''}`, ...body];
  }
  end();
  return out.join('\n\n');
};

/** The whole script in Fountain: a title page, then every scene in story order (or just these). */
export const projectFountain = (project: Project, options: ScriptOptions & { sceneIds?: readonly string[] } = {}): string => {
  const scenes = scenesFor(project, options.sceneIds);
  const title = [`Title: ${project.name || 'Untitled'}`, 'Credit: Written in VC Game Studio', `Draft date: ${new Date().toISOString().slice(0, 10)}`];
  return `${title.join('\n')}\n\n===\n\n${scenes.map((s) => sceneFountain(project, s.id, options)).join('\n\n\n')}\n`;
};

// ---------------------------------------------------------------- printed

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text with its emphasis, for a page. */
const rich = (text: string): string =>
  markupInline(esc(text), (run, s) => {
    let r = run;
    if (s.underline) r = `<u>${r}</u>`;
    if (s.italic) r = `<em>${r}</em>`;
    if (s.bold) r = `<strong>${r}</strong>`;
    return r;
  }).replace(/\n/g, '<br>');

/** A screenplay page: Courier 12, the standard margins. */
const SCRIPT_STYLE = `
@page { size: letter; margin: 1in 1in 1in 1.5in; }
body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1; color: #000; background: #fff; max-width: 6in; margin: 0 auto; padding: 0.5in 0; }
.title { text-align: center; margin: 1in 0 0.6in; padding-bottom: 0.6in; border-bottom: 1px dashed #bbb; page-break-after: always; }
@media print { .title { margin: 3in 0 1in; padding: 0; border: 0; } }
.title h1 { font-size: 12pt; font-weight: normal; text-transform: uppercase; text-decoration: underline; margin: 0 0 1em; }
.title p { margin: 0 0 1em; }
.heading { font-weight: bold; text-transform: uppercase; margin: 2em 0 1em; display: flex; justify-content: space-between; }
.heading .no { font-weight: normal; }
.action { margin: 0 0 1em; }
.speech { margin: 0 0 1em; }
.cue { margin-left: 2in; text-transform: uppercase; }
.paren { margin-left: 1.5in; max-width: 2in; }
.dialogue { margin-left: 1in; max-width: 3.5in; }
.dual { display: flex; gap: 0.25in; margin: 0 0 1em; }
.dual .speech { flex: 1; margin: 0; }
.dual .cue { margin-left: 0.8in; }
.dual .paren { margin-left: 0.4in; }
.dual .dialogue { margin-left: 0; }
.transition { text-align: right; text-transform: uppercase; margin: 0 0 1em; }
.scene { page-break-inside: auto; }
`;

const speechHtml = (project: Project, lines: DialogueLine[], options: ScriptOptions): string =>
  `<div class="speech"><div class="cue">${esc(cueFor(project, lines[0]!, options))}</div>${lines
    .map((l) => `${l.direction ? `<div class="paren">(${esc(l.direction)})</div>` : ''}<div class="dialogue">${rich(l.text.trim() || '…')}</div>`)
    .join('')}</div>`;

/** A scene as a printed screenplay shows it. */
export const sceneHtml = (project: Project, sceneId: string, options: ScriptOptions = {}): string => {
  const scene = project.objects[sceneId];
  if (!scene) return '';
  const parts: string[] = [`<div class="heading"><span>${esc(headingOf(project, scene))}</span>${scene.data.code ? `<span class="no">${esc(String(scene.data.code))}</span>` : ''}</div>`];
  for (const beat of beatsOf(project, sceneId)) {
    const first = beat.lines[0]!;
    if (first.kind === 'action') {
      if (first.text.trim()) parts.push(`<p class="action">${rich(first.shot ? first.text.toUpperCase() : first.text)}</p>`);
    } else if (first.kind === 'transition') {
      if (first.text.trim()) parts.push(`<p class="transition">${esc(first.text)}</p>`);
    } else {
      // A dual speech is printed beside the one before it.
      const speeches = splitSpeeches(beat.lines);
      const html = speeches.map((s) => speechHtml(project, s, options));
      parts.push(speeches.length > 1 ? `<div class="dual">${html.join('')}</div>` : html[0]!);
    }
  }
  return `<section class="scene">${parts.join('\n')}</section>`;
};

/** The printable script: a title page, then the scenes. */
export const scriptHtml = (project: Project, options: ScriptOptions & { sceneIds?: readonly string[] } = {}): string => {
  const scenes = scenesFor(project, options.sceneIds);
  const name = project.name || 'Untitled';
  const title = options.sceneIds?.length === 1 ? '' : `<div class="title"><h1>${esc(name)}</h1><p>Written in VC Game Studio</p></div>`;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(name)} · script</title><style>${SCRIPT_STYLE}</style></head>\n<body>${title}\n${scenes.map((s) => sceneHtml(project, s.id, options)).join('\n')}\n</body></html>\n`;
};

// ---------------------------------------------------------------- beats

/**
 * A beat: one moment of the scene that moves as a whole — a line of action,
 * a transition, or a speech (its cue, with any parenthetical that carries it
 * on, and a dual speech spoken beside it).
 */
export interface Beat {
  /** The first line's id. */
  id: string;
  kind: DialogueLine['kind'];
  lines: DialogueLine[];
}

/** A beat's lines split into the speeches in it: one, or two side by side. */
const splitSpeeches = (lines: DialogueLine[]): DialogueLine[][] => {
  const out: DialogueLine[][] = [];
  for (const l of lines) {
    if (l.joined && out.length) out[out.length - 1]!.push(l);
    else out.push([l]);
  }
  return out;
};

export const beatsOf = (project: Project, sceneId: string): Beat[] => {
  const beats: Beat[] = [];
  for (const line of sceneLines(project, sceneId)) {
    const last = beats[beats.length - 1];
    const carries = line.kind === 'dialogue' && last?.kind === 'dialogue' && (line.joined || (line.dual && !line.joined && splitSpeeches(last.lines).length === 1));
    if (last && carries) last.lines.push(line);
    else beats.push({ id: line.id, kind: line.kind, lines: [line] });
  }
  return beats;
};

/** What a beat says, short: for the beat list and screen readers. */
export const beatSummary = (project: Project, beat: Beat): { cue: string; text: string } => {
  const first = beat.lines[0]!;
  if (first.kind === 'action') return { cue: first.shot ? 'Shot' : 'Action', text: plainInline(first.text) };
  if (first.kind === 'transition') return { cue: 'Transition', text: first.text };
  const speeches = splitSpeeches(beat.lines);
  return {
    cue: speeches.map((s) => cueFor(project, s[0]!)).join(' & '),
    text: speeches.map((s) => s.map((l) => `${l.direction ? `(${l.direction}) ` : ''}${plainInline(l.text)}`).join(' ')).join(' / '),
  };
};

/**
 * Move a beat to another place in the scene (`to`: its index among the
 * beats once moved). The lines renumber in their new order; dialogue the
 * timeline has placed by hand keeps its places, taken in the new order.
 */
export const moveBeat = (project: Project, sceneId: string, beatId: string, to: number): Project => {
  const beats = beatsOf(project, sceneId);
  const from = beats.findIndex((b) => b.id === beatId);
  const at = Math.max(0, Math.min(beats.length - 1, to));
  if (from < 0 || from === at) return project;
  const moved = [...beats];
  const [beat] = moved.splice(from, 1);
  moved.splice(at, 0, beat!);
  const ordered = moved.flatMap((b) => b.lines);
  const order = new Map(ordered.map((l, i) => [l.id, i + 1]));
  // A beat's first line carries nothing on (it would otherwise join whatever
  // speech lands before it): it stands on its own cue.
  const starts = new Set(moved.map((b) => b.lines[0]!.id));
  const lines = project.lines.map((l) => {
    if (!order.has(l.id)) return l;
    const next = { ...l, order: order.get(l.id)! };
    if (starts.has(l.id)) {
      delete next.dual;
      delete next.joined;
    }
    return next;
  });
  // Dialogue placed on the timeline by hand: the same slots, in the new order.
  const sayIds = ordered.filter((l) => l.kind === 'dialogue').map((l) => l.id);
  const placed = project.events.filter((e) => e.sceneId === sceneId && e.kind === 'dialogue' && e.refId && sayIds.includes(e.refId));
  let events = project.events;
  if (placed.length > 1) {
    const byTrack = new Map<string, typeof placed>();
    for (const e of placed) byTrack.set(e.track, [...(byTrack.get(e.track) ?? []), e]);
    const reorder = new Map<string, number>();
    for (const group of byTrack.values()) {
      const slots = group.map((e) => e.order).sort((a, b) => a - b);
      [...group].sort((a, b) => sayIds.indexOf(a.refId!) - sayIds.indexOf(b.refId!)).forEach((e, i) => reorder.set(e.id, slots[i]!));
    }
    events = project.events.map((e) => (reorder.has(e.id) && reorder.get(e.id) !== e.order ? { ...e, order: reorder.get(e.id)! } : e));
  }
  return { ...project, lines, events };
};

// ---------------------------------------------------------------- recording script

export interface RecordingLine {
  /** The id the engines play it by: what the audio file is named. */
  key: string;
  lineId: string;
  /** Its number in the session, 1…n. */
  take: number;
  cue: string;
  /** The character whose voice it is, if anyone's. */
  voiceId: string | null;
  voice: string;
  direction: string;
  text: string;
  vo: DialogueLine['vo'];
  /** Playing over something: what it plays from (RADIO). */
  from?: string;
  /** Said with the line before it (dual dialogue). */
  together?: boolean;
  /** What comes just before it in the scene, for an actor reading one part. */
  before?: { cue: string; text: string };
  /** Its subtitle, as the engines get it ("Mara: Lit. You go first."), and how long it shows: the take's length, else the time to read it. */
  subtitle: string;
  subtitleSeconds: number;
}

export interface RecordingScene {
  sceneId: string;
  code: string;
  name: string;
  heading: string;
  /** What is going on: the scene's summary, or its first action. */
  setting: string;
  /** In script order: the action between lines (for context) and the lines to record. */
  items: ({ kind: 'action'; text: string } | ({ kind: 'line' } & RecordingLine))[];
}

export interface RecordingScript {
  title: string;
  /** Whose part this is, or every part. */
  forName?: string;
  scenes: RecordingScene[];
  /** Lines per voice, most first. */
  cast: { voice: string; lines: number; words: number; recorded: number }[];
  total: number;
}

const countWords = (text: string) => plainInline(text).split(/\s+/).filter(Boolean).length;

/** Whose voice a line is: the character, else what it plays from. */
const voiceName = (project: Project, line: DialogueLine): string =>
  (line.speakerId && project.objects[line.speakerId]?.name) || (line.voiceFrom && project.objects[line.voiceFrom]?.name) || line.cue || 'No speaker';

/**
 * A recording script: every scene's lines in the order they run, numbered,
 * with how each is said. For one character it is their sides: only their
 * lines, each with the line before it as the cue in.
 */
export const recordingScript = (project: Project, options: { sceneIds?: readonly string[]; characterId?: string | null } = {}): RecordingScript => {
  const scenes = scenesFor(project, options.sceneIds);
  const who = options.characterId ?? null;
  const cast = new Map<string, { voice: string; lines: number; words: number; recorded: number }>();
  let take = 0;
  const out: RecordingScene[] = [];
  for (const scene of scenes) {
    const lines = sceneLines(project, scene.id);
    const items: RecordingScene['items'] = [];
    let before: { cue: string; text: string } | undefined;
    for (const line of lines) {
      if (line.kind === 'action') {
        if (line.text.trim() && !who) items.push({ kind: 'action', text: plainInline(line.text) });
        if (line.text.trim()) before = { cue: 'ACTION', text: plainInline(line.text) };
        continue;
      }
      if (line.kind !== 'dialogue') continue;
      const cue = cueFor(project, line);
      const mine = !who || line.speakerId === who;
      if (mine && line.text.trim()) {
        const voice = voiceName(project, line);
        const c = cast.get(voice) ?? { voice, lines: 0, words: 0, recorded: 0 };
        c.lines += 1;
        c.words += countWords(line.text);
        if (line.vo === 'recorded') c.recorded += 1;
        cast.set(voice, c);
        items.push({
          kind: 'line',
          key: lineKey(project, line),
          lineId: line.id,
          take: ++take,
          cue,
          voiceId: line.speakerId,
          voice,
          direction: line.direction,
          text: plainInline(line.text),
          vo: line.vo,
          ...(line.voiceFrom && project.objects[line.voiceFrom] ? { from: project.objects[line.voiceFrom]!.name } : {}),
          ...(line.dual && !line.joined ? { together: true } : {}),
          ...(who && before ? { before } : {}),
          ...(({ subtitle, seconds }) => ({ subtitle, subtitleSeconds: seconds }))(lineSubtitle(project, line)),
        });
      }
      before = { cue, text: plainInline(line.text) };
    }
    if (!items.some((i) => i.kind === 'line')) continue;
    const firstAction = lines.find((l) => l.kind === 'action' && l.text.trim());
    out.push({
      sceneId: scene.id,
      code: String(scene.data.code ?? ''),
      name: scene.name,
      heading: headingOf(project, scene),
      setting: String(scene.data.summary ?? '').trim() || (firstAction ? plainInline(firstAction.text) : ''),
      items,
    });
  }
  return {
    title: project.name || 'Untitled',
    ...(who && project.objects[who] ? { forName: project.objects[who]!.name } : {}),
    scenes: out,
    cast: [...cast.values()].sort((a, b) => b.lines - a.lines || a.voice.localeCompare(b.voice)),
    total: take,
  };
};

const VO_STATUS = { todo: 'to record', recorded: 'recorded', none: 'no VO' } as const;

const RECORDING_STYLE = `
@page { size: letter; margin: 0.75in; }
body { font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; max-width: 7.5in; margin: 0 auto; padding: 0.4in 0; }
h1 { font-size: 18pt; margin: 0 0 0.2em; }
.sub { color: #555; margin: 0 0 1.2em; }
table.cast { border-collapse: collapse; margin: 0 0 1.5em; }
table.cast td, table.cast th { border-bottom: 1px solid #ddd; padding: 3px 12px 3px 0; text-align: left; font-size: 10pt; }
h2 { font-family: 'Courier Prime', 'Courier New', monospace; font-size: 12pt; margin: 1.6em 0 0.2em; border-top: 2px solid #111; padding-top: 0.5em; display: flex; justify-content: space-between; }
.setting { font-style: italic; color: #444; margin: 0 0 0.8em; }
.act { font-family: 'Courier Prime', 'Courier New', monospace; color: #555; margin: 0.5em 0 0.5em 3.2em; font-size: 10pt; }
.line { display: grid; grid-template-columns: 2.6em 1fr auto; gap: 0 0.6em; padding: 0.45em 0; border-bottom: 1px dotted #ccc; page-break-inside: avoid; }
.no { font-weight: 600; color: #555; text-align: right; }
.cue { font-family: 'Courier Prime', 'Courier New', monospace; font-weight: 700; text-transform: uppercase; }
.dir { font-style: italic; color: #333; }
.say { font-family: 'Courier Prime', 'Courier New', monospace; font-size: 12pt; margin-top: 0.15em; }
.before { font-size: 9.5pt; color: #666; margin-bottom: 0.2em; }
.meta { text-align: right; font-size: 8.5pt; color: #666; white-space: nowrap; }
.key { font-family: 'IBM Plex Mono', monospace; }
.done { color: #2a7a2a; }
.subtitle { font-size: 9pt; color: #555; margin-top: 0.25em; }
.subtitle b { font-weight: 600; color: #333; }
`;

/** The recording script as a page to print or hand to the studio. */
export const recordingHtml = (script: RecordingScript): string => {
  const title = `${script.title} · recording script${script.forName ? ` · ${script.forName}` : ''}`;
  const cast = script.cast.length
    ? `<table class="cast"><tr><th>Voice</th><th>Lines</th><th>Words</th><th>Recorded</th></tr>${script.cast.map((c) => `<tr><td>${esc(c.voice)}</td><td>${c.lines}</td><td>${c.words}</td><td>${c.recorded}</td></tr>`).join('')}</table>`
    : '<p>No lines to record yet.</p>';
  const scenes = script.scenes
    .map((s) => {
      const items = s.items
        .map((i) =>
          i.kind === 'action'
            ? `<p class="act">${esc(i.text)}</p>`
            : `<div class="line"><div class="no">${i.take}</div><div>${i.before ? `<div class="before">after ${esc(i.before.cue)}: “${esc(i.before.text)}”</div>` : ''}<span class="cue">${esc(i.cue)}</span>${i.together ? ' <span class="dir">(at the same time as the line above)</span>' : ''}${i.direction ? ` <span class="dir">(${esc(i.direction)})</span>` : ''}<div class="say">${esc(i.text)}</div><div class="subtitle"><b>Subtitle</b> · ${secondsLabel(i.subtitleSeconds)}: ${esc(i.subtitle)}</div></div><div class="meta"><div class="key">${esc(i.key)}</div><div class="${i.vo === 'recorded' ? 'done' : ''}">${VO_STATUS[i.vo]}</div></div></div>`,
        )
        .join('\n');
      return `<h2><span>${esc(s.heading)}</span><span>${esc(s.code)}</span></h2>${s.setting ? `<p class="setting">${esc(s.setting)}</p>` : ''}\n${items}`;
    })
    .join('\n');
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${RECORDING_STYLE}</style></head>\n<body><h1>${esc(script.title)}</h1><p class="sub">Recording script${script.forName ? ` · ${esc(script.forName)}’s lines` : ''} · ${script.total} line${script.total === 1 ? '' : 's'} · in the order they play</p>\n${cast}\n${scenes}\n</body></html>\n`;
};

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The recording script as a spreadsheet: one row per line, its file name first. */
export const recordingCsv = (script: RecordingScript): string =>
  [
    ['File', 'Take', 'Scene', 'Heading', 'Cue', 'Voice', 'Plays from', 'Direction', 'Line', 'Cue in', 'Status', 'Subtitle', 'Subtitle seconds'].join(','),
    ...script.scenes.flatMap((s) =>
      s.items.flatMap((i) =>
        i.kind === 'line' ? [[i.key, String(i.take), s.code || s.name, s.heading, i.cue, i.voice, i.from ?? '', i.direction, i.text, i.before ? `${i.before.cue}: ${i.before.text}` : '', VO_STATUS[i.vo], i.subtitle, String(i.subtitleSeconds)].map(csvCell).join(',')] : [],
      ),
    ),
  ].join('\n') + '\n';

/** A file name for something exported from the project. */
export const scriptFileName = (project: Project, what: string, ext: string): string =>
  `${(project.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled'} ${what}.${ext}`;
