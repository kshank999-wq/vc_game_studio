import { parseInline } from '../model/inline';

/** A script line as it reads: its **bold**, *italic* and _underline_ shown, the marks gone. */
export const Inline = ({ text }: { text: string }) => (
  <>
    {parseInline(text).map((span, i) => {
      let node: React.ReactNode = span.text;
      if (span.underline) node = <u>{node}</u>;
      if (span.italic) node = <i>{node}</i>;
      if (span.bold) node = <b>{node}</b>;
      return <span key={i}>{node}</span>;
    })}
  </>
);
