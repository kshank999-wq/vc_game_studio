import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ARENA, laneXs, type ArenaGame } from '../../model/arena/arena';
import { createArena, deploy, MATCHUP_ENERGY, matchups, ownHalf, runMatch, stepArena, towersDown } from '../../model/arena/sim';

/**
 * Play and balance: play the player's deck against the studio's opponent
 * (pick a card, click your half of the field), watch the two decks play
 * each other, and read the matchup table: every unit against every other,
 * the same energy spent on each.
 */
export const ArenaPlay = ({ game }: { game: ArenaGame }) => {
  const [sim, setSim] = useState(() => createArena(game));
  const [running, setRunning] = useState(false);
  const [watch, setWatch] = useState(false);
  const deck = game.decks.blue.filter((id) => game.units.some((u) => u.id === id));
  const [pick, setPick] = useState<string>(deck[0] ?? '');
  const simRef = useRef(sim);
  simRef.current = sim;

  useEffect(() => {
    setRunning(false);
    setSim(createArena(game));
  }, [game]);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = stepArena(game, simRef.current, dt, watch ? ['blue', 'red'] : ['red']);
      setSim(next);
      if (next.phase === 'over') setRunning(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, watch, game]);

  const svg = useRef<SVGSVGElement>(null);
  const place = (e: MouseEvent<SVGSVGElement>) => {
    const el = svg.current;
    if (!el || !pick || watch || sim.phase !== 'running') return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()?.inverse());
    const [lo] = ownHalf('blue');
    if (p.y < lo - 0.5) return;
    setSim(deploy(game, sim, 'blue', pick, p.x, p.y));
    if (!running && sim.t === 0) setRunning(true);
  };

  const table = useMemo(() => matchups(game), [game]);
  const match = useMemo(() => runMatch(game), [game]);
  const unitOf = new Map(game.units.map((u) => [u.id, u]));
  const short = (name: string) => (name.length > 7 ? `${name.slice(0, 6)}…` : name);
  const wins = game.units.map((_, i) => table[i]!.filter((m) => m.winner === 'a').length);
  const others = Math.max(0, game.units.length - 1);
  const top = wins.indexOf(Math.max(...wins));
  const down = towersDown(sim);
  const left = Math.max(0, Math.ceil(sim.limit - sim.t));
  const status =
    sim.phase === 'over'
      ? sim.winner === 'blue'
        ? sim.reason === 'keep'
          ? 'You won: their keep is down'
          : `You won on towers, ${down.red}–${down.blue}`
        : sim.winner === 'red'
          ? sim.reason === 'keep'
            ? 'They won: your keep is down'
            : `They won on towers, ${down.blue}–${down.red}`
          : 'A draw'
      : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const verdictMatch =
    match.winner === 'draw'
      ? `The two decks, both played by the studio, draw ${match.down.red}–${match.down.blue}.`
      : `The two decks, both played by the studio: ${match.winner === 'blue' ? 'yours' : 'the opponent’s'} wins ${match.reason === 'keep' ? `by the keep in ${match.seconds} s` : `on towers, ${Math.max(match.down.red, match.down.blue)}–${Math.min(match.down.red, match.down.blue)}`}.`;

  return (
    <div className="dfn-play">
      <div className="dfn-play-main arn-main">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{status}</span>
          <span>
            Towers down: theirs {down.red}, yours {down.blue}
          </span>
        </div>
        <div className="arn-stage">
          <svg ref={svg} className="arn-field" viewBox={`0 0 ${ARENA.width} ${ARENA.length}`} role="img" aria-label="Arena" onClick={place}>
            <rect x={0} y={0} width={ARENA.width} height={ARENA.length / 2} className="arn-half red" />
            <rect x={0} y={ARENA.length / 2} width={ARENA.width} height={ARENA.length / 2} className={`arn-half blue${pick && !watch ? ' open' : ''}`} />
            <line x1={0} x2={ARENA.width} y1={ARENA.length / 2} y2={ARENA.length / 2} className="arn-mid" />
            {laneXs(game.match.lanes).map((x) => (
              <line key={x} x1={x} x2={x} y1={0.3} y2={ARENA.length - 0.3} className="arn-lane" />
            ))}
            {sim.towers.map((t) => (
              <g key={t.id} className={`arn-tower ${t.side}${t.hp <= 0 ? ' down' : ''}`} data-tower={t.id}>
                <rect x={t.x - (t.kind === 'keep' ? 0.7 : 0.5)} y={t.y - (t.kind === 'keep' ? 0.7 : 0.5)} width={t.kind === 'keep' ? 1.4 : 1} height={t.kind === 'keep' ? 1.4 : 1} rx={0.15} />
                {t.hp > 0 ? (
                  <>
                    <rect x={t.x - 0.6} y={t.y - 1} width={1.2} height={0.14} className="arn-hp-back" />
                    <rect x={t.x - 0.6} y={t.y - 1} width={(1.2 * t.hp) / t.maxHp} height={0.14} className="arn-hp" />
                  </>
                ) : null}
              </g>
            ))}
            {sim.strikes.map((k, i) => (
              <line key={i} x1={k.from[0]} y1={k.from[1]} x2={k.to[0]} y2={k.to[1]} className={`arn-strike ${k.side}`} />
            ))}
            {sim.fighters.map((f) => {
              const u = unitOf.get(f.unitId);
              const big = (u?.health ?? 0) >= 1500;
              return (
                <g key={f.uid} className={`arn-unit ${f.side}${u?.flying ? ' flying' : ''}`}>
                  <circle cx={f.x} cy={f.y} r={big ? 0.42 : 0.28} />
                  <text x={f.x} y={f.y + 0.1} textAnchor="middle">
                    {u?.name.slice(0, 1)}
                  </text>
                  <rect x={f.x - 0.35} y={f.y - 0.55} width={0.7} height={0.08} className="arn-hp-back" />
                  <rect x={f.x - 0.35} y={f.y - 0.55} width={(0.7 * f.hp) / f.maxHp} height={0.08} className="arn-hp" />
                </g>
              );
            })}
          </svg>
          <div className="arn-hand">
            <div className="arn-energy" role="meter" aria-label="Energy" aria-valuemin={0} aria-valuemax={game.match.energyMax} aria-valuenow={Math.floor(sim.energy.blue)}>
              <div className="arn-energy-fill" style={{ width: `${(100 * sim.energy.blue) / Math.max(1, game.match.energyMax)}%` }} />
              <span>
                {Math.floor(sim.energy.blue)} / {game.match.energyMax} energy
              </span>
            </div>
            <div className="dfn-pick" role="radiogroup" aria-label="Card to play">
              {deck.map((id, i) => {
                const u = unitOf.get(id)!;
                return (
                  <label key={`${id}${i}`} className={`dfn-pick-btn${pick === id ? ' on' : ''}${sim.energy.blue < u.cost ? ' short' : ''}`}>
                    <input type="radio" name="arn-pick" checked={pick === id} onChange={() => setPick(id)} />
                    {u.name}
                    {u.count > 1 ? ` ×${u.count}` : ''} <em>{u.cost}</em>
                  </label>
                );
              })}
            </div>
            <p className="dfn-hint">Pick a card, then click your half of the field (the bottom) to play it there. Playing the first card starts the clock.</p>
          </div>
        </div>
        <div className="dfn-controls">
          <button className="tb-btn primary" onClick={() => setRunning(!running)} disabled={sim.phase === 'over'}>
            {running ? 'Pause' : sim.t > 0 ? 'Resume' : 'Start'}
          </button>
          <button className="tb-btn" onClick={() => (setRunning(false), setSim(createArena(game)))}>
            Restart
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} /> The studio plays your deck too
          </label>
        </div>
      </div>
      <aside className="dfn-play-side">
        <h3>Matchups</h3>
        <p className="dfn-hint">Each row’s unit against each column’s, {MATCHUP_ENERGY} energy of each, from both ends of the field. ✓ wins (with the health it has left), ✗ loses, = too close to call.</p>
        <div className="arn-table-wrap">
          <table className="dfn-table arn-table">
            <thead>
              <tr>
                <th />
                {game.units.map((u) => (
                  <th key={u.id} title={u.name}>
                    {short(u.name)}
                  </th>
                ))}
                <th title="Matchups won">Wins</th>
              </tr>
            </thead>
            <tbody>
              {game.units.map((a, i) => (
                <tr key={a.id}>
                  <th scope="row">{a.name}</th>
                  {table[i]!.map((m, j) => (
                    <td key={j} className={i === j ? 'self' : m.winner === 'a' ? 'win' : m.winner === 'b' ? 'loss' : 'even'} title={i === j ? '' : `${a.name} against ${game.units[j]!.name}: ${m.winner === 'a' ? `wins${m.how === 'through' ? ' (gets through)' : ''}, ${Math.round(m.left * 100)}% health left` : m.winner === 'b' ? 'loses' : 'too close to call'}`}>
                      {i === j ? '·' : m.winner === 'a' ? `✓${Math.round(m.left * 100)}` : m.winner === 'b' ? '✗' : '='}
                    </td>
                  ))}
                  <td>
                    {wins[i]}/{others}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {others > 1 && wins[top] === others ? (
          <p className="dfn-verdict lost">{game.units[top]!.name} beats every other unit: everyone will play it. Give it a weakness.</p>
        ) : others > 1 && wins[top]! >= others - 1 ? (
          <p className="dfn-verdict lost">
            {game.units[top]!.name} beats {wins[top]} of {others}: the one to watch.
          </p>
        ) : (
          <p className="dfn-verdict won">No unit beats everything.</p>
        )}
        {game.units.map((u, i) => (wins[i] === 0 && others > 1 ? <p key={u.id} className="dfn-hint">{u.name} beats nothing at this cost: make it cheaper or stronger, or give it a job.</p> : null))}
        <h3>Deck against deck</h3>
        <p className="dfn-hint">{verdictMatch}</p>
      </aside>
    </div>
  );
};
