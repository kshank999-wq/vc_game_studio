import { useEffect, useMemo, useRef, useState } from 'react';
import { HEIGHTS, PLAYER, type RunnerGame } from '../../model/runner/runner';
import { DT, botStep, endlessTrack, newMind, startRun, stepRun, type Action, type BotMind, type RunState } from '../../model/runner/sim';

const VIEW = 26;

/**
 * Play and test: run it yourself (Space, ↑ or W to jump; ↓ or S to slide),
 * or let the studio's runner run, timing error and all. The track is a new
 * endless run each time.
 */
export const RunnerPlay = ({ game }: { game: RunnerGame }) => {
  const [seed, setSeed] = useState(1);
  const track = useMemo(() => endlessTrack(game, seed * 7 + 1, 4000), [game, seed]);
  const [s, setS] = useState<RunState>(startRun);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [best, setBest] = useState(0);
  const sRef = useRef(s);
  sRef.current = s;
  const want = useRef<Action>('none');
  const mind = useRef<BotMind>(newMind(seed));
  useEffect(() => {
    setS(startRun());
    setRunning(false);
    mind.current = newMind(seed);
  }, [track, seed]);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const tick = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      let cur = sRef.current;
      while (acc >= DT && cur.alive && cur.end !== 'finished') {
        let a: Action = want.current;
        if (auto) [a, mind.current] = botStep(game.rules, track, cur, mind.current);
        want.current = 'none';
        cur = stepRun(game.rules, track, cur, a);
        acc -= DT;
      }
      setS(cur);
      if (!cur.alive || cur.end === 'finished') {
        setRunning(false);
        setBest((b) => Math.max(b, Math.round(cur.x)));
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, auto, game, track]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'arrowup' || k === 'w') want.current = 'jump';
      else if (k === 'arrowdown' || k === 's') want.current = 'slide';
      else return;
      e.preventDefault();
      if (!running && sRef.current.alive && sRef.current.end !== 'finished' && sRef.current.frame === 0) setRunning(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [running]);

  const from = Math.max(0, s.x - 4);
  const cols: number[] = [];
  for (let x = Math.floor(from); x < Math.min(track.length, from + VIEW + 1); x++) cols.push(x);
  const h = s.slide > 0 ? PLAYER.slideHeight : PLAYER.height;
  const speed = track.speed[Math.min(track.length - 1, Math.floor(s.x))] ?? 0;
  const score = Math.round(s.x) + s.coins * game.rules.coinValue;
  const chunkName = (() => {
    const i = track.from[Math.min(track.length - 1, Math.floor(s.x + PLAYER.width))] ?? -1;
    return i >= 0 ? game.chunks[i]?.name : 'the runway';
  })();
  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{!s.alive ? (s.end === 'fell' ? `Fell in at ${Math.round(s.x)}` : `Hit something at ${Math.round(s.x)}`) : `${Math.round(s.x)} units`}</span>
          <span>{speed.toFixed(1)} units/s</span>
          <span>◎ {s.coins} coins</span>
          <span>{score.toLocaleString()} points</span>
          {best ? <span className="muted">best {best}</span> : null}
          <span className="muted">{chunkName}</span>
        </div>
        <svg className="run-view" viewBox={`${from} -0.2 ${VIEW} ${HEIGHTS + 1.4}`} role="img" aria-label="The run">
          <rect x={from} y={-0.2} width={VIEW} height={HEIGHTS + 0.2} className="run-sky" />
          {cols.map((x) => (
            <g key={x}>
              {Array.from({ length: HEIGHTS }, (_, k) =>
                (track.solid[x]! & (1 << k)) !== 0 ? <rect key={k} x={x + 0.02} y={HEIGHTS - 1 - k + 0.02} width={0.96} height={0.96} rx={0.08} className="run-solid" /> : track.coins.has(x * 4 + k) && !s.got.includes(x * 4 + k) ? <circle key={k} cx={x + 0.5} cy={HEIGHTS - 1 - k + 0.5} r={0.22} className="run-coin" /> : null,
              )}
              <rect x={x} y={HEIGHTS} width={1.02} height={1.2} className={track.ground[x] ? 'run-ground' : 'run-pit'} />
            </g>
          ))}
          <rect x={s.x} y={HEIGHTS - s.y - h} width={PLAYER.width} height={h} rx={0.18} className={`run-player${s.alive ? '' : ' dead'}`} />
        </svg>
        <div className="dfn-controls">
          <button className="tb-btn primary" onClick={() => setRunning(!running)} disabled={!s.alive || s.end === 'finished'}>
            {running ? 'Pause' : s.frame > 0 ? 'Resume' : 'Start'}
          </button>
          <button className="tb-btn" onClick={() => setSeed((n) => n + 1)}>
            New run
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> The studio runs
          </label>
        </div>
        <p className="dfn-hint">Space, ↑ or W to jump; ↓ or S to slide. Pressing a key starts the run.</p>
      </div>
    </div>
  );
};
