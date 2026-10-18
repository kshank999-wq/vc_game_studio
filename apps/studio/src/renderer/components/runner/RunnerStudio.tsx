import { useMemo, useState } from 'react';
import { chunkLength, newChunk, paintChunk, resizeChunk, runnerIssues, speedAt, speedRange, starterRunner, updateRunner, type Chunk, type ChunkPaint, type RunnerGame } from '../../model/runner/runner';
import { chunkReport, runReport, wayThrough } from '../../model/runner/sim';
import type { RunnerTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { newId } from '../../model/project';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { ChunkStrip } from './ChunkStrip';
import { RunnerPlay } from './RunnerPlay';

const TABS: { id: RunnerTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'runner', label: 'The runner' },
  { id: 'chunks', label: 'Chunks' },
  { id: 'mix', label: 'Mix and pace' },
  { id: 'play', label: 'Play and test' },
];

/**
 * The runner workspace (game modules): one tab a step of its path, concept
 * to play. It starts with eight chunks across three tiers, each checked to
 * be passable, and is refined from there.
 */
export const RunnerStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: RunnerTab) => void; onCommit: (p: Project) => void }) => {
  const tab: RunnerTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.runner ?? starterRunner();
  const change = (f: (g: RunnerGame) => RunnerGame) => onCommit(updateRunner(project, f));
  const [index, setIndex] = useState(0);
  const at = Math.max(0, Math.min(index, game.chunks.length - 1));
  return (
    <div className="dfn-studio">
      <StepTabs label="Runner" tabs={TABS} tab={tab} onTab={onTab} issues={runnerIssues(game)} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. A courier fox races across the rooftops before the storm breaks."
            themeHint="e.g. Dusky city skyline, bold silhouettes"
            notesHint="Ideas for later: power-ups, a magnet for coins, characters to unlock…"
          />
        )}
        {tab === 'runner' && <RunnerTabPane game={game} change={change} />}
        {tab === 'chunks' && <ChunksTab game={game} change={change} index={at} onIndex={setIndex} />}
        {tab === 'mix' && <MixTab game={game} change={change} onOpen={(i) => (setIndex(i), onTab('chunks'))} />}
        {tab === 'play' && <RunnerPlay game={game} />}
      </section>
    </div>
  );
};

type Change = (f: (g: RunnerGame) => RunnerGame) => void;

const RunnerTabPane = ({ game, change }: { game: RunnerGame; change: Change }) => {
  const p = game.rules.physics;
  const set = (patch: Partial<RunnerGame['rules']['physics']>) => change((g) => ({ ...g, rules: { ...g.rules, physics: { ...g.rules.physics, ...patch } } }));
  const apex = (p.jumpSpeed * p.jumpSpeed) / (2 * Math.max(0.1, p.gravity));
  const air = (2 * p.jumpSpeed) / Math.max(0.1, p.gravity);
  const top = (p.maxSpeed - p.startSpeed) / Math.max(0.001, p.speedUp) * 100;
  return (
    <div className="dfn-pane narrow">
      <Intro title="The runner">How the run feels: how fast it starts and gets, how high and far a jump carries, how long a slide lasts. The cells of the track are a unit square.</Intro>
      <div className="dfn-grid">
        <Num label="Start speed" value={p.startSpeed} min={1} step={0.5} suffix="units/s" onCommit={(v) => set({ startSpeed: v })} />
        <Num label="Faster by" value={p.speedUp} min={0} step={0.05} suffix="each 100 units" onCommit={(v) => set({ speedUp: v })} />
        <Num label="Top speed" value={p.maxSpeed} min={1} step={0.5} suffix="units/s" onCommit={(v) => set({ maxSpeed: v })} />
        <Num label="Jump speed" value={p.jumpSpeed} min={1} step={0.5} suffix="units/s" onCommit={(v) => set({ jumpSpeed: v })} />
        <Num label="Gravity" value={p.gravity} min={1} step={1} suffix="units/s²" onCommit={(v) => set({ gravity: v })} />
        <Num label="Slide lasts" value={p.slideTime} min={0.1} step={0.05} suffix="s" onCommit={(v) => set({ slideTime: v })} />
        <Num label="A player’s timing" value={game.rules.timingMs} min={0} max={300} step={10} suffix="± ms" title="How far off a typical player's timing is; the studio's runner plays with it" onCommit={(v) => change((g) => ({ ...g, rules: { ...g.rules, timingMs: v } }))} />
      </div>
      <p className="dfn-hint">
        A jump rises {apex.toFixed(2)} units (the player stands {1.6} tall, so {apex > 2 ? 'it clears a wall two cells high' : apex > 1 ? 'it clears one cell, not two' : 'it doesn’t clear a cell'}) and stays up {air.toFixed(2)} s: {(air * p.startSpeed).toFixed(1)} units at the start, {(air * p.maxSpeed).toFixed(1)} at top speed. A slide covers {(p.slideTime * p.startSpeed).toFixed(1)} to {(p.slideTime * p.maxSpeed).toFixed(1)} units. Top speed is reached {Number.isFinite(top) ? `${Math.round(top)} units in` : 'never'}.
      </p>
    </div>
  );
};

const PAINTS: { id: ChunkPaint; label: string }[] = [
  { id: 'solid', label: 'Block' },
  { id: 'coin', label: 'Coin' },
  { id: 'empty', label: 'Clear' },
  { id: 'pit', label: 'Pit' },
  { id: 'ground', label: 'Ground' },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

const ChunksTab = ({ game, change, index, onIndex }: { game: RunnerGame; change: Change; index: number; onIndex: (i: number) => void }) => {
  const [paint, setPaint] = useState<ChunkPaint>('solid');
  const [showWay, setShowWay] = useState(true);
  const c = game.chunks[index];
  const setChunk = (f: (c: Chunk) => Chunk) => change((g) => ({ ...g, chunks: g.chunks.map((x, i) => (i === index ? f(x) : x)) }));
  const report = useMemo(() => (c ? chunkReport(game, c) : null), [game, c]);
  const way = useMemo(() => (c && showWay ? wayThrough(game.rules, c, speedRange(game.rules, c.tier)[0]) : null), [game.rules, c, showWay]);
  if (!c || !report) {
    return (
      <div className="dfn-pane">
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, chunks: [newChunk(1)] }))}>
          + Chunk
        </button>
      </div>
    );
  }
  const onPaint = (x: number, h: number) => {
    const p: ChunkPaint = h < 0 ? (paint === 'pit' || paint === 'empty' ? 'pit' : 'ground') : paint === 'pit' || paint === 'ground' ? 'empty' : paint;
    setChunk((ch) => paintChunk(ch, x, h, p));
  };
  return (
    <div className="blk-editor">
      <nav className="blk-list" aria-label="Chunks">
        {game.chunks.map((ch, i) => (
          <button key={ch.id} className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
            <span className="dfn-tab-num">{ch.tier}</span> {ch.name}
          </button>
        ))}
        <button className="link-btn" onClick={() => (change((g) => ({ ...g, chunks: [...g.chunks, newChunk(g.chunks.length + 1)] })), onIndex(game.chunks.length))}>
          + Chunk
        </button>
      </nav>
      <div className="dfn-pane">
        <Intro title="Chunks">A short stretch of track the run strings together. Paint blocks and coins at four heights, pits in the ground. A chunk joins the run at its tier, at the speed the run has reached.</Intro>
        <div className="dfn-row">
          <Text label="Name" value={c.name} onCommit={(v) => setChunk((x) => ({ ...x, name: v.trim() || x.name }))} />
          <Num label="Tier" value={c.tier} min={1} max={3} onCommit={(v) => setChunk((x) => ({ ...x, tier: v }))} />
          <Num label="Length" value={chunkLength(c)} min={6} max={40} suffix="units" onCommit={(v) => setChunk((x) => resizeChunk(x, v))} />
          <div className="dfn-row tight">
            <button className="icon-btn small" title="Copy" aria-label="Copy chunk" onClick={() => (change((g) => ({ ...g, chunks: [...g.chunks.slice(0, index + 1), { ...c, id: newId('ch'), name: `${c.name} (copy)` }, ...g.chunks.slice(index + 1)] })), onIndex(index + 1))}>
              ⧉
            </button>
            <button className="icon-btn small" title="Remove" aria-label="Remove chunk" onClick={() => (change((g) => ({ ...g, chunks: g.chunks.filter((_, i) => i !== index) })), onIndex(Math.max(0, index - 1)))}>
              ×
            </button>
          </div>
        </div>
        <div className="dfn-row">
          <div className="dfn-seg" role="radiogroup" aria-label="Paint">
            {PAINTS.map((p) => (
              <label key={p.id} className={`tb-btn small${paint === p.id ? ' on' : ''}`}>
                <input type="radio" name="run-paint" checked={paint === p.id} onChange={() => setPaint(p.id)} />
                {p.label}
              </label>
            ))}
          </div>
          <label className="dfn-check">
            <input type="checkbox" checked={showWay} onChange={(e) => setShowWay(e.target.checked)} /> Show a way through
          </label>
        </div>
        <ChunkStrip chunk={c} way={way} onPaint={onPaint} label={c.name} />
        <div className="run-report">
          {report.slow && report.fast ? (
            <p className="dfn-verdict won">
              Can be got through from {report.speeds[0].toFixed(1)} to {report.speeds[1].toFixed(1)} units/s. A player off by ±{game.rules.timingMs} ms makes it {pct(report.slowRate)} of the time at the slowest, {pct(report.fastRate)} at the fastest.
            </p>
          ) : (
            <p className="dfn-verdict lost">
              Can’t be got through at {!report.slow && !report.fast ? 'any speed it comes at' : !report.slow ? `its slowest (${report.speeds[0].toFixed(1)} units/s): a gap too wide, or a jump that can’t clear in time` : `top speed (${report.speeds[1].toFixed(1)} units/s): things too close for a jump or slide to fit between`}. Move things apart, or change its tier.
            </p>
          )}
          {report.slow && report.fast && Math.min(report.slowRate, report.fastRate) < 0.5 ? <p className="dfn-hint">Tight: the timing window at the {report.slowRate < report.fastRate ? 'slowest' : 'fastest'} is narrower than most players can hit. Fine for a late tier; give a little more room for an early one.</p> : null}
        </div>
      </div>
    </div>
  );
};

const MixTab = ({ game, change, onOpen }: { game: RunnerGame; change: Change; onOpen: (i: number) => void }) => {
  const r = game.rules;
  const report = useMemo(() => runReport(game), [game]);
  const sorted = [...report.distances].sort((a, b) => a - b);
  const most = Math.max(1, ...report.endedIn);
  return (
    <div className="dfn-pane">
      <Intro title="Mix and pace">When the harder tiers join the run, and how often each chunk comes up. The studio’s runner runs {report.runs} endless runs to 1,500 units and says how far it gets and where runs end.</Intro>
      <div className="dfn-grid">
        <Num label="Tier 2 joins at" value={r.tierAt[0]} min={0} step={50} suffix="units" onCommit={(v) => change((g) => ({ ...g, rules: { ...g.rules, tierAt: [v, Math.max(v, g.rules.tierAt[1])] } }))} />
        <Num label="Tier 3 joins at" value={r.tierAt[1]} min={0} step={50} suffix="units" onCommit={(v) => change((g) => ({ ...g, rules: { ...g.rules, tierAt: [Math.min(v, g.rules.tierAt[0]), v] } }))} />
        <Num label="A coin is worth" value={r.coinValue} min={0} suffix="points" onCommit={(v) => change((g) => ({ ...g, rules: { ...g.rules, coinValue: v } }))} />
      </div>
      <p className="dfn-hint">
        Speed there: {speedAt(r.physics, 0).toFixed(1)} at the start, {speedAt(r.physics, r.tierAt[0]).toFixed(1)} when tier 2 joins, {speedAt(r.physics, r.tierAt[1]).toFixed(1)} when tier 3 joins.
      </p>
      <p className={`dfn-verdict ${report.median >= 300 ? 'won' : 'lost'}`}>
        The studio’s runner gets {report.median.toLocaleString()} units on its middle run (shortest {sorted[0]?.toLocaleString()}, longest {sorted[sorted.length - 1]?.toLocaleString()}){report.finished ? `; ${report.finished} of ${report.runs} runs reached 1,500` : ''}, picking up about {report.coins} coins.
      </p>
      <table className="dfn-table blk-order run-mix">
        <thead>
          <tr>
            <th>Tier</th>
            <th>Chunk</th>
            <th title="How often it comes up against others of its tier">Weight</th>
            <th>Runs that ended here</th>
          </tr>
        </thead>
        <tbody>
          {game.chunks.map((c, i) => (
            <tr key={c.id}>
              <td>{c.tier}</td>
              <td>
                <button className="link-btn" onClick={() => onOpen(i)}>
                  {c.name}
                </button>
              </td>
              <td>
                <Num label={`${c.name} weight`} value={c.weight} min={0} step={0.5} onCommit={(v) => change((g) => ({ ...g, chunks: g.chunks.map((x) => (x.id === c.id ? { ...x, weight: v } : x)) }))} />
              </td>
              <td>
                <span className="run-bar">
                  <span style={{ width: `${(100 * report.endedIn[i]!) / most}%` }} />
                </span>{' '}
                {report.endedIn[i]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dfn-hint">Endless runs have to end somewhere. Where they end should be the late, fast tiers, and spread over a few chunks rather than one.</p>
      <p className="dfn-hint">A chunk every player gets through on its own (see Chunks) can still end runs where it meets the next: something near its end, then something near the next one’s start, leaves no room. Keep the first and last few units of a chunk clear, or check the ones that end runs.</p>
    </div>
  );
};
