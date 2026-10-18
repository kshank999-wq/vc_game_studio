import { arenaIssues, laneXs, newUnit, starterArena, updateArena, type ArenaGame, type Side, type TowerStats, type Unit } from '../../model/arena/arena';
import type { ArenaTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { ArenaPlay } from './ArenaPlay';

const TABS: { id: ArenaTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'field', label: 'Field and towers' },
  { id: 'units', label: 'Units' },
  { id: 'match', label: 'Energy and time' },
  { id: 'decks', label: 'Decks' },
  { id: 'play', label: 'Play and balance' },
];

/**
 * The head-to-head arena workspace (game modules): one tab a step of its
 * path, concept to play. It starts from a small game that plays from the
 * first minute, and is refined from there.
 */
export const ArenaStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: ArenaTab) => void; onCommit: (p: Project) => void }) => {
  const tab: ArenaTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.arena ?? starterArena();
  const change = (f: (g: ArenaGame) => ArenaGame) => onCommit(updateArena(project, f));
  return (
    <div className="dfn-studio">
      <StepTabs label="Head-to-head arena" tabs={TABS} tab={tab} onTab={onTab} issues={arenaIssues(game)} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. Rival wizard schools settle it on the dueling green, one summoned beast at a time."
            themeHint="e.g. Bright storybook, chunky characters"
            notesHint="Ideas for later: spells, a card per arena, ranked ladders…"
          />
        )}
        {tab === 'field' && <FieldTab game={game} change={change} />}
        {tab === 'units' && <UnitsTab game={game} change={change} />}
        {tab === 'match' && <MatchTab game={game} change={change} />}
        {tab === 'decks' && <DecksTab game={game} change={change} />}
        {tab === 'play' && <ArenaPlay game={game} />}
      </section>
    </div>
  );
};

type Change = (f: (g: ArenaGame) => ArenaGame) => void;

const towerFields = (t: TowerStats, set: (patch: Partial<TowerStats>) => void) => (
  <>
    <Num label="Health" value={t.health} min={1} onCommit={(v) => set({ health: v })} />
    <Num label="Damage" value={t.damage} min={0} onCommit={(v) => set({ damage: v })} />
    <Num label="Rate" value={t.rate} min={0.05} step={0.05} suffix="/s" onCommit={(v) => set({ rate: v })} />
    <Num label="Range" value={t.range} min={0.5} step={0.5} suffix="units" onCommit={(v) => set({ range: v })} />
  </>
);

const FieldTab = ({ game, change }: { game: ArenaGame; change: Change }) => (
  <div className="dfn-pane narrow">
    <Intro title="Field and towers">Each side has a keep in the middle of its edge and a guard tower in every lane. Knock down the keep to win; at time, more towers down wins.</Intro>
    <div className="dfn-seg" role="radiogroup" aria-label="Lanes">
      {[1, 2, 3].map((n) => (
        <label key={n} className={`tb-btn small${game.match.lanes === n ? ' on' : ''}`}>
          <input type="radio" name="arn-lanes" checked={game.match.lanes === n} onChange={() => change((g) => ({ ...g, match: { ...g.match, lanes: n } }))} />
          {n} lane{n === 1 ? '' : 's'}
        </label>
      ))}
    </div>
    <h3 className="arn-sub">Keep</h3>
    <div className="dfn-grid">{towerFields(game.keep, (patch) => change((g) => ({ ...g, keep: { ...g.keep, ...patch } })))}</div>
    <h3 className="arn-sub">Guard towers</h3>
    <div className="dfn-grid">{towerFields(game.guard, (patch) => change((g) => ({ ...g, guard: { ...g.guard, ...patch } })))}</div>
    <p className="dfn-hint">
      {laneXs(game.match.lanes).length * 2 + 2} towers in all. A side’s towers hold {game.keep.health + game.guard.health * laneXs(game.match.lanes).length} health together.
    </p>
  </div>
);

const UnitsTab = ({ game, change }: { game: ArenaGame; change: Change }) => {
  const set = (id: string, patch: Partial<Unit>) => change((g) => ({ ...g, units: g.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  return (
    <div className="dfn-pane">
      <Intro title="Units">Each unit a job, and each one beaten by another: tanky, ranged, swarm, splash, flying. The matchup table on Play and balance shows who beats whom.</Intro>
      <div className="dfn-cards">
        {game.units.map((u) => (
          <article key={u.id} className="dfn-card" aria-label={u.name}>
            <div className="dfn-card-head">
              <Text label="Name" value={u.name} onCommit={(v) => set(u.id, { name: v.trim() || u.name })} />
              <button
                className="icon-btn small"
                aria-label={`Remove ${u.name}`}
                title="Remove"
                onClick={() => change((g) => ({ ...g, units: g.units.filter((x) => x.id !== u.id), decks: { blue: g.decks.blue.filter((id) => id !== u.id), red: g.decks.red.filter((id) => id !== u.id) } }))}
              >
                ×
              </button>
            </div>
            <div className="dfn-grid">
              <Num label="Cost" value={u.cost} min={1} suffix="energy" onCommit={(v) => set(u.id, { cost: v })} />
              <Num label="Count" value={u.count} min={1} max={12} title="How many come when it is played" onCommit={(v) => set(u.id, { count: v })} />
              <Num label="Health" value={u.health} min={1} onCommit={(v) => set(u.id, { health: v })} />
              <Num label="Damage" value={u.damage} min={0} onCommit={(v) => set(u.id, { damage: v })} />
              <Num label="Rate" value={u.rate} min={0.05} step={0.05} suffix="/s" onCommit={(v) => set(u.id, { rate: v })} />
              <Num label="Range" value={u.range} min={0.3} step={0.1} suffix="units" onCommit={(v) => set(u.id, { range: v })} />
              <Num label="Speed" value={u.speed} min={0.1} step={0.1} suffix="units/s" onCommit={(v) => set(u.id, { speed: v })} />
              <Num label="Splash" value={u.splash} min={0} step={0.1} suffix="units" onCommit={(v) => set(u.id, { splash: v })} />
            </div>
            <div className="dfn-row">
              <label className="dfn-check">
                <input type="checkbox" checked={u.buildingsOnly} onChange={(e) => set(u.id, { buildingsOnly: e.target.checked })} /> Goes only for towers
              </label>
              <label className="dfn-check">
                <input type="checkbox" checked={u.flying} onChange={(e) => set(u.id, { flying: e.target.checked })} /> Flying
              </label>
              <label className="dfn-check">
                <input type="checkbox" checked={u.hitsAir} onChange={(e) => set(u.id, { hitsAir: e.target.checked })} /> Hits flying
              </label>
            </div>
            <p className="dfn-hint">
              {Math.round(u.damage * u.rate * u.count)} damage a second in all, {u.health * u.count} health in all, for {u.cost} energy.
            </p>
          </article>
        ))}
      </div>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, units: [...g.units, newUnit()] }))}>
        + Unit
      </button>
    </div>
  );
};

const MatchTab = ({ game, change }: { game: ArenaGame; change: Change }) => {
  const set = (patch: Partial<ArenaGame['match']>) => change((g) => ({ ...g, match: { ...g.match, ...patch } }));
  const m = game.match;
  return (
    <div className="dfn-pane narrow">
      <Intro title="Energy and time">Energy builds up for both sides at the same rate. How fast it comes sets the pace: slow is a thinking game, fast is a scramble.</Intro>
      <div className="dfn-grid">
        <Num label="Start with" value={m.energyStart} min={0} suffix="energy" onCommit={(v) => set({ energyStart: v })} />
        <Num label="Hold at most" value={m.energyMax} min={1} suffix="energy" onCommit={(v) => set({ energyMax: v })} />
        <Num label="Builds at" value={m.energyRate} min={0.01} step={0.01} suffix="a second" onCommit={(v) => set({ energyRate: v })} />
        <Num label="Match length" value={m.length} min={10} step={10} suffix="s" onCommit={(v) => set({ length: v })} />
      </div>
      <p className="dfn-hint">
        One energy every {(1 / Math.max(0.01, m.energyRate)).toFixed(1)} s; from empty to full in {Math.round(m.energyMax / Math.max(0.01, m.energyRate))} s. A match gives each side about {Math.round(m.energyStart + m.energyRate * m.length)} energy to spend.
      </p>
    </div>
  );
};

const DecksTab = ({ game, change }: { game: ArenaGame; change: Change }) => {
  const toggle = (side: Side, id: string, on: boolean) => change((g) => ({ ...g, decks: { ...g.decks, [side]: on ? [...g.decks[side], id] : g.decks[side].filter((x) => x !== id) } }));
  const avg = (side: Side) => {
    const costs = game.decks[side].flatMap((id) => game.units.filter((u) => u.id === id).map((u) => u.cost));
    return costs.length ? (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(1) : '–';
  };
  return (
    <div className="dfn-pane narrow">
      <Intro title="Decks">The cards each side brings. The studio’s opponent plays its deck in the order the cards were added.</Intro>
      <div className="arn-decks">
        {(['blue', 'red'] as const).map((side) => (
          <fieldset key={side} className={`dfn-card arn-deck ${side}`}>
            <legend>{side === 'blue' ? 'The player' : 'The opponent'}</legend>
            {game.units.map((u) => (
              <label key={u.id} className="dfn-check">
                <input type="checkbox" checked={game.decks[side].includes(u.id)} onChange={(e) => toggle(side, u.id, e.target.checked)} /> {u.name} <em className="muted">{u.cost}</em>
              </label>
            ))}
            <p className="dfn-hint">
              {game.decks[side].length} cards, {avg(side)} energy on average.
            </p>
          </fieldset>
        ))}
      </div>
    </div>
  );
};
