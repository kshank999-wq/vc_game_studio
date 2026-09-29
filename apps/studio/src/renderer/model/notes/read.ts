import { unzip, ZipError } from './unzip';

/**
 * Raw notes out of a file (Note Sorter spec §2: brainstorms, design docs,
 * dictated ideas). Plain text and Markdown come in as they are; a Word
 * document is unzipped (VC Writer's reader) and its paragraphs taken one per
 * line, headings included, so its passages are its paragraphs.
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

/** A Word document's paragraphs, as text: one line each, tabs and breaks as spaces. */
export const docxText = (documentXml: string): string =>
  (documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) =>
      decodeXml(
        (p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
          .map((run) => (run.startsWith('<w:t') && !run.startsWith('<w:tab') ? run.replace(/<[^>]+>/g, '') : ' '))
          .join(''),
      ).trim(),
    )
    .filter(Boolean)
    .join('\n');

export class ReadError extends Error {}

/** A file's text for a new source. Throws a ReadError saying why, when it can't be read. */
export const readNotesFile = async (file: { name: string; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }): Promise<string> => {
  if (/\.docx$/i.test(file.name)) {
    let entries;
    try {
      entries = unzip(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof ZipError) throw new ReadError(`${file.name} isn’t a Word document that can be read.`);
      throw error;
    }
    const document = entries.find((e) => e.name === 'word/document.xml');
    if (!document) throw new ReadError(`${file.name} has no document in it.`);
    return docxText(new TextDecoder('utf-8').decode(await document.read()));
  }
  if (/\.(txt|md|markdown|text|csv)$/i.test(file.name) || !/\.[a-z0-9]+$/i.test(file.name)) return file.text();
  throw new ReadError(`${file.name}: the Note Sorter reads .txt, .md and .docx files.`);
};
