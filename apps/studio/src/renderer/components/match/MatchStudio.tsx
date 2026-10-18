import { useMemo, useState } from 'react';
import { GEM_HUES, MAX_COLORS, goalText, levelIssues, newMatchLevel, paintShape, parseShape, resizeShape, shapeRows, starterMatch, updateMatch, type GoalKind, type MatchGame, type MatchLevel, type ShapePaint } from '../../model/match/match';
import { createMatch, levelReport, movesFor } from '../../model/match/sim';
import type { MatchTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { newId } from '../../model/project';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { MatchBoard } from './MatchBoard';
import { MatchPlay } from './MatchPlay';

const TABS: { id: MatchTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'rules', label: 'Rules' },
  { id: 'levels', label: 'Levels' },
  { id: 'balance', label: 'Balance' },
  { id: 'play', label: 'Play and test' },
];

/**
 * The match-3 workspace (game modules): one tab a step of its path, concept
 * to play. It starts with five levels, one of each goal, already balanced to
 * climb, and is refined from there.
 */
export const MatchStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: MatchTab) => void; onCommit: (p: Project) => void }) => {
  const tab: MatchTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.match ?? starterMatch();
  const change = (f: (g: MatchGame) => MatchGame) => onCommit(updateMatch(project, f));
  const [index, setIndex] = useState(0);
  const at = Math.max(0, Math.min(index, game.levels.length - 1));
  const issues = game.levels.flatMap((l, i) => levelIssues(game, l).filter((x) => x.severity === 'error').map((x) => ({ ...x, message: `Level ${i + 1}: ${x.message}` })));
  return (
    <div className="dfn-studio">
      <StepTabs label="Match-3" tabs={TABS} tab={tab} onTab={onTab} issues={issues} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. A jeweller’s apprentice sorts the royal treasury before the coronation."
            themeHint="e.g. Glossy jewels on velvet, warm light"
            notesHint="Ideas for later: boosters, a map of worlds, daily challenges…"
          />
        )}
        {tab === 'rules' && <RulesTab game={game} change={change} />}
        {tab === 'levels' && <LevelsTab game={game} change={change} index={at} onIndex={setIndex} />}
        {tab === 'balance' && <BalanceTab game={game} change={change} onOpen={(i) => (setIndex(i), onTab('levels'))} />}
        {tab === 'play' && <MatchPlay game={game} index={at} onIndex={setIndex} />}
      </section>
    </div>
  );
};

type Change = (f: (g: MatchGame) => MatchGame) => void;

const RulesTab = ({ game, change }: { game: MatchGame; change: Change }) => {
  const set = (patch: Partial<MatchGame['rules']>) => change((g) => ({ ...g, rules: { ...g.rules, ...patch } }));
  const r = game.rules;
  return (
    <div className="dfn-pane narrow">
      <Intro title="Rules">What the gems are and how matches score. A level uses the first so many gems, in this order.</Intro>
      <div className="m3-gemnames">
        {Array.from({ length: MAX_COLORS }, (_, i) => (
          <div key={i} className="dfn-row tight">
            <span className="m3-swatch" style={{ background: GEM_HUES[i] }} aria-hidden="true" />
            <Text label={`Gem ${i + 1}`} value={r.gems[i] ?? ''} placeholder={`Gem ${i + 1}`} onCommit={(v) => set({ gems: Array.from({ length: MAX_COLORS }, (_, k) => (k === i ? v.trim() || `Gem ${i + 1}` : r.gems[k] ?? `Gem ${k + 1}`)) })} />
          </div>
        ))}
      </div>
      <div className="dfn-grid">
        <Num label="Points a gem" value={r.points} min={1} onCommit={(v) => set({ points: v })} />
        <Num label="Chain bonus" value={Math.round(r.chainBonus * 100)} min={0} max={500} suffix="% a step" title="Each step of a chain scores this much more" onCommit={(v) => set({ chainBonus: v / 100 })} />
        <Num label="Two stars at" value={r.starSteps[0]} min={1} step={0.1} suffix="× goal" onCommit={(v) => set({ starSteps: [v, Math.max(v, r.starSteps[1])] })} />
        <Num label="Three stars at" value={r.starSteps[1]} min={1} step={0.1} suffix="× goal" onCommit={(v) => set({ starSteps: [Math.min(v, r.starSteps[0]), v] })} />
      </div>
      <label className="dfn-check">
        <input type="checkbox" checked={r.specials} onChange={(e) => set({ specials: e.target.checked })} /> Special gems: four in a line makes a line gem, five (or an L or T) a bomb
      </label>
    </div>
  );
};

const PAINTS: { id: ShapePaint; label: string }[] = [
  { id: 'cell', label: 'Cell' },
  { id: 'hole', label: 'No cell' },
  { id: 'jelly', label: 'Jelly' },
];

const LevelsTab = ({ game, change, index, onIndex }: { game: MatchGame; change: Change; index: number; onIndex: (i: number) => void }) => {
  const [paint, setPaint] = useState<ShapePaint>('hole');
  const [preview, setPreview] = useState(false);
  const level = game.levels[index];
  const setLevel = (f: (l: MatchLevel) => MatchLevel) => change((g) => ({ ...g, levels: g.levels.map((l, i) => (i === index ? f(l) : l)) }));
  if (!level) {
    return (
      <div className="dfn-pane">
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, levels: [newMatchLevel(1)] }))}>
          + Level
        </button>
      </div>
    );
  }
  const shape = parseShape(level.rows);
  const issues = levelIssues(game, level);
  const filled = preview ? createMatch(game, level, 1) : null;
  const setGoal = (patch: Partial<MatchLevel['goal']>) => setLevel((l) => ({ ...l, goal: { ...l.goal, ...patch } }));
  return (
    <div className="blk-editor">
      <nav className="blk-list" aria-label="Levels">
        {game.levels.map((l, i) => (
          <button key={l.id} className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
            <span className="dfn-tab-num">{i + 1}</span> {l.name}
          </button>
        ))}
        <button className="link-btn" onClick={() => (change((g) => ({ ...g, levels: [...g.levels, newMatchLevel(g.levels.length + 1)] })), onIndex(game.levels.length))}>
          + Level
        </button>
      </nav>
      <div className="dfn-pane">
        <Intro title="Levels">The board’s shape, how many colours fall, the move limit and the goal. Fewer colours make more matches: easier. Shapes with holes make fewer: harder.</Intro>
        <div className="dfn-row">
          <Text label="Name" value={level.name} onCommit={(v) => setLevel((l) => ({ ...l, name: v.trim() || l.name }))} />
          <Num label="Colours" value={level.colors} min={3} max={Math.min(MAX_COLORS, game.rules.gems.length)} onCommit={(v) => setLevel((l) => ({ ...l, colors: v }))} />
          <Num label="Moves" value={level.moves} min={1} onCommit={(v) => setLevel((l) => ({ ...l, moves: v }))} />
          <div className="dfn-row tight">
            <button className="icon-btn small" title="Copy" aria-label="Copy level" onClick={() => (change((g) => ({ ...g, levels: [...g.levels.slice(0, index + 1), { ...level, id: newId('ml'), name: `${level.name} (copy)` }, ...g.levels.slice(index + 1)] })), onIndex(index + 1))}>
              ⧉
            </button>
            <button className="icon-btn small" title="Remove" aria-label="Remove level" onClick={() => (change((g) => ({ ...g, levels: g.levels.filter((_, i) => i !== index) })), onIndex(Math.max(0, index - 1)))}>
              ×
            </button>
          </div>
        </div>
        <div className="dfn-row">
          <label className="dfn-text">
            <span>Goal</span>
            <select className="inp small" value={level.goal.kind} aria-label="Goal" onChange={(e) => setGoal({ kind: e.target.value as GoalKind, amount: e.target.value === 'score' ? 2000 : e.target.value === 'collect' ? 20 : 0 })}>
              <option value="score">Reach a score</option>
              <option value="collect">Collect gems of a colour</option>
              <option value="jelly">Clear all the jelly</option>
            </select>
          </label>
          {level.goal.kind !== 'jelly' ? <Num label={level.goal.kind === 'score' ? 'Score' : 'How many'} value={level.goal.amount} min={1} step={level.goal.kind === 'score' ? 100 : 1} onCommit={(v) => setGoal({ amount: v })} /> : null}
          {level.goal.kind === 'collect' ? (
            <label className="dfn-text">
              <span>Colour</span>
              <select className="inp small" value={level.goal.color} aria-label="Colour to collect" onChange={(e) => setGoal({ color: Number(e.target.value) })}>
                {game.rules.gems.slice(0, level.colors).map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="dfn-row">
          <div className="dfn-seg" role="radiogroup" aria-label="Paint">
            {PAINTS.map((p) => (
              <label key={p.id} className={`tb-btn small${paint === p.id ? ' on' : ''}`}>
                <input type="radio" name="m3-paint" checked={paint === p.id} onChange={() => (setPaint(p.id), setPreview(false))} />
                {p.label}
              </label>
            ))}
          </div>
          <Num label="Columns" value={shape.cols} min={4} max={10} onCommit={(v) => setLevel((l) => ({ ...l, rows: shapeRows(resizeShape(parseShape(l.rows), v, shape.rows)) }))} />
          <Num label="Rows" value={shape.rows} min={4} max={10} onCommit={(v) => setLevel((l) => ({ ...l, rows: shapeRows(resizeShape(parseShape(l.rows), shape.cols, v)) }))} />
          <label className="dfn-check">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Show it filled
          </label>
        </div>
        <div className="blk-stage">
          <MatchBoard shape={shape} gems={filled?.gems} onPaint={preview ? undefined : (i) => setLevel((l) => ({ ...l, rows: shapeRows(paintShape(parseShape(l.rows), i, paint)) }))} label={`Level ${index + 1} shape`} />
          <div className="blk-side">
            <p className="dfn-hint">
              {goalText(game, level)} in {level.moves} moves, {level.colors} colours, {shape.cell.filter(Boolean).length} cells{shape.jelly.some(Boolean) ? `, ${shape.jelly.filter(Boolean).length} with jelly` : ''}.
            </p>
            {issues.length ? (
              <ul className="dfn-issues-list">
                {issues.map((x, i) => (
                  <li key={i} className={x.severity}>
                    {x.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dfn-hint">See how often the studio beats it on Balance.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const BalanceTab = ({ game, change, onOpen }: { game: MatchGame; change: Change; onOpen: (i: number) => void }) => {
  const [aim, setAim] = useState(70);
  const reports = useMemo(() => game.levels.map((l) => (levelIssues(game, l).some((x) => x.severity === 'error') ? null : levelReport(game, l))), [game]);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="dfn-pane">
      <Intro title="Balance">
        The studio’s player, a steady one that takes the biggest match it sees, plays each level 40 times on different boards. How often it beats the level within its moves is a guide to how hard players will find it.
      </Intro>
      <div className="dfn-row">
        <Num label="Aim for the studio winning" value={aim} min={5} max={100} step={5} suffix="%" onCommit={setAim} />
        <span className="dfn-hint">A gentle climb is 90% for the first levels, settling to 50–70%.</span>
      </div>
      <div className="blk-curve" role="img" aria-label={`Studio win rate by level: ${reports.map((r) => (r ? pct(r.winRate) : 'not ready')).join(', ')}`}>
        {reports.map((r, i) => (
          <div key={game.levels[i]!.id} className="crd-bar" title={`${i + 1}. ${game.levels[i]!.name}: ${r ? pct(r.winRate) : 'not ready'}`}>
            <span className={r ? '' : 'bad'} style={{ height: `${r ? Math.max(2, r.winRate * 100) : 100}%` }} />
            <em>{i + 1}</em>
          </div>
        ))}
      </div>
      <table className="dfn-table blk-order m3-balance">
        <thead>
          <tr>
            <th>#</th>
            <th>Level</th>
            <th>Goal</th>
            <th>Moves</th>
            <th title="Of 40 runs, beaten within the move limit">Studio wins</th>
            <th title="Moves the studio needed: the middle run, and 4 in 5 runs">Needed</th>
            <th title={`The move limit at which the studio wins about ${aim}%`}>For {aim}%</th>
          </tr>
        </thead>
        <tbody>
          {game.levels.map((l, i) => {
            const r = reports[i];
            const suggest = r ? movesFor(r, aim / 100) : null;
            return (
              <tr key={l.id} className={r && (r.winRate < 0.3 || r.finished < 0.9) ? 'leaky' : ''}>
                <td>{i + 1}</td>
                <td>
                  <button className="link-btn" onClick={() => onOpen(i)}>
                    {l.name}
                  </button>
                </td>
                <td>{goalText(game, l)}</td>
                <td>{l.moves}</td>
                <td>{r ? pct(r.winRate) : 'not ready'}</td>
                <td>{r ? `${r.median ?? '–'} · ${r.p80 ?? '–'}` : '–'}</td>
                <td>
                  {suggest === null ? (
                    r ? 'out of reach' : '–'
                  ) : suggest === l.moves ? (
                    <span className="muted">{suggest} ✓</span>
                  ) : (
                    <button className="tb-btn small" onClick={() => change((g) => ({ ...g, levels: g.levels.map((x) => (x.id === l.id ? { ...x, moves: suggest } : x)) }))}>
                      Use {suggest}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dfn-hint">Needed is the moves the studio took to meet the goal: on its middle run, and on 4 runs in 5. Players who plan ahead will do better than it; new players, worse.</p>
    </div>
  );
};
