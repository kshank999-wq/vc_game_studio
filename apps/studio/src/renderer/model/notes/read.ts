import type { FormatRun, InlineMark, LineFormat, LineKind, SourceFormat } from './types';
import { unzip, ZipError } from './unzip';

/**
 * Raw notes out of a file (Note Sorter spec §2: brainstorms, design docs,
 * dictated ideas). Plain text and Markdown come in as they are; a Word
 * document is unzipped (VC Writer's reader) and its paragraphs taken one per
 * line, headings included, so its passages are its paragraphs. How it looked
 * (bold, italics, headings, lists) is kept beside the text, never in it, so
 * passages, selections and cards work on the same plain words either way.
 */

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const attr = (xml: string, name: string): string | undefined => xml.match(new RegExp(`\\bw:${name}="([^"]*)"`))?.[1];

/** The first `<w:tag …>` element (empty or not) in some XML, as text. */
const element = (xml: string, tag: string): string | undefined =>
  xml.match(new RegExp(`<w:${tag}(?=[\\s/>])(?:[^>]*/>|[^>]*>[\\s\\S]*?</w:${tag}>)`))?.[0];

/** A Word on/off property (`<w:b/>`, `<w:i w:val="0"/>`): on unless its value turns it off. */
const toggle = (rPr: string, tag: string): boolean | undefined => {
  const el = rPr.match(new RegExp(`<w:${tag}(?=[\\s/>])[^>]*>`))?.[0];
  if (!el) return undefined;
  const val = attr(el, 'val');
  return !(val === '0' || val === 'false' || val === 'none' || val === 'off');
};

const marksOf = (rPr: string | undefined): Partial<Record<InlineMark, boolean>> => {
  if (!rPr) return {};
  const out: Partial<Record<InlineMark, boolean>> = {};
  const b = toggle(rPr, 'b');
  const i = toggle(rPr, 'i');
  const u = toggle(rPr, 'u');
  const s = toggle(rPr, 'strike') ?? toggle(rPr, 'dstrike');
  if (b !== undefined) out.bold = b;
  if (i !== undefined) out.italic = i;
  if (u !== undefined) out.underline = u;
  if (s !== undefined) out.strike = s;
  return out;
};

interface Style {
  name: string;
  basedOn?: string;
  marks: Partial<Record<InlineMark, boolean>>;
  outline?: number;
  /** A list style's list (Word's "List Number" keeps its numbering in the style, not the paragraph). */
  numId?: string;
  ilvl?: number;
}

/** Word's styles by id: their names (to tell a heading from body text) and their inline styles. */
const stylesOf = (stylesXml: string | undefined): Map<string, Style> => {
  const out = new Map<string, Style>();
  for (const s of stylesXml?.match(/<w:style\b[\s\S]*?<\/w:style>/g) ?? []) {
    const id = attr(s.match(/<w:style\b[^>]*>/)![0], 'styleId');
    if (!id) continue;
    const outline = attr(element(s, 'outlineLvl') ?? '', 'val');
    const numPr = element(element(s, 'pPr') ?? '', 'numPr');
    const ilvl = numPr && attr(element(numPr, 'ilvl') ?? '', 'val');
    out.set(id, {
      name: (attr(element(s, 'name') ?? '', 'val') ?? id).toLowerCase(),
      basedOn: attr(element(s, 'basedOn') ?? '', 'val'),
      marks: marksOf(element(s, 'rPr')),
      outline: outline === undefined ? undefined : Number(outline),
      numId: numPr ? attr(element(numPr, 'numId') ?? '', 'val') : undefined,
      ilvl: ilvl === undefined || ilvl === null ? undefined : Number(ilvl),
    });
  }
  return out;
};

/** A style with what it is based on folded in (nearest wins). */
const resolved = (styles: Map<string, Style>, id: string | undefined): Style | undefined => {
  const chain: Style[] = [];
  for (let at = id, guard = 0; at && guard < 10; guard++) {
    const s = styles.get(at);
    if (!s) break;
    chain.push(s);
    at = s.basedOn;
  }
  if (!chain.length) return undefined;
  return {
    name: chain[0]!.name,
    marks: Object.assign({}, ...[...chain].reverse().map((s) => s.marks)),
    outline: chain.find((s) => s.outline !== undefined)?.outline,
    numId: chain.find((s) => s.numId !== undefined)?.numId,
    ilvl: chain.find((s) => s.ilvl !== undefined)?.ilvl,
    basedOn: undefined,
  };
};

/** What a paragraph style is, by its id or its name ("heading 1", "Title", "List Bullet", "Quote"). */
const kindOfStyle = (id: string | undefined, style: Style | undefined): LineKind | undefined => {
  const names = [id?.toLowerCase() ?? '', style?.name ?? ''];
  for (const n of names) {
    if (n === 'title') return 'title';
    const h = n.match(/^heading\s*(\d)$/);
    if (h) return Number(h[1]) <= 1 ? 'h1' : Number(h[1]) === 2 ? 'h2' : 'h3';
    if (/quote/.test(n)) return 'quote';
    if (/list\s*bullet/.test(n)) return 'bullet';
    if (/list\s*number/.test(n)) return 'number';
  }
  if (style?.outline !== undefined && style.outline < 9) return style.outline === 0 ? 'h1' : style.outline === 1 ? 'h2' : 'h3';
  return undefined;
};

interface Level {
  format: string;
  text: string;
  start: number;
}

/** Word's list definitions: for each list (numId), each level's numbering format, text ("%1.") and start. */
const numberingOf = (numberingXml: string | undefined): Map<string, Map<number, Level>> => {
  const abstract = new Map<string, Map<number, Level>>();
  for (const a of numberingXml?.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = attr(a.match(/<w:abstractNum\b[^>]*>/)![0], 'abstractNumId');
    if (id === undefined) continue;
    const levels = new Map<number, Level>();
    for (const l of a.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? []) {
      levels.set(Number(attr(l.match(/<w:lvl\b[^>]*>/)![0], 'ilvl') ?? 0), {
        format: attr(element(l, 'numFmt') ?? '', 'val') ?? 'decimal',
        text: attr(element(l, 'lvlText') ?? '', 'val') ?? '%1.',
        start: Number(attr(element(l, 'start') ?? '', 'val') ?? 1),
      });
    }
    abstract.set(id, levels);
  }
  const out = new Map<string, Map<number, Level>>();
  for (const n of numberingXml?.match(/<w:num\b[\s\S]*?<\/w:num>/g) ?? []) {
    const id = attr(n.match(/<w:num\b[^>]*>/)![0], 'numId');
    const a = attr(element(n, 'abstractNumId') ?? '', 'val');
    const levels = a === undefined ? undefined : abstract.get(a);
    if (id !== undefined && levels) out.set(id, levels);
  }
  return out;
};

const roman = (n: number): string => {
  const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v);
  return out;
};

const letters = (n: number): string => {
  let out = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
};

const counted = (n: number, format: string): string =>
  format === 'lowerLetter' ? letters(n) : format === 'upperLetter' ? letters(n).toUpperCase() : format === 'lowerRoman' ? roman(n) : format === 'upperRoman' ? roman(n).toUpperCase() : String(n);

const BULLETS = ['•', '◦', '▪'];

export interface DocxRead {
  text: string;
  format: SourceFormat;
}

/**
 * A Word document's paragraphs as text (one line each, tabs and breaks as
 * spaces), and how they looked: bold, italic, underlined and struck-out
 * words, and which lines are headings, quotes or list items with their
 * bullets and numbers.
 */
export const docxRead = (documentXml: string, parts: { styles?: string; numbering?: string } = {}): DocxRead => {
  const styles = stylesOf(parts.styles);
  const numbering = numberingOf(parts.numbering);
  const counters = new Map<string, number[]>();
  const lines: string[] = [];
  const runs: FormatRun[] = [];
  const kinds: LineFormat[] = [];
  let at = 0;

  for (const p of documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const pPr = element(p, 'pPr') ?? '';
    const styleId = attr(element(pPr, 'pStyle') ?? '', 'val');
    const pStyle = resolved(styles, styleId);
    // The paragraph's own list, or its style's; "List Bullet 2" is the second level.
    const numPr = element(pPr, 'numPr');
    const numId = (numPr && attr(element(numPr, 'numId') ?? '', 'val')) ?? pStyle?.numId;
    const styleLevel = pStyle?.name.match(/^list (?:bullet|number) (\d)$/)?.[1];
    const level = Number((numPr && attr(element(numPr, 'ilvl') ?? '', 'val')) ?? pStyle?.ilvl ?? (styleLevel ? Number(styleLevel) - 1 : 0));

    // The paragraph's words, run by run, each with its inline styles.
    const pieces: { text: string; marks: InlineMark[] }[] = [];
    for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []) {
      const rPr = element(r, 'rPr');
      const charStyle = resolved(styles, attr(element(rPr ?? '', 'rStyle') ?? '', 'val'));
      const set = { ...pStyle?.marks, ...charStyle?.marks, ...marksOf(rPr) };
      const marks = (['bold', 'italic', 'underline', 'strike'] as const).filter((m) => set[m]);
      const text = decodeXml(
        (r.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
          .map((run) => (run.startsWith('<w:t') && !run.startsWith('<w:tab') ? run.replace(/<[^>]+>/g, '') : ' '))
          .join(''),
      );
      if (text) pieces.push({ text, marks });
    }

    // A list item counts even when it is empty, as Word numbers it.
    let kind = kindOfStyle(styleId, pStyle);
    let marker: string | undefined;
    if (numId && numId !== '0') {
      const def = numbering.get(numId)?.get(level);
      const counts = counters.get(numId) ?? [];
      const defs = numbering.get(numId);
      counts[level] = (counts[level] ?? (def?.start ?? 1) - 1) + 1;
      counts.length = level + 1;
      counters.set(numId, counts);
      if (!def || def.format === 'bullet' || def.format === 'none') {
        kind = 'bullet';
        marker = BULLETS[level % BULLETS.length];
      } else {
        kind = 'number';
        marker = def.text.replace(/%(\d)/g, (_, k: string) => {
          const l = Number(k) - 1;
          return counted(counts[l] ?? defs?.get(l)?.start ?? 1, defs?.get(l)?.format ?? 'decimal');
        });
      }
    } else if (kind === 'bullet') marker = BULLETS[level % BULLETS.length];

    const whole = pieces.map((x) => x.text).join('');
    const line = whole.trim();
    if (!line) continue;
    const lead = whole.length - whole.trimStart().length;
    let offset = 0;
    for (const piece of pieces) {
      const from = Math.max(0, offset - lead);
      const to = Math.min(line.length, offset + piece.text.length - lead);
      offset += piece.text.length;
      if (to <= from || !piece.marks.length) continue;
      const prev = runs[runs.length - 1];
      if (prev && prev.end === at + from && prev.marks.join() === piece.marks.join()) prev.end = at + to;
      else runs.push({ start: at + from, end: at + to, marks: piece.marks });
    }
    if (kind) kinds.push({ start: at, kind, ...(kind === 'bullet' || kind === 'number' ? { level, marker } : {}) });
    lines.push(line);
    at += line.length + 1;
  }
  return { text: lines.join('\n'), format: { runs, lines: kinds } };
};

/** A Word document's paragraphs, as text: one line each, tabs and breaks as spaces. */
export const docxText = (documentXml: string): string => docxRead(documentXml).text;

export class ReadError extends Error {}

/** What came out of a file: its text, and for a Word document how it looked. */
export interface ReadNotes {
  content: string;
  format?: SourceFormat;
}

/** A file's text for a new source. Throws a ReadError saying why, when it can't be read. */
export const readNotesFile = async (file: { name: string; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }): Promise<ReadNotes> => {
  if (/\.docx$/i.test(file.name)) {
    let entries;
    try {
      entries = unzip(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof ZipError) throw new ReadError(`${file.name} isn’t a Word document that can be read.`);
      throw error;
    }
    const part = async (name: string) => {
      const entry = entries.find((e) => e.name === name);
      return entry ? new TextDecoder('utf-8').decode(await entry.read()) : undefined;
    };
    const document = await part('word/document.xml');
    if (document === undefined) throw new ReadError(`${file.name} has no document in it.`);
    const read = docxRead(document, { styles: await part('word/styles.xml'), numbering: await part('word/numbering.xml') });
    return { content: read.text, format: read.format.runs.length || read.format.lines.length ? read.format : undefined };
  }
  if (/\.(txt|md|markdown|text|csv)$/i.test(file.name) || !/\.[a-z0-9]+$/i.test(file.name)) return { content: await file.text() };
  throw new ReadError(`${file.name}: the Note Sorter reads .txt, .md and .docx files.`);
};
