import { useEffect, useState } from 'react';
import { goalText, type MatchGame } from '../../model/match/match';
import { adjacent, bestSwap, createMatch, goalProgress, starsFor, swap, type MatchState } from '../../model/match/sim';
import { MatchBoard } from './MatchBoard';

/**
 * Play and test: click a gem, then a neighbour to swap them. The studio's
 * player can show its move, or play the level out on its own.
 */
export const MatchPlay = ({ game, index, onIndex }: { game: MatchGame; index: number; onIndex: (i: number) => void }) => {
  const level = game.levels[Math.min(index, game.levels.length - 1)];
  const [seed, setSeed] = useState(1);
  const [s, setS] = useState<MatchState | null>(() => (level ? createMatch(game, level, seed) : null));
  const [sel, setSel] = useState(-1);
  const [auto, setAuto] = useState(false);
  const [hint, setHint] = useState<[number, number] | null>(null);
  useEffect(() => {
    setS(level ? createMatch(game, level, seed) : null);
    setSel(-1);
    setAuto(false);
    setHint(null);
  }, [game, level, seed]);
  useEffect(() => {
    if (!auto || !s || !level || s.phase !== 'playing') return;
    const t = setTimeout(() => {
      const m = bestSwap(game, level, s);
      if (m) setS(swap(game, level, s, m[0], m[1]));
      else setAuto(false);
    }, 450);
    return () => clearTimeout(t);
  }, [auto, s, game, level]);
  if (!level || !s) return <p className="dfn-hint">Add a level first.</p>;

  const onCell = (i: number) => {
    if (s.phase !== 'playing' || auto || !s.gems[i]) return;
    setHint(null);
    if (sel < 0) return setSel(i);
    if (sel === i) return setSel(-1);
    if (!adjacent(s, sel, i)) return setSel(i);
    const n = swap(game, level, s, sel, i);
    setSel(n === s ? i : -1);
    setS(n);
  };
  const stars = starsFor(game, level, s);
  const progress = goalProgress(level, s);
  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{s.phase === 'won' ? 'Level beaten!' : s.phase === 'lost' ? 'Out of moves' : `${index + 1}. ${level.name}`}</span>
          <span>{goalText(game, level)}</span>
          <span className="m3-progress" aria-label={`${Math.round(progress * 100)}% of the goal`}>
            <span style={{ width: `${progress * 100}%` }} />
          </span>
          <span>{s.moves} moves left</span>
          <span>{s.score.toLocaleString()} points</span>
          {s.chain > 1 ? <span className="muted">chain ×{s.chain}</span> : null}
          {stars ? <span className="blk-stars" aria-label={`${stars} stars`}>{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span> : null}
        </div>
        <MatchBoard shape={s.shape} gems={s.gems} jelly={s.jelly} selected={hint ? hint[0] : sel} flash={hint ? [hint[1]] : s.cleared} onCell={onCell} label={`Level ${index + 1}`} className="m3-play" />
        <div className="dfn-controls">
          <button className="tb-btn" onClick={() => setSeed((n) => n + 1)}>
            New board
          </button>
          <button className="tb-btn" disabled={s.phase !== 'playing'} onClick={() => setHint(bestSwap(game, level, s))}>
            Show the studio’s move
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> The studio plays
          </label>
          {s.phase === 'won' && index < game.levels.length - 1 ? (
            <button className="tb-btn primary" onClick={() => onIndex(index + 1)}>
              Next level
            </button>
          ) : null}
        </div>
        <p className="dfn-hint">Click a gem, then one beside it, to swap them. A swap only counts if it lines up three or more.</p>
      </div>
      <aside className="dfn-play-side">
        <h3>Levels</h3>
        <ol className="blk-levels">
          {game.levels.map((l, i) => (
            <li key={l.id}>
              <button className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
                <span className="dfn-tab-num">{i + 1}</span> {l.name} <em className="muted">{l.moves} moves</em>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
};
