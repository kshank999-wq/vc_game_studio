import { Inline } from '../Inline';
import type { Subtitle } from './takes-player';

/**
 * The subtitles for the takes playing now: a row a voice, white on a dark
 * band. In the play-through they sit over the foot of the transcript; in
 * Play Mode, at the foot of the 3D view, as a game shows them.
 */
export const Subtitles = ({ rows, onScreen }: { rows: Subtitle[]; onScreen?: boolean }) =>
  rows.length ? (
    <div className={onScreen ? 'play-subtitles-screen' : 'play-subtitles-anchor'}>
      <div className="play-subtitles" role="status" aria-label="Subtitles">
        {rows.map((r) => (
          <div key={r.lineId} className="play-subtitle">
            {r.who && <span className="play-subtitle-who">{r.who}: </span>}
            <Inline text={r.text} />
          </div>
        ))}
      </div>
    </div>
  ) : null;
