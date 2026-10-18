import { useEffect, useRef, useState } from 'react';
import { levelIssues, levelRows, newLevel, paintCell, parseLevel, resizeBoard, starterBlocks, updateBlocks, type BlockGame, type Level, type Paint } from '../../model/blocks/blocks';
import { difficulty, replay, solveLevel, type PlayState } from '../../model/blocks/solver';
import type { BlockTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { newId } from '../../model/project';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { BlockBoard } from './BlockBoard';
import { BlockPlay } from './BlockPlay';

const TABS: { id: BlockTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'rules', label: 'Rules' },
  { id: 'levels', label: 'Levels' },
  { id: 'order', label: 'Order and difficulty' },
  { id: 'play', label: 'Play and test' },
];

/**
 * The puzzle game workspace (game modules): one tab a step of its path,
 * concept to play. It starts with five levels that already solve, rising in
 * difficulty, and is refined from there.
 */
export const BlockStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: BlockTab) => void; onCommit: (p: Project) => void }) => {
  const tab: BlockTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.blocks ?? starterBlocks();
  const change = (f: (g: BlockGame) => BlockGame) => onCommit(updateBlocks(project, f));
  const [index, setIndex] = useState(0);
  const at = Math.max(0, Math.min(index, game.levels.length - 1));
  const unsolved = game.levels.filter((l) => solveLevel(l).status !== 'solved').length;
  const issues = unsolved ? [{ severity: 'error', message: `${unsolved} level${unsolved === 1 ? '' : 's'} the studio can’t solve.` }] : [];
  return (
    <div className="dfn-studio">
      <StepTabs label="Puzzle game" tabs={TABS} tab={tab} onTab={onTab} issues={issues} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. A tidy-minded robot puts a flooded warehouse back in order, one room at a time."
            themeHint="e.g. Bright toy-box, chunky shadows"
            notesHint="Ideas for later: ice that slides, keys and doors, worlds of twenty levels…"
          />
        )}
        {tab === 'rules' && <RulesTab game={game} change={change} />}
        {tab === 'levels' && <LevelsTab game={game} change={change} index={at} onIndex={setIndex} />}
        {tab === 'order' && <OrderTab game={game} change={change} onOpen={(i) => (setIndex(i), onTab('levels'))} />}
        {tab === 'play' && <BlockPlay game={game} index={at} onIndex={setIndex} />}
      </section>
    </div>
  );
};

type Change = (f: (g: BlockGame) => BlockGame) => void;

const RulesTab = ({ game, change }: { game: BlockGame; change: Change }) => {
  const set = (patch: Partial<BlockGame['rules']>) => change((g) => ({ ...g, rules: { ...g.rules, ...patch } }));
  const r = game.rules;
  return (
    <div className="dfn-pane narrow">
      <Intro title="Rules">The pieces and how the player is scored. The rules of pushing stay the same: one at a time, never pulled.</Intro>
      <div className="dfn-grid">
        <Text label="A crate is called" value={r.crateWord} placeholder="crate" onCommit={(v) => set({ crateWord: v.trim() || 'crate' })} />
        <Text label="A target is called" value={r.targetWord} placeholder="target" onCommit={(v) => set({ targetWord: v.trim() || 'target' })} />
        <Num label="Two stars within" value={Math.round(r.twoStarSlack * 100)} min={0} max={500} suffix="% over par" onCommit={(v) => set({ twoStarSlack: v / 100 })} />
      </div>
      <label className="dfn-check">
        <input type="checkbox" checked={r.undo} onChange={(e) => set({ undo: e.target.checked })} /> The player can undo moves
      </label>
      <p className="dfn-hint">Three stars at par, two within {Math.round(r.twoStarSlack * 100)}% over it, one for finishing. Par is the fewest moves the studio finds, unless you set one on a level.</p>
    </div>
  );
};

const PAINTS: { id: Paint; label: string }[] = [
  { id: 'wall', label: 'Wall' },
  { id: 'floor', label: 'Floor' },
  { id: 'target', label: 'Target' },
  { id: 'crate', label: 'Crate' },
  { id: 'player', label: 'Player' },
];

const SolverLine = ({ level, crate }: { level: Level; crate: string }) => {
  const s = solveLevel(level);
  if (s.status === 'solved') {
    return (
      <p className="dfn-verdict won">
        Solves in {s.moves} moves ({s.pushes} pushes). Difficulty {difficulty(s)} of 5.
      </p>
    );
  }
  if (s.status === 'unsolvable') return <p className="dfn-verdict lost">Can’t be solved: whatever the player does, a {crate} gets stuck. Open up a corner or move a target.</p>;
  if (s.status === 'too big') return <p className="dfn-verdict lost">Too big for the studio to solve here ({s.explored.toLocaleString()} positions looked at). It may still solve: play it to be sure, or make it smaller.</p>;
  return <p className="dfn-verdict lost">Not ready to solve yet: see what’s missing above.</p>;
};

const LevelsTab = ({ game, change, index, onIndex }: { game: BlockGame; change: Change; index: number; onIndex: (i: number) => void }) => {
  const [paint, setPaint] = useState<Paint>('wall');
  const [showing, setShowing] = useState<PlayState | null>(null);
  const crateMode = useRef<'add' | 'remove'>('add');
  const timer = useRef<ReturnType<typeof setInterval>>();
  const level = game.levels[index];
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    clearInterval(timer.current);
    setShowing(null);
  }, [level?.rows]);
  const setLevel = (f: (l: Level) => Level) => change((g) => ({ ...g, levels: g.levels.map((l, i) => (i === index ? f(l) : l)) }));
  const crate = game.rules.crateWord || 'crate';
  if (!level) {
    return (
      <div className="dfn-pane">
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, levels: [newLevel(1)] }))}>
          + Level
        </button>
      </div>
    );
  }
  const board = parseLevel(level.rows);
  const issues = levelIssues(board);
  const onCell = (i: number, first: boolean) => {
    let p = paint;
    if (paint === 'crate') {
      if (first) crateMode.current = board.crates.includes(i) ? 'remove' : 'add';
      if ((crateMode.current === 'add') === board.crates.includes(i)) return;
      p = 'crate';
    }
    setLevel((l) => ({ ...l, rows: levelRows(paintCell(parseLevel(l.rows), i, p)) }));
  };
  const show = () => {
    const s = solveLevel(level);
    if (s.status !== 'solved') return;
    clearInterval(timer.current);
    let n = 0;
    setShowing(replay(board, ''));
    timer.current = setInterval(() => {
      n++;
      setShowing(replay(board, s.path.slice(0, n)));
      if (n >= s.path.length) clearInterval(timer.current);
    }, 220);
  };
  return (
    <div className="blk-editor">
      <nav className="blk-list" aria-label="Levels">
        {game.levels.map((l, i) => (
          <button key={l.id} className={`dfn-tab${i === index ? ' on' : ''}`} onClick={() => onIndex(i)}>
            <span className="dfn-tab-num">{i + 1}</span> {l.name}
          </button>
        ))}
        <button className="link-btn" onClick={() => (change((g) => ({ ...g, levels: [...g.levels, newLevel(g.levels.length + 1)] })), onIndex(game.levels.length))}>
          + Level
        </button>
      </nav>
      <div className="dfn-pane">
        <Intro title="Levels">Paint the level: pick a piece, then click or drag across cells. Click a {crate} again with Crate picked to take it off. Each level should teach one thing.</Intro>
        <div className="dfn-row">
          <Text label="Name" value={level.name} onCommit={(v) => setLevel((l) => ({ ...l, name: v.trim() || l.name }))} />
          <Num label="Par" value={level.par} min={0} title="Moves for three stars; 0 takes the studio's best" onCommit={(v) => setLevel((l) => ({ ...l, par: v }))} />
          <Num label="Columns" value={board.cols} min={3} max={20} onCommit={(v) => setLevel((l) => ({ ...l, rows: levelRows(resizeBoard(parseLevel(l.rows), v, board.rows)) }))} />
          <Num label="Rows" value={board.rows} min={3} max={20} onCommit={(v) => setLevel((l) => ({ ...l, rows: levelRows(resizeBoard(parseLevel(l.rows), board.cols, v)) }))} />
          <div className="dfn-row tight">
            <button className="icon-btn small" title="Copy" aria-label="Copy level" onClick={() => (change((g) => ({ ...g, levels: [...g.levels.slice(0, index + 1), { ...level, id: newId('lv'), name: `${level.name} (copy)` }, ...g.levels.slice(index + 1)] })), onIndex(index + 1))}>
              ⧉
            </button>
            <button className="icon-btn small" title="Remove" aria-label="Remove level" onClick={() => (change((g) => ({ ...g, levels: g.levels.filter((_, i) => i !== index) })), onIndex(Math.max(0, index - 1)))}>
              ×
            </button>
          </div>
        </div>
        <div className="dfn-seg" role="radiogroup" aria-label="Paint">
          {PAINTS.map((p) => (
            <label key={p.id} className={`tb-btn small${paint === p.id ? ' on' : ''}`}>
              <input type="radio" name="blk-paint" checked={paint === p.id} onChange={() => setPaint(p.id)} />
              <span className={`blk-swatch ${p.id}`} aria-hidden="true" /> {p.id === 'crate' ? crate[0]!.toUpperCase() + crate.slice(1) : p.id === 'target' ? (game.rules.targetWord || 'target')[0]!.toUpperCase() + (game.rules.targetWord || 'target').slice(1) : p.label}
            </label>
          ))}
        </div>
        <div className="blk-stage">
          <BlockBoard board={board} crates={showing?.crates} player={showing?.player} onCell={showing ? undefined : onCell} label={`Level ${index + 1}`} />
          <div className="blk-side">
            {issues.length ? (
              <ul className="dfn-issues-list">
                {issues.map((x, i) => (
                  <li key={i} className={x.severity}>
                    {x.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <SolverLine level={level} crate={crate} />
            {solveLevel(level).status === 'solved' ? (
              <div className="dfn-row">
                <button className="tb-btn" onClick={show}>
                  Show the solution
                </button>
                {showing ? (
                  <button className="tb-btn" onClick={() => (clearInterval(timer.current), setShowing(null))}>
                    Stop
                  </button>
                ) : null}
              </div>
            ) : null}
            <label className="dfn-text">
              <span>As text (paste a level in the standard format)</span>
              <textarea
                key={level.rows.join('\n')}
                className="inp blk-text"
                rows={Math.min(14, board.rows + 1)}
                defaultValue={level.rows.join('\n')}
                spellCheck={false}
                onBlur={(e) => {
                  const rows = e.target.value.replace(/\r/g, '').split('\n').filter((r, i, all) => r.trim() || i < all.length - 1);
                  if (rows.join('\n') !== level.rows.join('\n') && rows.length) setLevel((l) => ({ ...l, rows }));
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

const OrderTab = ({ game, change, onOpen }: { game: BlockGame; change: Change; onOpen: (i: number) => void }) => {
  const rows = game.levels.map((l) => ({ l, s: solveLevel(l) }));
  const move = (i: number, by: number) =>
    change((g) => {
      const levels = [...g.levels];
      const [l] = levels.splice(i, 1);
      levels.splice(Math.max(0, Math.min(levels.length, i + by)), 0, l!);
      return { ...g, levels };
    });
  const notes: string[] = [];
  rows.forEach(({ s }, i) => {
    const prev = i ? difficulty(rows[i - 1]!.s) : 0;
    const d = difficulty(s);
    if (i && d && prev && d - prev >= 2) notes.push(`Level ${i + 1} jumps from difficulty ${prev} to ${d}: a level between them would ease the climb.`);
    if (i && d && prev && prev - d >= 2) notes.push(`Level ${i + 1} is much easier than level ${i}: move it earlier?`);
  });
  return (
    <div className="dfn-pane">
      <Intro title="Order and difficulty">The order players meet the levels. The studio solves each: the fewest moves, the pushes, and a difficulty from 1 to 5. Aim for a climb with the odd breather.</Intro>
      <div className="blk-curve" role="img" aria-label={`Difficulty by level: ${rows.map(({ s }) => difficulty(s)).join(', ')}`}>
        {rows.map(({ l, s }, i) => (
          <div key={l.id} className="crd-bar" title={`${i + 1}. ${l.name}: ${s.status === 'solved' ? `difficulty ${difficulty(s)}` : s.status}`}>
            <span className={s.status === 'solved' ? '' : 'bad'} style={{ height: `${s.status === 'solved' ? difficulty(s) * 20 : 100}%` }} />
            <em>{i + 1}</em>
          </div>
        ))}
      </div>
      {notes.map((n, i) => (
        <p key={i} className="dfn-hint">
          {n}
        </p>
      ))}
      <table className="dfn-table blk-order">
        <thead>
          <tr>
            <th>#</th>
            <th>Level</th>
            <th>Moves</th>
            <th>Pushes</th>
            <th>Difficulty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ l, s }, i) => (
            <tr key={l.id} className={s.status === 'solved' ? '' : 'leaky'}>
              <td>{i + 1}</td>
              <td>
                <button className="link-btn" onClick={() => onOpen(i)}>
                  {l.name}
                </button>
              </td>
              <td>{s.status === 'solved' ? s.moves : '–'}</td>
              <td>{s.status === 'solved' ? s.pushes : '–'}</td>
              <td>{s.status === 'solved' ? `${'●'.repeat(difficulty(s))}${'○'.repeat(5 - difficulty(s))}` : s.status === 'too big' ? 'too big to solve' : s.status === 'unsolvable' ? 'can’t be solved' : 'not ready'}</td>
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
    </div>
  );
};
