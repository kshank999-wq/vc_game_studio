import { useMemo, useState } from 'react';
import { gridRows, newPlatformLevel, paintTile, parseGrid, platformIssues, resizeGrid, starterPlatformer, updatePlatformer, type PlatformGame, type PlatformLevel, type Tile } from '../../model/platformer/platformer';
import { carefulRun, mapLevel, routeTrace } from '../../model/platformer/sim';
import type { PlatformTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { newId } from '../../model/project';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { PlatformBoard } from './PlatformBoard';
import { PlatformPlay } from './PlatformPlay';

const TABS: { id: PlatformTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'hero', label: 'The hero' },
  { id: 'levels', label: 'Levels' },
  { id: 'flow', label: 'Flow' },
  { id: 'play', label: 'Play and test' },
];

/**
 * The platformer workspace (game modules): one tab a step of its path,
 * concept to play. It starts with three levels the studio can finish, and
 * is refined from there.
 */
export const PlatformStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: PlatformTab) => void; onCommit: (p: Project) => void }) => {
  const tab: PlatformTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.platformer ?? starterPlatformer();
  const change = (f: (g: PlatformGame) => PlatformGame) => onCommit(updatePlatformer(project, f));
  const [index, setIndex] = useState(0);
  const at = Math.max(0, Math.min(index, game.levels.length - 1));
  const blocked = game.levels.filter((l) => !platformIssues(l).length && !mapLevel(game.rules, l).reachable).length;
  const issues = blocked ? [{ severity: 'error', message: `${blocked} level${blocked === 1 ? '' : 's'} where the studio can’t reach the goal.` }] : [];
  return (
    <div className="dfn-studio">
      <StepTabs label="Platformer" tabs={TABS} tab={tab} onTab={onTab} issues={issues} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. A lantern-bearer climbs the drowned tower to relight the beacon."
            themeHint="e.g. Moonlit ruins, soft pixel art"
            notesHint="Ideas for later: double jump, wall jumps, a boss, secret exits…"
          />
        )}
        {tab === 'hero' && <HeroTab game={game} change={change} />}
        {tab === 'levels' && <LevelsTab game={game} change={change} index={at} onIndex={setIndex} />}
        {tab === 'flow' && <FlowTab game={game} change={change} onOpen={(i) => (setIndex(i), onTab('levels'))} />}
        {tab === 'play' && <PlatformPlay game={game} index={at} onIndex={setIndex} />}
      </section>
    </div>
  );
};

type Change = (f: (g: PlatformGame) => PlatformGame) => void;

const HeroTab = ({ game, change }: { game: PlatformGame; change: Change }) => {
  const h = game.rules.hero;
  const set = (patch: Partial<PlatformGame['rules']['hero']>) => change((g) => ({ ...g, rules: { ...g.rules, hero: { ...g.rules.hero, ...patch } } }));
  const rules = (patch: Partial<PlatformGame['rules']>) => change((g) => ({ ...g, rules: { ...g.rules, ...patch } }));
  const rise = (h.jumpSpeed * h.jumpSpeed) / (2 * Math.max(0.1, h.gravity));
  const air = (2 * h.jumpSpeed) / Math.max(0.1, h.gravity);
  return (
    <div className="dfn-pane narrow">
      <Intro title="The hero">How the hero moves. A tile is a unit. The studio’s map of each level uses these numbers, so change them and every level is checked again.</Intro>
      <div className="dfn-grid">
        <Num label="Run speed" value={h.runSpeed} min={1} step={0.5} suffix="tiles/s" onCommit={(v) => set({ runSpeed: v })} />
        <Num label="Jump speed" value={h.jumpSpeed} min={1} step={0.5} suffix="tiles/s" onCommit={(v) => set({ jumpSpeed: v })} />
        <Num label="Gravity" value={h.gravity} min={1} step={1} suffix="tiles/s²" onCommit={(v) => set({ gravity: v })} />
        <Num label="Coyote time" value={h.coyoteTime} min={0} step={0.02} suffix="s" title="A jump still works this long after running off an edge" onCommit={(v) => set({ coyoteTime: v })} />
        <Num label="Enemies walk at" value={game.rules.enemySpeed} min={0} step={0.5} suffix="tiles/s" onCommit={(v) => rules({ enemySpeed: v })} />
        <Num label="Lives" value={game.rules.lives} min={1} onCommit={(v) => rules({ lives: v })} />
        <Num label="A coin is worth" value={game.rules.coinValue} min={0} suffix="points" onCommit={(v) => rules({ coinValue: v })} />
      </div>
      <p className="dfn-hint">
        A jump rises {rise.toFixed(2)} tiles: onto a ledge {Math.floor(rise)} tile{Math.floor(rise) === 1 ? '' : 's'} up, not {Math.floor(rise) + 1}. It stays up {air.toFixed(2)} s, carrying {(air * h.runSpeed).toFixed(1)} tiles across on the flat: gaps of {Math.max(0, Math.floor(air * h.runSpeed - 0.8))} tiles are safe.
      </p>
    </div>
  );
};

const PAINTS: { id: Tile; label: string }[] = [
  { id: '#', label: 'Solid' },
  { id: '=', label: 'One-way' },
  { id: '^', label: 'Spikes' },
  { id: 'o', label: 'Coin' },
  { id: 'e', label: 'Enemy' },
  { id: 'S', label: 'Start' },
  { id: 'G', label: 'Goal' },
  { id: '.', label: 'Erase' },
];

const LevelsTab = ({ game, change, index, onIndex }: { game: PlatformGame; change: Change; index: number; onIndex: (i: number) => void }) => {
  const [paint, setPaint] = useState<Tile>('#');
  const [overlay, setOverlay] = useState(true);
  const level = game.levels[index];
  const setLevel = (f: (l: PlatformLevel) => PlatformLevel) => change((g) => ({ ...g, levels: g.levels.map((l, i) => (i === index ? f(l) : l)) }));
  const map = useMemo(() => (level ? mapLevel(game.rules, level) : null), [game.rules, level]);
  const trace = useMemo(() => (level && overlay ? routeTrace(game.rules, level) : []), [game.rules, level, overlay]);
  const careful = useMemo(() => (level && map?.reachable ? carefulRun(game.rules, level) : null), [game.rules, level, map]);
  if (!level || !map) {
    return (
      <div className="dfn-pane">
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, levels: [newPlatformLevel(1)] }))}>
          + Level
        </button>
      </div>
    );
  }
  const grid = parseGrid(level.rows);
  const issues = platformIssues(level);
  return (
    <div className="blk-editor">
      <nav className="blk-list" aria-label="Levels">
        {game.levels.map((l, i) => (
          <button key={l.id} className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
            <span className="dfn-tab-num">{i + 1}</span> {l.name}
          </button>
        ))}
        <button className="link-btn" onClick={() => (change((g) => ({ ...g, levels: [...g.levels, newPlatformLevel(g.levels.length + 1)] })), onIndex(game.levels.length))}>
          + Level
        </button>
      </nav>
      <div className="dfn-pane">
        <Intro title="Levels">Paint the level tile by tile: pick a piece, then click or drag. The shaded cells are everywhere the hero can stand; the dotted line is the studio’s route to the goal.</Intro>
        <div className="dfn-row">
          <Text label="Name" value={level.name} onCommit={(v) => setLevel((l) => ({ ...l, name: v.trim() || l.name }))} />
          <Num label="Time bonus under" value={level.par} min={0} suffix="s" title="0 for no time bonus" onCommit={(v) => setLevel((l) => ({ ...l, par: v }))} />
          <Num label="Width" value={grid.cols} min={10} max={120} onCommit={(v) => setLevel((l) => ({ ...l, rows: gridRows(resizeGrid(parseGrid(l.rows), v, grid.rows)) }))} />
          <Num label="Height" value={grid.rows} min={6} max={24} onCommit={(v) => setLevel((l) => ({ ...l, rows: gridRows(resizeGrid(parseGrid(l.rows), grid.cols, v)) }))} />
          <div className="dfn-row tight">
            <button className="icon-btn small" title="Copy" aria-label="Copy level" onClick={() => (change((g) => ({ ...g, levels: [...g.levels.slice(0, index + 1), { ...level, id: newId('pl'), name: `${level.name} (copy)` }, ...g.levels.slice(index + 1)] })), onIndex(index + 1))}>
              ⧉
            </button>
            <button className="icon-btn small" title="Remove" aria-label="Remove level" onClick={() => (change((g) => ({ ...g, levels: g.levels.filter((_, i) => i !== index) })), onIndex(Math.max(0, index - 1)))}>
              ×
            </button>
          </div>
        </div>
        <div className="dfn-row">
          <div className="dfn-seg" role="radiogroup" aria-label="Paint">
            {PAINTS.map((p) => (
              <label key={p.id} className={`tb-btn small${paint === p.id ? ' on' : ''}`}>
                <input type="radio" name="pf-paint" checked={paint === p.id} onChange={() => setPaint(p.id)} />
                {p.label}
              </label>
            ))}
          </div>
          <label className="dfn-check">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Show reach and route
          </label>
        </div>
        <PlatformBoard grid={grid} stand={overlay ? map.stand : undefined} trace={trace} missed={overlay ? map.missedCoins : undefined} onPaint={(i) => setLevel((l) => ({ ...l, rows: gridRows(paintTile(parseGrid(l.rows), i, paint)) }))} label={level.name} />
        {issues.length ? (
          <ul className="dfn-issues-list">
            {issues.map((x, i) => (
              <li key={i} className={x.severity}>
                {x.message}
              </li>
            ))}
          </ul>
        ) : map.reachable ? (
          <p className="dfn-verdict won">
            The goal can be reached: {map.jumps} jumps on the shortest route{map.tight ? `, ${map.tight} of them tight (a quarter tile off at take-off and they miss)` : ''}, {map.seconds} s at a run. {map.reachableCoins} of {map.coins} coins can be reached.
            {careful ? (careful.finished ? ` A careful player gets past the enemies${careful.waited ? `, waiting ${careful.waited} s for them` : ''}${careful.stomped ? ` and stomping ${careful.stomped}` : ''}.` : ` But a careful player is caught by an enemy near tile ${careful.x}: give the route some room.`) : ''}
          </p>
        ) : (
          <p className="dfn-verdict lost">The goal can’t be reached from the start with these jumps. The shaded cells show how far the hero can get: bring a ledge closer or lower, or narrow a gap.</p>
        )}
        {map.missedCoins.length && !issues.length ? <p className="dfn-hint">{map.missedCoins.length} coin{map.missedCoins.length === 1 ? ' is' : 's are'} out of reach (drawn faded): too high or too far to jump to.</p> : null}
      </div>
    </div>
  );
};

const FlowTab = ({ game, change, onOpen }: { game: PlatformGame; change: Change; onOpen: (i: number) => void }) => {
  const rows = game.levels.map((l) => ({ l, m: mapLevel(game.rules, l), c: platformIssues(l).length ? null : carefulRun(game.rules, l) }));
  const move = (i: number, by: number) =>
    change((g) => {
      const levels = [...g.levels];
      const [l] = levels.splice(i, 1);
      levels.splice(Math.max(0, Math.min(levels.length, i + by)), 0, l!);
      return { ...g, levels };
    });
  return (
    <div className="dfn-pane">
      <Intro title="Flow">The levels in the order players meet them, with what the studio found in each. Most games build up: a few easy jumps, then more, then tight ones.</Intro>
      <table className="dfn-table blk-order pf-flow">
        <thead>
          <tr>
            <th>#</th>
            <th>Level</th>
            <th>Goal</th>
            <th>Jumps</th>
            <th title="Jumps that miss from a quarter tile off at take-off">Tight</th>
            <th>Route</th>
            <th>Coins in reach</th>
            <th>A careful player</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ l, m, c }, i) => (
            <tr key={l.id} className={m.reachable ? '' : 'leaky'}>
              <td>{i + 1}</td>
              <td>
                <button className="link-btn" onClick={() => onOpen(i)}>
                  {l.name}
                </button>
              </td>
              <td>{m.status === 'not ready' ? 'not ready' : m.reachable ? 'reached' : 'out of reach'}</td>
              <td>{m.reachable ? m.jumps : '–'}</td>
              <td>{m.reachable ? m.tight : '–'}</td>
              <td>{m.reachable ? `${m.seconds} s` : '–'}</td>
              <td>
                {m.reachableCoins}/{m.coins}
              </td>
              <td>{c ? (c.finished ? `finishes, ${c.seconds} s` : m.reachable ? `caught at tile ${c.x}` : '–') : '–'}</td>
              <td>
                <button className="icon-btn small" aria-label={`Move ${l.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn small" aria-label={`Move ${l.name} later`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dfn-hint">The careful player looks ahead and waits for enemies to pass, so where it is caught, players will be too. The route is the shortest the studio found; players will wander and take longer.</p>
    </div>
  );
};
