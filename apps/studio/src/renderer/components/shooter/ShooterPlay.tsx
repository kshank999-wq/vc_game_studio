import { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD, type ShooterGame } from '../../model/shooter/shooter';
import { autopilot, createShooterSim, invaderAt, runShooter, shieldXs, stepShooter, type Input } from '../../model/shooter/sim';
import { Field, InvaderShape, ShipShape, invaderHue } from './Field';

const SEEDS = [1, 2, 3];

/**
 * Play and tune: play the game with the keys (← → or A D to move, Space to
 * fire), or watch the autopilot play it, and read how the autopilot does
 * over a few runs: a steady guide to how hard each wave is.
 */
export const ShooterPlay = ({ game }: { game: ShooterGame }) => {
  const [sim, setSim] = useState(() => createShooterSim(game));
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const keys = useRef({ left: false, right: false, fire: false });
  const simRef = useRef(sim);
  simRef.current = sim;

  // A changed game starts again.
  useEffect(() => {
    setRunning(false);
    setSim(createShooterSim(game));
  }, [game]);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = simRef.current;
      const input: Input = auto ? autopilot(game, s) : keys.current;
      const next = stepShooter(game, s, dt, input);
      setSim(next);
      if (next.phase === 'won' || next.phase === 'lost') setRunning(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, auto, game]);

  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') keys.current.left = on;
      else if (k === 'arrowright' || k === 'd') keys.current.right = on;
      else if (k === ' ') keys.current.fire = on;
      else return;
      if (running) e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [running]);

  const runs = useMemo(() => SEEDS.map((seed) => runShooter(game, seed)), [game]);
  const wins = runs.filter((r) => r.outcome === 'won').length;
  const verdict =
    wins === runs.length
      ? `The autopilot clears all ${game.waves.length} waves every time, with ${Math.min(...runs.map((r) => r.lives))}–${Math.max(...runs.map((r) => r.lives))} lives left.`
      : wins
        ? `The autopilot clears it ${wins} times in ${runs.length}: close to the edge.`
        : `The autopilot falls in wave ${Math.min(...runs.map((r) => r.cleared)) + 1} of ${game.waves.length}${runs.every((r) => r.lostBy === 'landed') ? ': the formation lands before it is shot down. Slow it, drop it less, or give the ship more fire.' : '.'}`;
  const first = runs[0]!;
  const hue = new Map(game.invaders.map((v, i) => [v.id, invaderHue(i)]));
  const health = new Map(game.invaders.map((v) => [v.id, v.health]));
  const shields = shieldXs(game);
  const status = sim.phase === 'won' ? 'Every wave cleared!' : sim.phase === 'lost' ? (sim.lostBy === 'landed' ? 'They landed' : 'Out of lives') : sim.phase === 'breather' ? `Wave ${sim.wave + 1} coming` : `Wave ${sim.wave + 1} of ${game.waves.length}`;
  const restart = () => {
    setRunning(false);
    setSim(createShooterSim(game, Math.floor(Math.random() * 1e9)));
  };

  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{status}</span>
          <span>{sim.score} points</span>
          <span>♥ {sim.lives} lives</span>
          <span className="muted">← → or A D to move, Space to fire</span>
        </div>
        <Field label="Play">
          {shields.map((x, i) =>
            sim.shields[i]! > 0 ? <rect key={i} x={x - 0.8} y={FIELD.shieldY - 0.35} width={1.6} height={0.7} rx={0.12} className="sht-shield" opacity={0.3 + (0.7 * sim.shields[i]!) / Math.max(1, game.shields.health)} /> : null,
          )}
          {sim.phase !== 'breather' &&
            sim.invaders.map((v) => {
              const [x, y] = invaderAt(game, sim, v);
              return <InvaderShape key={`${v.row},${v.col}`} x={x} y={y} fill={hue.get(v.invaderId) ?? 'currentColor'} hurt={v.hp / (health.get(v.invaderId) ?? 1)} />;
            })}
          {sim.shots.map((b, i) => (
            <rect key={`s${i}`} x={b.x - 0.04} y={b.y - 0.2} width={0.08} height={0.3} className="sht-shot" />
          ))}
          {sim.bombs.map((b, i) => (
            <rect key={`b${i}`} x={b.x - 0.06} y={b.y - 0.15} width={0.12} height={0.3} className="sht-bomb" />
          ))}
          <ShipShape x={sim.shipX} blink={sim.shielded > 0} />
        </Field>
        <div className="dfn-controls">
          <button className="tb-btn primary" onClick={() => setRunning(!running)} disabled={sim.phase === 'won' || sim.phase === 'lost'}>
            {running ? 'Pause' : sim.t > 0 ? 'Resume' : 'Start'}
          </button>
          <button className="tb-btn" onClick={restart}>
            Restart
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Autopilot plays
          </label>
        </div>
      </div>
      <aside className="dfn-play-side">
        <h3>Autopilot</h3>
        <p className="dfn-hint">A steady player that lines up under the nearest invader, leads its sweep and sidesteps shots. If it struggles, most players will.</p>
        <p className={`dfn-verdict ${wins === runs.length ? 'won' : 'lost'}`}>{verdict}</p>
        <table className="dfn-table">
          <thead>
            <tr>
              <th>Wave</th>
              <th>Time</th>
              <th>Shots</th>
              <th>Hit</th>
              <th>Lives lost</th>
            </tr>
          </thead>
          <tbody>
            {first.stats.map((st, i) => (
              <tr key={i} className={st.livesLost || (i === first.stats.length - 1 && first.outcome === 'lost') ? 'leaky' : ''}>
                <td>{i + 1}</td>
                <td>{Math.round(st.seconds)}s</td>
                <td>{st.shots}</td>
                <td>{st.shots ? `${Math.round((100 * st.hits) / st.shots)}%` : '–'}</td>
                <td>{st.livesLost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </div>
  );
};
