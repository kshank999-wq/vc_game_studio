import { dualPairs, type DualPair } from '../../model/timeline';
import type { DialogueLine, Project } from '../../model/types';
import { Inline } from '../Inline';

/** Each line of a scene in a dual pair, and the pair it is in. */
export const dualsIn = (project: Project, sceneId: string): Map<string, DualPair> => {
  const out = new Map<string, DualPair>();
  for (const pair of dualPairs(project, sceneId)) {
    out.set(pair.left.id, pair);
    out.set(pair.right.id, pair);
  }
  return out;
};

/** How many of the rows shown are dual: each takes a second line of the box. */
export const dualRowsShown = (lines: readonly DialogueLine[], shown: number, duals: ReadonlyMap<string, DualPair>): number =>
  lines.slice(0, shown).filter((l) => duals.has(l.id)).length;

interface Props {
  project: Project;
  line: DialogueLine;
  pair?: DualPair;
  /** Go to the line (the scene workspace's box); without it the row is only read. */
  onPick?: () => void;
}

/**
 * One row of a character's dialogue box. A line in a dual pair is set side
 * by side with the line it is spoken with, as the script sets them — the
 * left-hand speech on the left — this character's half in full and the
 * other speaker's beside it, so both boxes of the pair read the same.
 */
export const DialogueRow = ({ project, line, pair, onPick }: Props) => {
  const Tag = onPick ? 'button' : 'span';
  const text = (l: DialogueLine) => (l.text ? <Inline text={l.text} /> : '…');
  if (!pair) {
    return (
      <Tag className="dlg-row" {...(onPick ? { title: 'Go to this line in the script', onClick: onPick } : {})}>
        <span className="mono">#{line.order}</span>
        <span className="dlg-text">{text(line)}</span>
      </Tag>
    );
  }
  const name = (l: DialogueLine) => ((l.speakerId && project.objects[l.speakerId]?.name) || 'No speaker').toUpperCase();
  const other = pair.left.id === line.id ? pair.right : pair.left;
  return (
    <Tag
      className={`dlg-row dlg-dual${pair.together ? '' : ' apart'}`}
      aria-label={`#${line.order}, spoken at the same time as ${name(other)}${pair.together ? '' : ' (apart on the timeline)'}`}
      title={
        (pair.together ? `Spoken at the same time as ${name(other)}’s line.` : `Side by side with ${name(other)}’s line in the script, but apart on the timeline.`) +
        (onPick ? ' Click to go to it in the script.' : '')
      }
      {...(onPick ? { onClick: onPick } : {})}
    >
      <span className="mono">#{line.order}</span>
      <span className="dlg-pair">
        {[pair.left, pair.right].map((l, i) => (
          <span key={l.id} className={`dlg-half${l.id === line.id ? ' own' : ''}`} style={{ gridColumn: i * 2 + 1 }}>
            <span className="dlg-half-who">{name(l)}</span>
            <span className="dlg-text">{text(l)}</span>
          </span>
        ))}
        <span className="dlg-pair-mark" aria-hidden="true">
          ⇹
        </span>
      </span>
    </Tag>
  );
};
