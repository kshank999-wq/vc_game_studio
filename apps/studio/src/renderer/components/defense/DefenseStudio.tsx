import { useState } from 'react';
import { defenseIssues, newEnemy, newTower, newWave, pathClick, resizeMap, spotClick, starterDefense, updateDefense, type DefenseGame, type Enemy, type Tower, type TowerStats, type Wave } from '../../model/defense/defense';
import { waveSheet } from '../../model/defense/sim';
import type { DefenseTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { Board } from './Board';
import { Num, Text } from './fields';
import { PlayTab } from './PlayTab';

const TABS: { id: DefenseTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'map', label: 'Map and path' },
  { id: 'towers', label: 'Towers' },
  { id: 'enemies', label: 'Enemies' },
  { id: 'waves', label: 'Waves' },
  { id: 'economy', label: 'Gold and lives' },
  { id: 'play', label: 'Play and balance' },
];

/**
 * The castle defense workspace (game modules): one tab a step of its path,
 * concept to play. Everything is roughed in from a small starter game, so
 * there is something to play from the first minute, and refined from there.
 */
export const DefenseStudio = ({ project, tab, onTab, onCommit }: { project: Project; tab: DefenseTab; onTab: (t: DefenseTab) => void; onCommit: (p: Project) => void }) => {
  const game = project.defense ?? starterDefense();
  const change = (f: (g: DefenseGame) => DefenseGame) => onCommit(updateDefense(project, f));
  const issues = defenseIssues(game);
  return (
    <div className="dfn-studio">
      <nav className="dfn-tabs" aria-label="Castle defense">
        {TABS.map((t, i) => (
          <button key={t.id} className={`dfn-tab${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            <span className="dfn-tab-num">{i + 1}</span> {t.label}
          </button>
        ))}
        {issues.length ? (
          <div className="dfn-issues" role="status">
            <h4>To look at</h4>
            <ul>
              {issues.map((x, i) => (
                <li key={i} className={x.severity}>
                  {x.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>
      <section className="dfn-body">
        {tab === 'concept' && <ConceptTab game={game} change={change} />}
        {tab === 'map' && <MapTab game={game} change={change} />}
        {tab === 'towers' && <TowersTab game={game} change={change} />}
        {tab === 'enemies' && <EnemiesTab game={game} change={change} />}
        {tab === 'waves' && <WavesTab game={game} change={change} />}
        {tab === 'economy' && <EconomyTab game={game} change={change} />}
        {tab === 'play' && <PlayTab game={game} onLayout={(layout) => change((g) => ({ ...g, layout }))} />}
      </section>
    </div>
  );
};

type Change = (f: (g: DefenseGame) => DefenseGame) => void;

const Intro = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <header className="dfn-intro">
    <h2>{title}</h2>
    <p>{children}</p>
  </header>
);

const ConceptTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const set = (patch: Partial<DefenseGame['concept']>) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }));
  return (
    <div className="dfn-pane narrow">
      <Intro title="Concept">What the game is, in a few lines. Keep it rough: you will come back to it.</Intro>
      <Text label="Premise" area value={game.concept.premise ?? ''} placeholder="e.g. Hold the last mountain keep against the goblin horde through one long night." onCommit={(v) => set({ premise: v })} />
      <Text label="Theme and look" value={game.concept.theme ?? ''} placeholder="e.g. Cartoon medieval, warm colors" onCommit={(v) => set({ theme: v })} />
      <label className="dfn-text">
        <span>Platform</span>
        <select className="inp small" value={game.concept.platform ?? 'mobile'} aria-label="Platform" onChange={(e) => set({ platform: e.target.value as DefenseGame['concept']['platform'] })}>
          <option value="mobile">Phone and tablet</option>
          <option value="pc">PC</option>
          <option value="console">Console</option>
          <option value="web">Web</option>
        </select>
      </label>
      <Text label="Notes" area value={game.concept.notes ?? ''} placeholder="Ideas for later: hero units, spells, a map per region…" onCommit={(v) => set({ notes: v })} />
    </div>
  );
};

const MapTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const [tool, setTool] = useState<'path' | 'spots'>('path');
  const m = game.map;
  return (
    <div className="dfn-pane">
      <Intro title="Map and path">
        Lay the path cell by cell from where the enemies come in (IN) to the castle (♜): click next to its end to add, click its end to take it back, click anywhere else to start again. Then mark the build spots beside it.
      </Intro>
      <div className="dfn-row">
        <div className="dfn-seg" role="radiogroup" aria-label="Tool">
          <label className={`tb-btn small${tool === 'path' ? ' on' : ''}`}>
            <input type="radio" name="dfn-tool" checked={tool === 'path'} onChange={() => setTool('path')} />
            Path
          </label>
          <label className={`tb-btn small${tool === 'spots' ? ' on' : ''}`}>
            <input type="radio" name="dfn-tool" checked={tool === 'spots'} onChange={() => setTool('spots')} />
            Build spots
          </label>
        </div>
        <Num label="Columns" value={m.cols} min={4} max={40} onCommit={(v) => change((g) => ({ ...g, map: resizeMap(g.map, v, g.map.rows) }))} />
        <Num label="Rows" value={m.rows} min={3} max={30} onCommit={(v) => change((g) => ({ ...g, map: resizeMap(g.map, g.map.cols, v) }))} />
        <span className="dfn-hint">
          Path {m.path.length} cells · {m.spots.length} build spots
        </span>
        <button className="tb-btn small" onClick={() => change((g) => ({ ...g, map: { ...g.map, path: [] } }))}>
          Clear path
        </button>
        <button className="tb-btn small" onClick={() => change((g) => ({ ...g, map: { ...g.map, spots: [] }, layout: [] }))}>
          Clear spots
        </button>
      </div>
      <Board
        game={game}
        label="Map"
        onCell={(cell) =>
          change((g) => {
            const map = tool === 'path' ? pathClick(g.map, cell) : spotClick(g.map, cell);
            // A spot that is gone takes its tower in the test layout with it; the others keep their place.
            const index = new Map(map.spots.map((s, i) => [`${s[0]},${s[1]}`, i]));
            const layout = g.layout.flatMap((p) => {
              const s = g.map.spots[p.spot];
              const i = s ? index.get(`${s[0]},${s[1]}`) : undefined;
              return i === undefined ? [] : [{ ...p, spot: i }];
            });
            return { ...g, map, layout };
          })
        }
      />
    </div>
  );
};

const statsFields = (s: TowerStats, set: (patch: Partial<TowerStats>) => void, prefix = '') => (
  <>
    <Num label={`${prefix}Cost`} value={s.cost} min={0} onCommit={(v) => set({ cost: v })} />
    <Num label={`${prefix}Damage`} value={s.damage} min={0} onCommit={(v) => set({ damage: v })} />
    <Num label={`${prefix}Range`} value={s.range} min={0.5} step={0.1} suffix="cells" onCommit={(v) => set({ range: v })} />
    <Num label={`${prefix}Rate`} value={s.rate} min={0.05} step={0.05} suffix="/s" onCommit={(v) => set({ rate: v })} />
  </>
);

const TowersTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const set = (id: string, f: (t: Tower) => Tower) => change((g) => ({ ...g, towers: g.towers.map((t) => (t.id === id ? f(t) : t)) }));
  return (
    <div className="dfn-pane">
      <Intro title="Towers">Each tower a different job: fast and cheap, slow and heavy (splash), slowing, anti-air. Upgrades are levels 2, 3… with their own cost and stats.</Intro>
      <div className="dfn-cards">
        {game.towers.map((t) => (
          <article key={t.id} className="dfn-card" aria-label={t.name}>
            <div className="dfn-card-head">
              <Text label="Name" value={t.name} onCommit={(v) => set(t.id, (x) => ({ ...x, name: v.trim() || x.name }))} />
              <button className="icon-btn small" aria-label={`Remove ${t.name}`} title="Remove" onClick={() => change((g) => ({ ...g, towers: g.towers.filter((x) => x.id !== t.id), layout: g.layout.filter((p) => p.towerId !== t.id) }))}>
                ×
              </button>
            </div>
            <div className="dfn-grid">
              {statsFields(t, (patch) => set(t.id, (x) => ({ ...x, ...patch })))}
              <Num label="Splash" value={t.splash} min={0} step={0.1} suffix="cells" title="Damage also lands this far round the target" onCommit={(v) => set(t.id, (x) => ({ ...x, splash: v }))} />
              <Num label="Slow" value={Math.round(t.slow * 100)} min={0} max={90} suffix="%" title="Slows what it hits, for a second" onCommit={(v) => set(t.id, (x) => ({ ...x, slow: v / 100 }))} />
              <label className="dfn-check">
                <input type="checkbox" checked={t.hitsAir} onChange={(e) => set(t.id, (x) => ({ ...x, hitsAir: e.target.checked }))} /> Hits flying
              </label>
            </div>
            {t.upgrades.map((u, i) => (
              <div key={i} className="dfn-grid dfn-upgrade">
                <span className="dfn-level">Level {i + 2}</span>
                {statsFields(u, (patch) => set(t.id, (x) => ({ ...x, upgrades: x.upgrades.map((y, j) => (j === i ? { ...y, ...patch } : y)) })))}
                <button className="icon-btn small" aria-label={`Remove level ${i + 2}`} onClick={() => set(t.id, (x) => ({ ...x, upgrades: x.upgrades.slice(0, i) }))}>
                  ×
                </button>
              </div>
            ))}
            <button
              className="link-btn"
              onClick={() =>
                set(t.id, (x) => {
                  const top = x.upgrades[x.upgrades.length - 1] ?? x;
                  return { ...x, upgrades: [...x.upgrades, { cost: Math.round(x.cost * 0.8), damage: Math.round(top.damage * 1.5), range: Math.round((top.range + 0.2) * 10) / 10, rate: Math.round(top.rate * 1.1 * 100) / 100 }] };
                })
              }
            >
              + Upgrade level
            </button>
          </article>
        ))}
      </div>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, towers: [...g.towers, newTower()] }))}>
        + Tower
      </button>
    </div>
  );
};

const EnemiesTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const set = (id: string, patch: Partial<Enemy>) => change((g) => ({ ...g, enemies: g.enemies.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  return (
    <div className="dfn-pane">
      <Intro title="Enemies">Each enemy asks something different of the towers: many and weak, few and armored, fast, flying.</Intro>
      <div className="dfn-cards">
        {game.enemies.map((e) => (
          <article key={e.id} className="dfn-card" aria-label={e.name}>
            <div className="dfn-card-head">
              <Text label="Name" value={e.name} onCommit={(v) => set(e.id, { name: v.trim() || e.name })} />
              <button
                className="icon-btn small"
                aria-label={`Remove ${e.name}`}
                title="Remove"
                onClick={() => change((g) => ({ ...g, enemies: g.enemies.filter((x) => x.id !== e.id), waves: g.waves.map((w) => ({ ...w, groups: w.groups.filter((grp) => grp.enemyId !== e.id) })) }))}
              >
                ×
              </button>
            </div>
            <div className="dfn-grid">
              <Num label="Health" value={e.health} min={1} onCommit={(v) => set(e.id, { health: v })} />
              <Num label="Speed" value={e.speed} min={0.1} step={0.1} suffix="cells/s" onCommit={(v) => set(e.id, { speed: v })} />
              <Num label="Armor" value={e.armor} min={0} title="Taken off every hit" onCommit={(v) => set(e.id, { armor: v })} />
              <Num label="Reward" value={e.reward} min={0} suffix="gold" onCommit={(v) => set(e.id, { reward: v })} />
              <Num label="Leak" value={e.leak} min={0} suffix="lives" title="Lives lost if it reaches the castle" onCommit={(v) => set(e.id, { leak: v })} />
              <label className="dfn-check">
                <input type="checkbox" checked={e.flying} onChange={(ev) => set(e.id, { flying: ev.target.checked })} /> Flying
              </label>
            </div>
          </article>
        ))}
      </div>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, enemies: [...g.enemies, newEnemy()] }))}>
        + Enemy
      </button>
    </div>
  );
};

const WavesTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const sheet = waveSheet(game);
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
      <Intro title="Waves">Each wave a little harder than the last, mixing the enemies. A group sends a number of one enemy, a gap apart, starting a delay into the wave.</Intro>
      <ol className="dfn-waves">
        {game.waves.map((w, i) => (
          <li key={w.id} className="dfn-card" aria-label={`Wave ${i + 1}`}>
            <div className="dfn-card-head">
              <h3>Wave {i + 1}</h3>
              <span className="dfn-hint">
                {sheet[i]?.count} enemies · {sheet[i]?.health} health · pays {(sheet[i]?.reward ?? 0) + w.bonus}
              </span>
              <div className="dfn-row tight">
                <button className="icon-btn small" aria-label={`Move wave ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn small" aria-label={`Move wave ${i + 1} later`} disabled={i === game.waves.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="icon-btn small" aria-label={`Copy wave ${i + 1}`} title="Copy" onClick={() => change((g) => ({ ...g, waves: [...g.waves.slice(0, i + 1), { ...w, id: newWave('').id, groups: w.groups.map((x) => ({ ...x })) }, ...g.waves.slice(i + 1)] }))}>
                  ⧉
                </button>
                <button className="icon-btn small" aria-label={`Remove wave ${i + 1}`} onClick={() => change((g) => ({ ...g, waves: g.waves.filter((x) => x.id !== w.id) }))}>
                  ×
                </button>
              </div>
            </div>
            {w.groups.map((grp, j) => (
              <div key={j} className="dfn-grid dfn-group">
                <label className="dfn-text">
                  <span>Enemy</span>
                  <select className="inp small" value={grp.enemyId} aria-label="Enemy" onChange={(e) => setWave(w.id, (x) => ({ ...x, groups: x.groups.map((y, k) => (k === j ? { ...y, enemyId: e.target.value } : y)) }))}>
                    {game.enemies.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Num label="Count" value={grp.count} min={1} onCommit={(v) => setWave(w.id, (x) => ({ ...x, groups: x.groups.map((y, k) => (k === j ? { ...y, count: v } : y)) }))} />
                <Num label="Gap" value={grp.gap} min={0.1} step={0.1} suffix="s" onCommit={(v) => setWave(w.id, (x) => ({ ...x, groups: x.groups.map((y, k) => (k === j ? { ...y, gap: v } : y)) }))} />
                <Num label="Delay" value={grp.delay} min={0} step={0.5} suffix="s" onCommit={(v) => setWave(w.id, (x) => ({ ...x, groups: x.groups.map((y, k) => (k === j ? { ...y, delay: v } : y)) }))} />
                <button className="icon-btn small" aria-label="Remove group" onClick={() => setWave(w.id, (x) => ({ ...x, groups: x.groups.filter((_, k) => k !== j) }))}>
                  ×
                </button>
              </div>
            ))}
            <div className="dfn-row">
              {game.enemies.length ? (
                <button className="link-btn" onClick={() => setWave(w.id, (x) => ({ ...x, groups: [...x.groups, { enemyId: game.enemies[0]!.id, count: 5, gap: 1, delay: 0 }] }))}>
                  + Group
                </button>
              ) : null}
              <Num label="Bonus" value={w.bonus} min={0} suffix="gold" title="Paid for getting through it" onCommit={(v) => setWave(w.id, (x) => ({ ...x, bonus: v }))} />
            </div>
          </li>
        ))}
      </ol>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, waves: [...g.waves, newWave(g.enemies[0]?.id ?? '')] }))}>
        + Wave
      </button>
    </div>
  );
};

const EconomyTab = ({ game, change }: { game: DefenseGame; change: Change }) => {
  const set = (patch: Partial<DefenseGame['economy']>) => change((g) => ({ ...g, economy: { ...g.economy, ...patch } }));
  const e = game.economy;
  const cheapest = game.towers.length ? Math.min(...game.towers.map((t) => t.cost)) : 0;
  return (
    <div className="dfn-pane narrow">
      <Intro title="Gold and lives">What the player starts with. Enough gold for one or two towers is usual; kills and wave bonuses pay for the rest.</Intro>
      <div className="dfn-grid">
        <Num label="Starting gold" value={e.startGold} min={0} onCommit={(v) => set({ startGold: v })} />
        <Num label="Lives" value={e.lives} min={1} onCommit={(v) => set({ lives: v })} />
        <Num label="Selling gives back" value={Math.round(e.sellBack * 100)} min={0} max={100} suffix="%" onCommit={(v) => set({ sellBack: v / 100 })} />
        <Num label="Break between waves" value={e.breather} min={0} step={1} suffix="s" onCommit={(v) => set({ breather: v })} />
      </div>
      {cheapest ? (
        <p className="dfn-hint">
          The starting gold builds {Math.floor(e.startGold / cheapest)} of the cheapest tower ({cheapest} gold).
        </p>
      ) : null}
    </div>
  );
};
