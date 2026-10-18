import { useEffect, useMemo, useRef, useState } from 'react';
import { HERO, parseGrid, type PlatformGame } from '../../model/platformer/platformer';
import { DT, NONE, carefulRun, createWorld, stepWorld, type Input, type World } from '../../model/platformer/sim';
import { Tile } from './PlatformBoard';

const VIEW = { w: 24, h: 13 };

/**
 * Play and test: run and jump (← → or A D, and Space, ↑ or W), or watch the
 * studio's careful player take its route, waiting for enemies as it goes.
 */
export const PlatformPlay = ({ game, index, onIndex }: { game: PlatformGame; index: number; onIndex: (i: number) => void }) => {
  const level = game.levels[Math.min(index, game.levels.length - 1)];
  const grid = useMemo(() => parseGrid(level?.rows ?? []), [level]);
  const [w, setW] = useState<World>(() => createWorld(grid));
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [lives, setLives] = useState(game.rules.lives);
  const wRef = useRef(w);
  wRef.current = w;
  const keys = useRef({ left: false, right: false, jump: false, jumpQueued: false });
  const replay = useMemo(() => (level ? carefulRun(game.rules, level).inputs : []), [game.rules, level]);
  const restart = () => {
    setW(createWorld(grid));
    setRunning(false);
  };
  useEffect(() => {
    restart();
    setLives(game.rules.lives);
  }, [grid]);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const tick = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      let cur = wRef.current;
      while (acc >= DT && cur.phase === 'playing') {
        let input: Input;
        if (auto) input = replay[cur.frame] ?? NONE;
        else {
          input = { left: keys.current.left, right: keys.current.right, jump: keys.current.jumpQueued };
          keys.current.jumpQueued = false;
        }
        cur = stepWorld(game.rules, grid, cur, input);
        acc -= DT;
      }
      setW(cur);
      if (cur.phase !== 'playing') {
        setRunning(false);
        if (cur.phase === 'dead') setLives((n) => Math.max(0, n - 1));
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, auto, game.rules, grid, replay]);

  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') keys.current.left = on;
      else if (k === 'arrowright' || k === 'd') keys.current.right = on;
      else if (k === ' ' || k === 'arrowup' || k === 'w') {
        if (on && !keys.current.jump) keys.current.jumpQueued = true;
        keys.current.jump = on;
      } else return;
      e.preventDefault();
      if (on && !running && wRef.current.phase === 'playing' && !auto) setRunning(true);
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [running, auto]);

  if (!level) return <p className="dfn-hint">Add a level first.</p>;
  const camX = Math.max(0, Math.min(grid.cols - VIEW.w, w.hero.x - VIEW.w / 3));
  const camY = Math.max(0, Math.min(grid.rows - VIEW.h, w.hero.y - VIEW.h / 2));
  const seconds = w.frame * DT;
  const coins = w.got.length;
  const score = coins * game.rules.coinValue + (w.phase === 'won' && level.par ? Math.max(0, Math.round((level.par - seconds) * 10)) * 10 : 0);
  const status = w.phase === 'won' ? `Made it in ${seconds.toFixed(1)} s!` : w.phase === 'dead' ? (w.cause === 'enemy' ? 'Caught by an enemy' : w.cause === 'spikes' ? 'Spiked' : 'Fell') : `${index + 1}. ${level.name}`;
  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{status}</span>
          <span>{seconds.toFixed(1)} s</span>
          <span>◎ {coins} coins</span>
          <span>♥ {lives}</span>
          <span>{score} points</span>
          {w.stomped ? <span className="muted">{w.stomped} stomped</span> : null}
        </div>
        <svg className="pf-view" viewBox={`${camX} ${camY} ${VIEW.w} ${VIEW.h}`} role="img" aria-label="The level">
          <rect x={0} y={0} width={grid.cols} height={grid.rows} className="pf-sky" />
          {grid.tiles.map((t, i) => {
            const x = i % grid.cols;
            const y = Math.floor(i / grid.cols);
            if (x < camX - 1 || x > camX + VIEW.w + 1 || t === 'e' || t === 'S' || (t === 'o' && w.got.includes(i))) return null;
            return <Tile key={i} t={t} x={x} y={y} />;
          })}
          {w.enemies.map((e, i) => (e.alive ? <rect key={i} x={e.x} y={e.y} width={0.8} height={0.8} rx={0.3} className="pf-enemy" /> : null))}
          <rect x={w.hero.x} y={w.hero.y} width={HERO.width} height={HERO.height} rx={0.18} className={`pf-hero${w.phase === 'dead' ? ' dead' : ''}`} />
        </svg>
        <div className="dfn-controls">
          <button className="tb-btn primary" onClick={() => setRunning(!running)} disabled={w.phase !== 'playing'}>
            {running ? 'Pause' : w.frame ? 'Resume' : 'Start'}
          </button>
          <button className="tb-btn" onClick={restart}>
            Try again
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={auto} onChange={(e) => (setAuto(e.target.checked), restart())} /> The studio plays
          </label>
          {w.phase === 'won' && index < game.levels.length - 1 ? (
            <button className="tb-btn primary" onClick={() => onIndex(index + 1)}>
              Next level
            </button>
          ) : null}
        </div>
        <p className="dfn-hint">← → or A D to run; Space, ↑ or W to jump. Land on an enemy to stomp it. Pressing a key starts the level.</p>
      </div>
      <aside className="dfn-play-side">
        <h3>Levels</h3>
        <ol className="blk-levels">
          {game.levels.map((l, i) => (
            <li key={l.id}>
              <button className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
                <span className="dfn-tab-num">{i + 1}</span> {l.name}
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
};
