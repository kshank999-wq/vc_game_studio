// Taken from VC Writer (apps/desktop/src/renderer/unzip.ts).
/**
 * Reading a zip (addendum 21 §2).
 *
 * A `.docx` is a zip of XML parts, and this is the whole of what the host
 * does to one: find the entries and hand each one's bytes over when asked.
 * Written here rather than pulled in, for the reason the XML reader was —
 * a zip library is a dependency in the path of opening a file, and a Word
 * document is a small, regular archive: a central directory naming a few
 * dozen entries, each stored or deflated. Inflating is the platform's:
 * `DecompressionStream('deflate-raw')` is in Chromium and in Node, so no
 * inflater is shipped either.
 *
 * Nothing is read until it is asked for, so a document's pictures are only
 * decoded when the reader wants them.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export interface ZipEntry {
  /** The path inside the archive, as written: `word/document.xml`. */
  name: string;
  /** The entry's bytes, stored or inflated. */
  read(): Promise<Uint8Array>;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const inflateRaw = async (bytes: Uint8Array): Promise<Uint8Array> => {
  // A stream of one chunk rather than a Blob's: the same in Chromium and
  // Node, and a test runner's window has no Blob that streams.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // Copied: a view into the archive is not the ArrayBuffer-backed chunk
      // the stream's typing wants, and the copy is the entry's size, not the file's.
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return new Uint8Array(await new Response(source.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
};

/**
 * The entries of a zip, by reading its central directory. Throws a
 * `ZipError` when the bytes are not a zip at all, or are a zip64 archive —
 * a form no Word document takes, and refusing it is better than reading it
 * wrong.
 */
export const unzip = (buffer: ArrayBuffer): ZipEntry[] => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 22) throw new ZipError('That file is not a zip archive.');

  // The end-of-central-directory record is at the very end, before a comment
  // of up to 65535 bytes; scan back for its signature.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new ZipError('That file is not a zip archive.');

  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError('That zip is a zip64 archive, which this does not read.');
  if (directoryOffset >= bytes.length) throw new ZipError('That zip archive is truncated.');

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new ZipError('That zip archive is damaged.');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('That zip is a zip64 archive, which this does not read.');
    }
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    entries.push({
      name,
      read: async () => {
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL) {
          throw new ZipError(`The entry ${name} is damaged.`);
        }
        const localName = view.getUint16(localOffset + 26, true);
        const localExtra = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localName + localExtra;
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new ZipError(`The entry ${name} is compressed in a way this does not read.`);
      },
    });
  }
  return entries;
};
