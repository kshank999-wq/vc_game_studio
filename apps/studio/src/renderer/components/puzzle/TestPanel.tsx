import { useMemo, useState } from 'react';
import { statesOf } from '../../model/details';
import { flatten, nodesOf } from '../../model/puzzle/design';
import { elementsOf } from '../../model/puzzle/elements';
import { actionsNow, canSolve, solveIssues, stepNow, testWorld, type Solution } from '../../model/puzzle/solve';
import { settleWorld, type PlayWorld } from '../../model/play';
import type { Project } from '../../model/types';

interface Props {
  project: Project;
  puzzleId: string;
  onSelectNode: (id: string) => void;
}

const MARK = { done: '✓', open: '○', locked: '·' } as const;

/**
 * Validation and test mode (puzzle spec §13): "Can the player solve this?",
 * and a test the designer drives — mark clues and items found, set states,
 * and watch which actions open up and which steps get done.
 */
export const TestTab = ({ project, puzzleId, onSelectNode }: Props) => {
  const [world, setWorld] = useState<PlayWorld>(() => testWorld(project));
  const [log, setLog] = useState<string[]>([]);
  const [solution, setSolution] = useState<{ s: Solution; from: 'start' | 'here' } | null>(null);
  const puzzle = project.objects[puzzleId];
  const nodes = nodesOf(puzzle);
  const elements = elementsOf(project, puzzleId);
  const scenes = useMemo(() => {
    const ids = new Set<string>();
    JSON.stringify(nodes, (_k, v) => (v && typeof v === 'object' && v.kind === 'visited' && typeof v.ref === 'string' ? (ids.add(v.ref), v) : v));
    return [...ids].map((id) => project.objects[id]).filter((o) => o?.type === 'scene');
  }, [nodes, project]);
  const actions = actionsNow(project, puzzleId, world);
  const solved = !!world.solved[puzzleId];

  const move = (next: PlayWorld, what: string) => {
    const before = world;
    const done = flatten(nodes)
      .filter(({ node }) => stepNow(project, puzzleId, before, node.id) !== 'done' && stepNow(project, puzzleId, next, node.id) === 'done')
      .map(({ node }) => node.label);
    setWorld(next);
    setLog((l) => [...l, what, ...done.map((d) => `  ✓ ${d}`), ...(next.solved[puzzleId] && !before.solved[puzzleId] ? ['  ★ Solved'] : [])]);
  };
  const mark = (patch: Partial<PlayWorld>, what: string) => move(settleWorld(project, { ...world, ...patch }).world, what);

  return (
    <div className="pz-test">
      <section className="pz-sec">
        <div className="pz-row">
          <button className="tb-btn" onClick={() => setSolution({ s: canSolve(project, puzzleId), from: 'start' })}>
            Can the player solve this?
          </button>
          <button className="tb-btn small" onClick={() => setSolution({ s: canSolve(project, puzzleId, world), from: 'here' })}>
            From this test’s state
          </button>
        </div>
        {solution && (
          <div className={`pz-solve ${solution.s.solvable ? 'yes' : 'no'}`} role="status" aria-label="Solvability">
            <strong>
              {solution.s.solvable ? `✓ Yes: in ${solution.s.path.length} action${solution.s.path.length === 1 ? '' : 's'}` : '✗ No way found'}
              {solution.from === 'here' ? ', from here' : ', from the start'}
            </strong>
            {solution.s.solvable && (
              <ol className="pz-path">
                {solution.s.path.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
            )}
            <ul className="pz-issues">
              {solveIssues(project, puzzleId, solution.s).map((i, n) => (
                <li key={n}>
                  <button className={`pz-issue ${i.severity}`} onClick={() => i.nodeId && onSelectNode(i.nodeId)}>
                    {i.severity === 'error' ? '●' : '○'} {i.message}
                  </button>
                </li>
              ))}
            </ul>
            <span className="pref-hint">Looked at {solution.s.explored} situations: what each interaction, pickup and clue in the levels allows.</span>
          </div>
        )}
      </section>

      <div className="pz-test-split">
        <section className="pz-sec">
          <span className="pz-label">Mark as found</span>
          {elements.map((e) =>
            e.type === 'inventory' ? (
              <label key={e.id} className="lvl-toggle">
                <input type="checkbox" checked={(world.items[e.id] ?? 0) > 0} onChange={(ev) => mark({ items: { ...world.items, [e.id]: ev.target.checked ? 1 : 0 } }, `${ev.target.checked ? 'Carry' : 'Drop'} ${e.name}`)} /> {e.name} carried
              </label>
            ) : e.type === 'lore' ? (
              <label key={e.id} className="lvl-toggle">
                <input type="checkbox" checked={!!world.lore[e.id]} onChange={(ev) => mark({ lore: { ...world.lore, [e.id]: ev.target.checked } }, `${ev.target.checked ? 'Know' : 'Forget'} ${e.name}`)} /> {e.name} known
              </label>
            ) : e.type === 'state' || (e.type === 'object' && statesOf(e).length) ? (
              <label key={e.id} className="pz-field">
                <span className="pz-label">{e.name}</span>
                <select
                  className="inp small"
                  aria-label={`${e.name} is`}
                  value={(e.type === 'state' ? world.flags[e.id] : world.objects[e.id]) ?? ''}
                  onChange={(ev) => mark(e.type === 'state' ? { flags: { ...world.flags, [e.id]: ev.target.value } } : { objects: { ...world.objects, [e.id]: ev.target.value } }, `Set ${e.name} to ${ev.target.value}`)}
                >
                  {statesOf(e).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ) : null,
          )}
          {scenes.map((sc) => (
            <label key={sc!.id} className="lvl-toggle">
              <input type="checkbox" checked={!!world.visited[sc!.id]} onChange={(ev) => mark({ visited: { ...world.visited, [sc!.id]: ev.target.checked } }, `${ev.target.checked ? 'Reach' : 'Not yet at'} ${sc!.name}`)} /> {sc!.name} reached
            </label>
          ))}
          <button
            className="tb-btn small"
            onClick={() => {
              setWorld(testWorld(project));
              setLog([]);
            }}
          >
            Start the test again
          </button>
        </section>

        <section className="pz-sec">
          <span className="pz-label">What the player can do now</span>
          {actions.length ? (
            <div className="pz-actions" role="group" aria-label="Player actions">
              {actions.map((a) => (
                <button key={a.id} className="tb-btn small" onClick={() => move(a.run(world), `▸ ${a.label}`)}>
                  {a.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="lvl-hint">Nothing: mark something found, or this is as far as the player gets.</p>
          )}
          <span className="pz-label">Its steps</span>
          <ul className="pz-step-states" aria-label="Step states">
            {flatten(nodes).map(({ node, depth }) => {
              const st = stepNow(project, puzzleId, world, node.id);
              return (
                <li key={node.id} className={st} style={{ paddingLeft: depth * 14 }}>
                  <button className="lvl-link-go inline" onClick={() => onSelectNode(node.id)}>
                    {MARK[st]} {node.label}
                  </button>
                  <span className="muted"> {st === 'done' ? 'done' : st === 'open' ? 'can be done' : 'waits'}</span>
                </li>
              );
            })}
          </ul>
          <p className={`pz-solved-flag${solved ? ' yes' : ''}`}>{solved ? '★ Solved' : 'Not solved yet'}</p>
        </section>

        <section className="pz-sec">
          <span className="pz-label">Test log</span>
          <pre className="pz-test-log" aria-label="Test log">
            {log.length ? log.join('\n') : 'What you mark and do shows here.'}
          </pre>
        </section>
      </div>
    </div>
  );
};
