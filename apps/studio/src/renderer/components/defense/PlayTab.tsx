import { useEffect, useMemo, useRef, useState } from 'react';
import { costTo, statsAt, type DefenseGame, type Placement } from '../../model/defense/defense';
import { createSim, runDefense, stepSim, waveSheet, type SimState } from '../../model/defense/sim';
import { Board } from './Board';

const SPEEDS = [1, 2, 4] as const;

/**
 * Play and balance: lay out towers on the build spots (the test layout, kept
 * with the game), then watch the waves come, or run the whole game at once and
 * read each wave's numbers. Click a spot with a tower picked to build there;
 * click a tower to upgrade it; right-click to take it away.
 */
export const PlayTab = ({ game, onLayout }: { game: DefenseGame; onLayout: (layout: Placement[]) => void }) => {
  const [pick, setPick] = useState(game.towers[0]?.id ?? '');
  const [sim, setSim] = useState<SimState>(() => createSim(game, game.layout, game.economy.breather));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const last = useRef<number | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  // A new game or layout starts the run again.
  useEffect(() => {
    setSim(createSim(game, game.layout, game.economy.breather));
    setRunning(false);
  }, [game]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : Math.min(0.1, (now - last.current) / 1000);
      last.current = now;
      setSim((s) => {
        let next = s;
        const steps = Math.max(1, Math.round((dt * speed) / 0.025));
        for (let i = 0; i < steps; i++) next = stepSim(gameRef.current, next, (dt * speed) / steps);
        if (next.phase === 'won' || next.phase === 'lost') setRunning(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [running, speed]);

  const result = useMemo(() => runDefense(game), [game]);
  const sheet = useMemo(() => waveSheet(game), [game]);
  const towerOf = (id: string) => game.towers.find((t) => t.id === id);
  const enemyOf = (id: string) => game.enemies.find((e) => e.id === id);
  const layoutCost = game.layout.reduce((n, p) => n + (towerOf(p.towerId) ? costTo(towerOf(p.towerId)!, p.level) : 0), 0);

  const onSpot = (i: number) => {
    const here = game.layout.find((p) => p.spot === i);
    if (here) {
      const t = towerOf(here.towerId);
      if (t && here.level <= t.upgrades.length) onLayout(game.layout.map((p) => (p.spot === i ? { ...p, level: p.level + 1 } : p)));
      return;
    }
    if (pick) onLayout([...game.layout, { spot: i, towerId: pick, level: 1 }]);
  };
  const removeAt = (i: number) => onLayout(game.layout.filter((p) => p.spot !== i));

  const status = sim.phase === 'won' ? 'Castle held!' : sim.phase === 'lost' ? `Castle fell in wave ${sim.wave + 1}` : sim.phase === 'breather' ? `Wave ${sim.wave + 1} in ${Math.ceil(sim.breatherLeft)}s` : `Wave ${sim.wave + 1} of ${game.waves.length}`;

  return (
    <div className="dfn-play">
      <div className="dfn-play-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{status}</span>
          <span>⛁ {Math.floor(sim.gold)} gold</span>
          <span>♥ {sim.lives} lives</span>
          {sim.unbuilt ? <span className="muted">{sim.unbuilt === 1 ? '1 tower' : `${sim.unbuilt} towers`} waiting for gold</span> : null}
        </div>
        <Board game={game} label="Play" onSpot={onSpot}>
          {game.layout.map((p) => {
            const spot = game.map.spots[p.spot];
            const t = towerOf(p.towerId);
            if (!spot || !t) return null;
            const built = sim.towers.some((x) => x.spot === p.spot);
            const st = statsAt(t, p.level);
            return (
              <g key={p.spot} className={`dfn-tower${built ? '' : ' waiting'}`} onContextMenu={(e) => (e.preventDefault(), removeAt(p.spot))} onClick={() => onSpot(p.spot)} data-tower={t.name}>
                <circle cx={spot[0] + 0.5} cy={spot[1] + 0.5} r={st.range} className="dfn-range" />
                <rect x={spot[0] + 0.17} y={spot[1] + 0.17} width={0.66} height={0.66} rx={0.12} className="dfn-tower-body" style={{ fill: `hsl(${(game.towers.indexOf(t) * 67) % 360} 55% 55%)` }} />
                <text x={spot[0] + 0.5} y={spot[1] + 0.58} textAnchor="middle" className="dfn-tower-level">
                  {p.level}
                </text>
                <title>{`${t.name}, level ${p.level}: ${st.damage} damage, ${st.rate}/s, range ${st.range}. Click to upgrade, right-click to remove.`}</title>
              </g>
            );
          })}
          {sim.shots.map((s, i) => (
            <line key={i} x1={s.from[0]} y1={s.from[1]} x2={s.to[0]} y2={s.to[1]} className="dfn-shot" />
          ))}
          {sim.enemies.map((e) => {
            const def = enemyOf(e.enemyId);
            return (
              <g key={e.uid} className={`dfn-enemy${def?.flying ? ' flying' : ''}`}>
                <circle cx={e.x} cy={e.y} r={def && def.health >= 150 ? 0.3 : 0.2} />
                <rect x={e.x - 0.3} y={e.y - 0.45} width={0.6} height={0.07} className="dfn-hp-back" />
                <rect x={e.x - 0.3} y={e.y - 0.45} width={0.6 * Math.max(0, e.hp / e.maxHp)} height={0.07} className="dfn-hp" />
              </g>
            );
          })}
        </Board>
        <div className="dfn-controls">
          <button className="tb-btn primary" onClick={() => setRunning(!running)} disabled={sim.phase === 'won' || sim.phase === 'lost'}>
            {running ? 'Pause' : sim.t > 0 ? 'Resume' : 'Start'}
          </button>
          <button className="tb-btn" onClick={() => (setRunning(false), setSim(createSim(game, game.layout, game.economy.breather)))}>
            Restart
          </button>
          <div className="dfn-speed" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} className={`tb-btn small${speed === s ? ' on' : ''}`} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
      <aside className="dfn-play-side">
        <h3>Build</h3>
        <p className="dfn-hint">Pick a tower, then click a build spot. Click a tower to upgrade it, right-click to remove it. This test layout is saved with the game.</p>
        <div className="dfn-pick" role="radiogroup" aria-label="Tower to build">
          {game.towers.map((t) => (
            <label key={t.id} className={`dfn-pick-btn${pick === t.id ? ' on' : ''}`}>
              <input type="radio" name="dfn-pick" checked={pick === t.id} onChange={() => setPick(t.id)} />
              {t.name} <em>{t.cost}</em>
            </label>
          ))}
        </div>
        <p className="dfn-hint">
          Layout: {game.layout.length} towers, {layoutCost} gold in all (start with {game.economy.startGold}).{' '}
          {game.layout.length ? (
            <button className="link-btn" onClick={() => onLayout([])}>
              Clear
            </button>
          ) : null}
        </p>
        <h3>Balance</h3>
        <p className={`dfn-verdict ${result.outcome}`}>
          {result.outcome === 'won' ? `The test layout holds all ${game.waves.length} waves with ${result.lives} of ${game.economy.lives} lives left.` : result.outcome === 'lost' ? `The test layout falls in wave ${result.cleared + 1} of ${game.waves.length}.` : 'The run never ends: an enemy can’t be killed or can’t reach the castle.'}
        </p>
        <table className="dfn-table">
          <thead>
            <tr>
              <th>Wave</th>
              <th title="Enemies sent">Foes</th>
              <th title="All their health together">Health</th>
              <th title="Kills and the wave bonus">Pays</th>
              <th title="In the test run: got through">Leaked</th>
              <th title="In the test run">Lives</th>
            </tr>
          </thead>
          <tbody>
            {sheet.map((w, i) => {
              const r = result.stats[i];
              return (
                <tr key={w.wave} className={r && r.leaked ? 'leaky' : ''}>
                  <td>{w.wave}</td>
                  <td>{w.count}</td>
                  <td>{w.health}</td>
                  <td>{w.reward + w.bonus}</td>
                  <td>{r ? r.leaked : '–'}</td>
                  <td>{r ? r.livesLeft : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </aside>
    </div>
  );
};
