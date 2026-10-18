import { FIELD, MAX_COLS, MAX_ROWS, newInvader, newWave, shooterIssues, starterShooter, updateShooter, type Invader, type ShooterGame, type Wave } from '../../model/shooter/shooter';
import { shooterSheet } from '../../model/shooter/sim';
import type { ShooterTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { invaderHue, InvaderShape } from './Field';
import { ShooterPlay } from './ShooterPlay';

const TABS: { id: ShooterTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'ship', label: 'The ship' },
  { id: 'invaders', label: 'Invaders' },
  { id: 'waves', label: 'Waves' },
  { id: 'shields', label: 'Shields and scoring' },
  { id: 'play', label: 'Play and tune' },
];

/**
 * The arcade shooter workspace (game modules): one tab a step of its path,
 * concept to play. It starts from a small game that plays from the first
 * minute, and is refined from there.
 */
export const ShooterStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: ShooterTab) => void; onCommit: (p: Project) => void }) => {
  const tab: ShooterTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.shooter ?? starterShooter();
  const change = (f: (g: ShooterGame) => ShooterGame) => onCommit(updateShooter(project, f));
  return (
    <div className="dfn-studio">
      <StepTabs label="Arcade shooter" tabs={TABS} tab={tab} onTab={onTab} issues={shooterIssues(game)} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. The last ship in orbit holds off the swarm while the colony gets away."
            themeHint="e.g. Neon on black, chunky pixels"
            notesHint="Ideas for later: a mystery ship across the top, power-ups, boss waves…"
          />
        )}
        {tab === 'ship' && <ShipTab game={game} change={change} />}
        {tab === 'invaders' && <InvadersTab game={game} change={change} />}
        {tab === 'waves' && <WavesTab game={game} change={change} />}
        {tab === 'shields' && <ShieldsTab game={game} change={change} />}
        {tab === 'play' && <ShooterPlay game={game} />}
      </section>
    </div>
  );
};

type Change = (f: (g: ShooterGame) => ShooterGame) => void;

const ShipTab = ({ game, change }: { game: ShooterGame; change: Change }) => {
  const set = (patch: Partial<ShooterGame['ship']>) => change((g) => ({ ...g, ship: { ...g.ship, ...patch } }));
  const s = game.ship;
  return (
    <div className="dfn-pane narrow">
      <Intro title="The ship">The player’s ship slides along the bottom and fires straight up. The field is {FIELD.width} units wide.</Intro>
      <div className="dfn-grid">
        <Num label="Speed" value={s.speed} min={1} step={0.5} suffix="units/s" onCommit={(v) => set({ speed: v })} />
        <Num label="Fire rate" value={s.fireRate} min={0.2} step={0.1} suffix="shots/s" onCommit={(v) => set({ fireRate: v })} />
        <Num label="Shot speed" value={s.shotSpeed} min={2} step={1} suffix="units/s" onCommit={(v) => set({ shotSpeed: v })} />
        <Num label="Lives" value={s.lives} min={1} max={9} onCommit={(v) => set({ lives: v })} />
      </div>
      <p className="dfn-hint">
        Crossing the field takes {(FIELD.width / Math.max(0.1, s.speed)).toFixed(1)} s; a shot reaches the top in {(FIELD.shipY / Math.max(0.1, s.shotSpeed)).toFixed(2)} s.
      </p>
    </div>
  );
};

const InvadersTab = ({ game, change }: { game: ShooterGame; change: Change }) => {
  const set = (id: string, patch: Partial<Invader>) => change((g) => ({ ...g, invaders: g.invaders.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  return (
    <div className="dfn-pane">
      <Intro title="Invaders">Each asks something different: weak and many, quick to fire, tough and worth more. Only the lowest in each column fires.</Intro>
      <div className="dfn-cards">
        {game.invaders.map((v, i) => (
          <article key={v.id} className="dfn-card" aria-label={v.name}>
            <div className="dfn-card-head">
              <svg className="sht-swatch" viewBox="-0.5 -0.5 1 1" aria-hidden="true">
                <InvaderShape x={0} y={0} fill={invaderHue(i)} />
              </svg>
              <Text label="Name" value={v.name} onCommit={(t) => set(v.id, { name: t.trim() || v.name })} />
              <button
                className="icon-btn small"
                aria-label={`Remove ${v.name}`}
                title="Remove"
                onClick={() => change((g) => ({ ...g, invaders: g.invaders.filter((x) => x.id !== v.id), waves: g.waves.map((w) => ({ ...w, rows: w.rows.filter((r) => r !== v.id) })) }))}
              >
                ×
              </button>
            </div>
            <div className="dfn-grid">
              <Num label="Health" value={v.health} min={1} suffix="hits" onCommit={(n) => set(v.id, { health: n })} />
              <Num label="Points" value={v.points} min={0} onCommit={(n) => set(v.id, { points: n })} />
              <Num label="Fire" value={v.fire} min={0} step={0.5} suffix="a minute" title="While it is the lowest in its column" onCommit={(n) => set(v.id, { fire: n })} />
            </div>
          </article>
        ))}
      </div>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, invaders: [...g.invaders, newInvader()] }))}>
        + Invader
      </button>
    </div>
  );
};

/** A wave's formation, small: the rows as they will come down. */
const Formation = ({ game, wave }: { game: ShooterGame; wave: Wave }) => {
  const index = new Map(game.invaders.map((v, i) => [v.id, i]));
  const w = Math.max(1, wave.cols) * 1.2;
  const h = Math.max(1, wave.rows.length) * 0.9;
  return (
    <svg className="sht-formation" viewBox={`-0.6 -0.5 ${w} ${h}`} role="img" aria-label={`${wave.rows.length} rows of ${wave.cols}`}>
      {wave.rows.map((id, r) =>
        Array.from({ length: Math.min(MAX_COLS, Math.max(0, wave.cols)) }, (_, c) => <InvaderShape key={`${r},${c}`} x={c * 1.2} y={r * 0.9} fill={index.has(id) ? invaderHue(index.get(id)!) : 'gray'} />),
      )}
    </svg>
  );
};

const WavesTab = ({ game, change }: { game: ShooterGame; change: Change }) => {
  const sheet = shooterSheet(game);
  const setWave = (id: string, f: (w: Wave) => Wave) => change((g) => ({ ...g, waves: g.waves.map((w) => (w.id === id ? f(w) : w)) }));
  const move = (i: number, by: number) =>
    change((g) => {
      const waves = [...g.waves];
      const [w] = waves.splice(i, 1);
      waves.splice(Math.max(0, Math.min(waves.length, i + by)), 0, w!);
      return { ...g, waves };
    });
  return (
    <div className="dfn-pane">
      <Intro title="Waves">
        Each wave a formation: rows of invaders, top row first. It sweeps side to side and steps down at each side, faster as it thins. Up to {MAX_COLS} a row and {MAX_ROWS} rows.
      </Intro>
      <ol className="dfn-waves">
        {game.waves.map((w, i) => (
          <li key={w.id} className="dfn-card" aria-label={`Wave ${i + 1}`}>
            <div className="dfn-card-head">
              <h3>Wave {i + 1}</h3>
              <span className="dfn-hint">
                {sheet[i]?.count} invaders · {sheet[i]?.health} hits to clear · {sheet[i]?.points} points
              </span>
              <div className="dfn-row tight">
                <button className="icon-btn small" aria-label={`Move wave ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn small" aria-label={`Move wave ${i + 1} later`} disabled={i === game.waves.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="icon-btn small" aria-label={`Copy wave ${i + 1}`} title="Copy" onClick={() => change((g) => ({ ...g, waves: [...g.waves.slice(0, i + 1), { ...w, id: newWave('').id, rows: [...w.rows] }, ...g.waves.slice(i + 1)] }))}>
                  ⧉
                </button>
                <button className="icon-btn small" aria-label={`Remove wave ${i + 1}`} onClick={() => change((g) => ({ ...g, waves: g.waves.filter((x) => x.id !== w.id) }))}>
                  ×
                </button>
              </div>
            </div>
            <div className="sht-wave">
              <div className="sht-rows">
                {w.rows.map((id, r) => (
                  <div key={r} className="dfn-row tight">
                    <span className="dfn-level">Row {r + 1}</span>
                    <select className="inp small" value={id} aria-label={`Wave ${i + 1} row ${r + 1}`} onChange={(e) => setWave(w.id, (x) => ({ ...x, rows: x.rows.map((y, k) => (k === r ? e.target.value : y)) }))}>
                      {game.invaders.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <button className="icon-btn small" aria-label={`Remove row ${r + 1}`} onClick={() => setWave(w.id, (x) => ({ ...x, rows: x.rows.filter((_, k) => k !== r) }))}>
                      ×
                    </button>
                  </div>
                ))}
                {game.invaders.length && w.rows.length < MAX_ROWS ? (
                  <button className="link-btn" onClick={() => setWave(w.id, (x) => ({ ...x, rows: [...x.rows, x.rows[x.rows.length - 1] ?? game.invaders[0]!.id] }))}>
                    + Row
                  </button>
                ) : null}
              </div>
              <Formation game={game} wave={w} />
            </div>
            <div className="dfn-grid">
              <Num label="A row" value={w.cols} min={1} max={MAX_COLS} onCommit={(v) => setWave(w.id, (x) => ({ ...x, cols: v }))} />
              <Num label="Speed" value={w.speed} min={0.1} step={0.1} suffix="units/s" onCommit={(v) => setWave(w.id, (x) => ({ ...x, speed: v }))} />
              <Num label="Step down" value={w.drop} min={0} step={0.05} suffix="units" onCommit={(v) => setWave(w.id, (x) => ({ ...x, drop: v }))} />
              <Num label="Fire" value={w.fireScale} min={0} step={0.1} suffix="times" title="Times every invader's own fire rate" onCommit={(v) => setWave(w.id, (x) => ({ ...x, fireScale: v }))} />
              <Num label="Bonus" value={w.bonus} min={0} suffix="points" onCommit={(v) => setWave(w.id, (x) => ({ ...x, bonus: v }))} />
            </div>
          </li>
        ))}
      </ol>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, waves: [...g.waves, newWave(g.invaders[0]?.id ?? '')] }))}>
        + Wave
      </button>
    </div>
  );
};

const ShieldsTab = ({ game, change }: { game: ShooterGame; change: Change }) => {
  const shields = (patch: Partial<ShooterGame['shields']>) => change((g) => ({ ...g, shields: { ...g.shields, ...patch } }));
  const rules = (patch: Partial<ShooterGame['rules']>) => change((g) => ({ ...g, rules: { ...g.rules, ...patch } }));
  return (
    <div className="dfn-pane narrow">
      <Intro title="Shields and scoring">Shields to hide behind (they soak shots from both sides), extra lives, and how the pace builds.</Intro>
      <div className="dfn-grid">
        <Num label="Shields" value={game.shields.count} min={0} max={10} onCommit={(v) => shields({ count: v })} />
        <Num label="Each takes" value={game.shields.health} min={1} suffix="hits" onCommit={(v) => shields({ health: v })} />
        <Num label="Extra life every" value={game.rules.extraLifeEvery} min={0} step={100} suffix="points" title="0: no extra lives" onCommit={(v) => rules({ extraLifeEvery: v })} />
        <Num label="Speed-up" value={game.rules.speedUp} min={0} step={0.1} title="1: twice as fast when the last one is left" onCommit={(v) => rules({ speedUp: v })} />
        <Num label="Their shots fall at" value={game.rules.enemyShotSpeed} min={1} step={0.5} suffix="units/s" onCommit={(v) => rules({ enemyShotSpeed: v })} />
        <Num label="Break between waves" value={game.rules.breather} min={0} step={0.5} suffix="s" onCommit={(v) => rules({ breather: v })} />
      </div>
      <p className="dfn-hint">The last invader of a wave moves {(1 + game.rules.speedUp).toFixed(1)} times as fast as the full formation.</p>
    </div>
  );
};
