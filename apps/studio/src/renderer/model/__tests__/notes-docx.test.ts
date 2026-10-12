import { describe, expect, it } from 'vitest';
import { docxRead, docxText } from '../notes/read';
import { importSource, lineFormatAt, passagesOf, piecesOf, sourceById, extract, notesOf } from '../notes/sorter';
import { createProject as emptyProject } from '../project';

const doc = (body: string) => `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`;
const p = (runs: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const STYLES = `<w:styles>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<w:numbering>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const list = (numId: number, level = 0) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`;

describe('Word documents keep their look in the Note Sorter', () => {
  const xml = doc(
    p(r('The Sunken Vault'), '<w:pStyle w:val="Heading1"/>') +
      p(r('Mara is ') + r('not', '<w:b/>') + r(' who she says.') ) +
      p(r('  The key ') + r('rusts', '<w:i/><w:u w:val="single"/>') + r(' in salt water.')) +
      p(r('Zones'), '<w:pStyle w:val="Titre2"/>') +
      p(r('Cave mouth'), list(1)) +
      p(r('Squeeze'), list(1, 1)) +
      p(r('Light the lamp'), list(2)) +
      p(r('Find oil'), list(2, 1)) +
      p(r('Refill'), list(2, 1)) +
      p(r('Open the door'), list(2)) +
      p(r('Nothing waits that does not want.'), '<w:pStyle w:val="Quote"/>') +
      p(r('A ') + r('word', '<w:rStyle w:val="Emphasis"/>') + r(' and ') + r('not this', '<w:i w:val="0"/>')) +
      p(''),
  );
  const read = docxRead(xml, { styles: STYLES, numbering: NUMBERING });

  it('keeps the same plain text as before, one paragraph a line', () => {
    expect(read.text).toBe(docxText(xml));
    expect(read.text.split('\n')).toEqual([
      'The Sunken Vault',
      'Mara is not who she says.',
      'The key rusts in salt water.',
      'Zones',
      'Cave mouth',
      'Squeeze',
      'Light the lamp',
      'Find oil',
      'Refill',
      'Open the door',
      'Nothing waits that does not want.',
      'A word and not this',
    ]);
  });

  it('keeps bold, italic and underlined words where they are in the text', () => {
    const at = (word: string) => read.text.indexOf(word);
    const runOf = (word: string) => read.format.runs.find((x) => x.start === at(word));
    expect(runOf('not who')).toEqual({ start: at('not who'), end: at('not who') + 3, marks: ['bold'] });
    expect(runOf('rusts')?.marks).toEqual(['italic', 'underline']);
    expect(read.text.slice(runOf('rusts')!.start, runOf('rusts')!.end)).toBe('rusts');
    // A character style counts; a property turned off does not.
    expect(runOf('word')?.marks).toEqual(['italic']);
    expect(read.format.runs.some((x) => read.text.slice(x.start, x.end).includes('not this'))).toBe(false);
    // A heading style's bold covers its words.
    expect(runOf('The Sunken Vault')?.marks).toEqual(['bold']);
  });

  it('marks headings (by style id or name), quotes and list items with their bullets and numbers', () => {
    const line = (text: string) => read.format.lines.find((l) => l.start === read.text.indexOf(text));
    expect(line('The Sunken Vault')).toEqual({ start: 0, kind: 'h1' });
    expect(line('Zones')?.kind).toBe('h2');
    expect(line('Nothing waits')?.kind).toBe('quote');
    expect(line('Cave mouth')).toMatchObject({ kind: 'bullet', level: 0, marker: '•' });
    expect(line('Squeeze')).toMatchObject({ kind: 'bullet', level: 1, marker: '◦' });
    expect(line('Light the lamp')).toMatchObject({ kind: 'number', marker: '1.' });
    expect(line('Find oil')).toMatchObject({ kind: 'number', level: 1, marker: 'a)' });
    expect(line('Refill')?.marker).toBe('b)');
    expect(line('Open the door')?.marker).toBe('2.');
    expect(line('Mara is')).toBeUndefined();
  });

  it('reads a list kept in its style, as Word’s List Number and List Bullet 2 are', () => {
    const styles = `<w:styles>
      <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/></w:style>
    </w:styles>`;
    const styled = docxRead(doc(p(r('First'), '<w:pStyle w:val="ListNumber"/>') + p(r('Second'), '<w:pStyle w:val="ListNumber"/>') + p(r('Aside'), '<w:pStyle w:val="ListBullet2"/>')), { styles, numbering: NUMBERING });
    expect(styled.format.lines.map((l) => [l.kind, l.marker, l.level])).toEqual([
      ['number', '1.', 0],
      ['number', '2.', 0],
      ['bullet', '◦', 1],
    ]);
  });

  it('a list without its numbering part still shows as a bulleted list', () => {
    const plain = docxRead(doc(p(r('One'), list(5)) + p(r('Two'), list(5))));
    expect(plain.format.lines.map((l) => l.marker)).toEqual(['•', '•']);
  });

  it('draws over the source without changing what is sorted out of it', () => {
    let project = emptyProject();
    const made = importSource(project, 'Design doc', read.text, undefined, read.format);
    project = made.project;
    const source = sourceById(project, made.id)!;
    expect(source.content).toBe(read.text);
    const passage = passagesOf(source).find((x) => source.content.slice(x.start, x.end).startsWith('Mara'))!;
    // The passage is cut into pieces where its bold starts and stops.
    const pieces = piecesOf(source, passage);
    expect(pieces.map((x) => [source.content.slice(x.start, x.end), x.marks])).toEqual([
      ['Mara is ', []],
      ['not', ['bold']],
      [' who she says.', []],
    ]);
    expect(lineFormatAt(source, passagesOf(source)[0]!.start)?.kind).toBe('h1');
    // A card made from a formatted passage holds its plain words.
    const sorted = extract(project, source.id, passage, null)!;
    const note = notesOf(sorted.project).notes.at(-1)!;
    expect(note.text).toBe('Mara is not who she says.');
  });

  it('a plain source is one piece per segment', () => {
    const made = importSource(emptyProject(), 'Memo', 'Just words');
    const source = sourceById(made.project, made.id)!;
    expect(piecesOf(source, { start: 0, end: 10 })).toEqual([{ start: 0, end: 10, marks: [] }]);
    expect(source.format).toBeUndefined();
  });
});
