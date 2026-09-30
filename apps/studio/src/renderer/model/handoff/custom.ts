/**
 * Custom code in generated files (spec §13): each generated script has a
 * region, between two marker lines, that is the person's own. Exporting
 * again writes the file afresh but carries every region's contents over from
 * the file already there, so code written in the engine survives
 * regeneration. Everything outside the regions is VC Game Studio's.
 */

const BEGIN = /^[ \t]*(?:#|\/\/)[ \t]*BEGIN CUSTOM: ([\w.-]+)[ \t]*$/;
const END = /^[ \t]*(?:#|\/\/)[ \t]*END CUSTOM: ([\w.-]+)[ \t]*$/;

/** A region's three generated lines: what it is for, and its two markers (its contents go between them). */
export const customRegion = (comment: '#' | '//', name = 'code', indent = '', what = 'Your own code'): string[] => [
  `${indent}${comment} ${what} goes between these two lines: VC Game Studio keeps it when it exports again.`,
  `${indent}${comment} BEGIN CUSTOM: ${name}`,
  `${indent}${comment} END CUSTOM: ${name}`,
];

interface Region {
  name: string;
  /** Lines of the file: the begin marker's and the end marker's. */
  begin: number;
  end: number;
}

const linesOf = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

const regionsIn = (lines: readonly string[]): Region[] => {
  const out: Region[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = BEGIN.exec(lines[i]!)?.[1];
    if (!name) continue;
    const end = lines.findIndex((l, j) => j > i && END.exec(l)?.[1] === name);
    if (end < 0) continue;
    out.push({ name, begin: i, end });
    i = end;
  }
  return out;
};

/** Each region's contents by name (its lines between the markers), in a file's text. */
export const customCode = (text: string): Map<string, string> => {
  const lines = linesOf(text);
  return new Map(regionsIn(lines).map((r) => [r.name, lines.slice(r.begin + 1, r.end).join('\n')]));
};

/** The text with every region emptied: what VC Game Studio owns of a file, to tell edits outside the regions from those inside. */
export const withoutCustom = (text: string): string => {
  const lines = linesOf(text);
  const regions = regionsIn(lines);
  if (!regions.length) return text;
  const out: string[] = [];
  let at = 0;
  for (const r of regions) {
    out.push(...lines.slice(at, r.begin + 1));
    at = r.end;
  }
  out.push(...lines.slice(at));
  return out.join('\n');
};

export interface Merged {
  content: string;
  /** Regions whose code was carried over. */
  kept: string[];
  /** Regions with code in the old file and none in the new: their code is put in the new file's first region, marked, so none is lost. */
  moved: string[];
  /** The same, when the new file has no region to put it in: that code would be lost by writing it. */
  lost: string[];
}

/**
 * The newly generated text with the code from the file already there put
 * back into its regions (matched by name). Code from a region the new text
 * no longer has goes into its first region, under a note saying where it came
 * from; with no region at all there is nowhere to put it, and it is reported.
 */
export const keepCustom = (generated: string, onDisk: string | null | undefined): Merged => {
  if (!onDisk) return { content: generated, kept: [], moved: [], lost: [] };
  const old = customCode(onDisk);
  const filled = [...old].filter(([, body]) => body.trim());
  if (!filled.length) return { content: generated, kept: [], moved: [], lost: [] };
  const lines = linesOf(generated);
  const regions = regionsIn(lines);
  const names = new Set(regions.map((r) => r.name));
  const kept: string[] = [];
  const moved = filled.filter(([name]) => !names.has(name));
  const crlf = /\r\n/.test(generated);
  const out: string[] = [];
  let at = 0;
  regions.forEach((r, n) => {
    out.push(...lines.slice(at, r.begin + 1));
    const body = old.get(r.name);
    if (body !== undefined && body.trim()) {
      out.push(...body.split('\n'));
      kept.push(r.name);
    }
    if (n === 0)
      for (const [name, code] of moved) {
        const comment = lines[r.begin]!.trimStart().startsWith('//') ? '//' : '#';
        const indent = /^[ \t]*/.exec(lines[r.begin]!)![0];
        out.push(`${indent}${comment} (Kept from the custom region "${name}", which this file no longer has.)`, ...code.split('\n'));
      }
    at = r.end;
  });
  out.push(...lines.slice(at));
  const content = out.join(crlf ? '\r\n' : '\n');
  const movedNames = moved.map(([name]) => name);
  return regions.length ? { content, kept, moved: movedNames, lost: [] } : { content, kept, moved: [], lost: movedNames };
};

/** Whether a file has anywhere to keep custom code. */
export const hasCustomRegion = (text: string): boolean => regionsIn(linesOf(text)).length > 0;
