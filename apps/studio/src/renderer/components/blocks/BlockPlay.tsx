import { useEffect, useMemo, useState } from 'react';
import { parseLevel, type BlockGame } from '../../model/blocks/blocks';
import { solveBoard, solveLevel, solved, startState, stars, step, type Dir, type PlayState } from '../../model/blocks/solver';
import { BlockBoard } from './BlockBoard';

const KEYS: Record<string, Dir> = { arrowup: 'u', w: 'u', arrowdown: 'd', s: 'd', arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r' };

/**
 * Play and test: play each level with the keys (arrows or WASD), take moves
 * back, restart, ask for a hint (the studio's next move from where you
 * are), and see the stars against par.
 */
export const BlockPlay = ({ game, index, onIndex }: { game: BlockGame; index: number; onIndex: (i: number) => void }) => {
  const level = game.levels[Math.min(index, game.levels.length - 1)];
  const board = useMemo(() => parseLevel(level?.rows ?? []), [level]);
  const [history, setHistory] = useState<PlayState[]>(() => [startState(board)]);
  const [hint, setHint] = useState('');
  useEffect(() => {
    setHistory([startState(board)]);
    setHint('');
  }, [board]);
  const s = history[history.length - 1]!;
  const done = solved(board, s);
  const best = level ? solveLevel(level) : undefined;
  const par = level?.par || best?.moves || 0;

  // Each move builds on the latest position, so quick key presses all count.
  const move = (d: Dir) => {
    setHistory((h) => {
      const cur = h[h.length - 1]!;
      if (solved(board, cur)) return h;
      const n = step(board, cur, d);
      return n ? [...h, n] : h;
    });
    setHint('');
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const d = KEYS[e.key.toLowerCase()];
      if (d) {
        e.preventDefault();
        move(d);
      } else if ((e.key === 'z' || e.key === 'Backspace') && game.rules.undo) {
        e.preventDefault();
        setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
      } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        setHistory([startState(board)]);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const askHint = () => {
    const from = solveBoard({ ...board, crates: s.crates, player: s.player }, 60_000);
    setHint(from.status === 'solved' ? from.path.slice(0, 1) : from.status === 'unsolvable' ? 'stuck' : 'unknown');
  };
  const hintText = hint === 'stuck' ? 'No way out from here: undo or restart.' : hint === 'unknown' ? 'Too many ways on from here to work out a hint.' : hint ? `Next: ${{ u: 'up', d: 'down', l: 'left', r: 'right' }[hint.toLowerCase() as Dir]}${hint === hint.toUpperCase() ? ' (a push)' : ''}.` : '';
  const crate = game.rules.crateWord || 'crate';

  if (!level) return <p className="dfn-hint">Add a level first.</p>;
  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{done ? `Solved in ${s.moves} moves!` : `${index + 1}. ${level.name}`}</span>
          <span>
            {s.moves} moves · {s.pushes} pushes
          </span>
          <span className="muted">par {par || '–'}</span>
          {done && par ? <span className="blk-stars" aria-label={`${stars(s.moves, par, game.rules.twoStarSlack)} stars`}>{'★'.repeat(stars(s.moves, par, game.rules.twoStarSlack))}{'☆'.repeat(3 - stars(s.moves, par, game.rules.twoStarSlack))}</span> : null}
        </div>
        <BlockBoard board={board} crates={s.crates} player={s.player} label={`Level ${index + 1}`} className="blk-play" />
        <div className="dfn-controls">
          <div className="blk-pad" role="group" aria-label="Move">
            <button className="tb-btn small" aria-label="Up" onClick={() => move('u')}>
              ↑
            </button>
            <button className="tb-btn small" aria-label="Left" onClick={() => move('l')}>
              ←
            </button>
            <button className="tb-btn small" aria-label="Down" onClick={() => move('d')}>
              ↓
            </button>
            <button className="tb-btn small" aria-label="Right" onClick={() => move('r')}>
              →
            </button>
          </div>
          {game.rules.undo ? (
            <button className="tb-btn" disabled={history.length < 2} onClick={() => setHistory((h) => h.slice(0, -1))}>
              Undo
            </button>
          ) : null}
          <button className="tb-btn" onClick={() => setHistory([startState(board)])}>
            Restart
          </button>
          <button className="tb-btn" disabled={done} onClick={askHint}>
            Hint
          </button>
          {done && index < game.levels.length - 1 ? (
            <button className="tb-btn primary" onClick={() => onIndex(index + 1)}>
              Next level
            </button>
          ) : null}
        </div>
        <p className="dfn-hint">
          Arrow keys or WASD to move{game.rules.undo ? ', Z to undo' : ''}, R to restart. {hintText}
        </p>
      </div>
      <aside className="dfn-play-side">
        <h3>Levels</h3>
        <ol className="blk-levels">
          {game.levels.map((l, i) => {
            const sol = solveLevel(l);
            return (
              <li key={l.id}>
                <button className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
                  <span className="dfn-tab-num">{i + 1}</span> {l.name} <em className="muted">{sol.status === 'solved' ? `${sol.moves} moves` : sol.status}</em>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="dfn-hint">Par is the fewest moves the studio found, unless you set your own on the level. Push every {crate} onto a target to finish.</p>
      </aside>
    </div>
  );
};
