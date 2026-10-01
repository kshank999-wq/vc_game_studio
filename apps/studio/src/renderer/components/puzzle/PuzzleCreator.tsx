import { useEffect, useMemo, useState } from 'react';
import { levelsOf } from '../../model/level/level';
import { partsOfItem, roleOf } from '../../model/level/puzzles';
import {
  addNode,
  addRequire,
  childrenOf,
  descendantsOf,
  createPuzzle,
  definitionOf,
  flatten,
  makeElementFor,
  MAKES,
  moveNode,
  nestNode,
  NODE_KINDS,
  nodesOf,
  nodeWhenText,
  outdentNode,
  puzzleIssues,
  puzzles,
  removeNode,
  removeRequire,
  reorderNode,
  RESETS,
  SCALES,
  setTreeDrives,
  stepsFromWriting,
  treeDrives,
  updateDefinition,
  updateNode,
  type NodeKind,
  type PuzzleDefinition,
  type PuzzleNode,
  type PuzzleScale,
} from '../../model/puzzle/design';
import { describeRule, type Effect, type Rule } from '../../model/rules';
import { setValue } from '../../model/details';
import type { Project } from '../../model/types';
import { ConditionEditor, EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import { badgesOf } from './badges';
import { PuzzleGraph } from './PuzzleGraph';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  /** Open a puzzle (or anything) in the Bible. */
  onOpenBible: (id?: string) => void;
  /** Open the Level Designer on an item. */
  onOpenLevels?: (itemId?: string) => void;
  onSay: (text: string) => void;
  /** The puzzle to open on. */
  focus?: string;
}

const KIND_MARK: Record<NodeKind, string> = { goal: '◆', requirement: '●', interaction: '▸' };

/** A text field that commits when you leave it, so a paragraph is one undo step. */
const Field = ({ label, value, onCommit, multiline, rows = 3, placeholder, hint }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; rows?: number; placeholder?: string; hint?: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="pz-field">
      <span className="pz-label">{label}</span>
      {multiline ? (
        <textarea className="inp" aria-label={label} rows={rows} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input className="inp" aria-label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      )}
      {hint && <span className="pref-hint">{hint}</span>}
    </label>
  );
};

/**
 * The Puzzle Creator (docs/specs/puzzle-creator-spec.md): write a puzzle in
 * plain words first (§2), define it (§4), then build it into a hierarchy of
 * sub-goals, requirements and interactions (§5) that decides when it is
 * solved. Left: the puzzles and the open one's steps. Centre: writing, or the
 * steps. Right: what is selected. Below: what stops it being solved.
 */
export const PuzzleCreator = ({ project, onCommit, onOpenBible, onOpenLevels, onSay, focus }: Props) => {
  const all = puzzles(project);
  const [selected, setSelected] = useState<string | null>(() => (focus && project.objects[focus]?.type === 'puzzle' ? focus : (all[0]?.id ?? null)));
  const [node, setNode] = useState<string | null>(null);
  const [tab, setTab] = useState<'writing' | 'steps' | 'graph'>(() => (focus && nodesOf(project.objects[focus]).length ? 'steps' : 'writing'));
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newScale, setNewScale] = useState<PuzzleScale>('area');
  const puzzle = selected ? project.objects[selected] : undefined;
  const current = puzzle?.type === 'puzzle' ? puzzle : undefined;
  const nodes = nodesOf(current);
  const picked = node ? nodes.find((n) => n.id === node) : undefined;
  const def = definitionOf(current);
  const issues = useMemo(() => (current ? puzzleIssues(project, current.id) : []), [project, current]);
  const q = query.trim().toLowerCase();
  const shown = all.filter((p) => !q || `${p.data.code ?? ''} ${p.name} ${definitionOf(p).objective}`.toLowerCase().includes(q));

  // Where it is in the levels: items bound to it or read as its parts (Level Designer V2 §14).
  const places = useMemo(() => {
    if (!current) return [];
    const set = levelsOf(project);
    return set.items.flatMap((i) => {
      const parts = partsOfItem(project, current.id, i);
      return parts.length ? [{ item: i, level: set.levels.find((l) => l.id === i.levelId)?.name ?? '', roles: parts.map((p) => p.role) }] : [];
    });
  }, [project, current]);

  if (selected && !current && all[0]) setSelected(all[0].id);

  const create = () => {
    const made = createPuzzle(project, newName || 'New puzzle', newScale);
    onCommit(made.project);
    setSelected(made.id);
    setNode(null);
    setTab('writing');
    setNewName('');
    onSay(`${newName.trim() || 'New puzzle'} made. Describe it in plain words first.`);
  };

  const def1 = (patch: Partial<PuzzleDefinition>) => current && onCommit(updateDefinition(project, current.id, patch));

  /** Where a new step goes: under the selected sub-goal, beside the selected step, or under the puzzle's goal. */
  const add = (kind: NodeKind) => {
    if (!current) return;
    const parentId = picked ? (picked.kind === 'goal' ? picked.id : picked.parentId) : null;
    const made = addNode(project, current.id, { kind, parentId }, picked && picked.kind !== 'goal' ? picked.id : undefined);
    onCommit(made.project);
    setNode(made.nodeId);
    setTab('steps');
  };

  const goals = nodes.filter((n) => n.kind === 'goal');
  // While a step can't be done, its rule holds a placeholder that never does: say what is wrong instead.
  const blocked = issues.some((i) => i.severity === 'error' && i.nodeId);
  const solvedText = !current ? '' : blocked ? 'Not yet: some steps can’t be done (see below).' : describeRule(project, current.data.rule as Rule | undefined);

  const tree = (compact: boolean) => (
    <div className={`pz-tree${compact ? ' compact' : ''}`} role="tree" aria-label={compact ? 'Steps' : 'Puzzle steps'}>
      <button className={`pz-node root${!node ? ' on' : ''}`} role="treeitem" aria-selected={!node} onClick={() => setNode(null)}>
        <span className="pz-mark">🎯</span>
        <span className="pz-node-label">{def.objective || current?.name}</span>
        {!compact && <span className="pz-badge">ALL</span>}
      </button>
      {flatten(nodes).map(({ node: n, depth }) => {
        const broken = issues.some((i) => i.nodeId === n.id && i.severity === 'error');
        return (
          <button
            key={n.id}
            className={`pz-node pz-k-${n.kind}${node === n.id ? ' on' : ''}${n.optional ? ' optional' : ''}${broken ? ' broken' : ''}`}
            role="treeitem"
            aria-selected={node === n.id}
            aria-label={`${n.label}, ${NODE_KINDS.find((k) => k.id === n.kind)?.label}`}
            style={{ paddingLeft: 10 + (depth + 1) * (compact ? 12 : 22) }}
            onClick={() => setNode(n.id)}
          >
            <span className="pz-mark">{KIND_MARK[n.kind]}</span>
            <span className="pz-node-label">{n.label}</span>
            {n.kind === 'goal' && <span className="pz-badge">{n.gate === 'any' ? 'ANY' : n.gate === 'sequence' ? 'SEQ' : 'ALL'}</span>}
            {n.optional && <span className="pz-badge soft">optional</span>}
            {!compact && badgesOf(n).map((b) => (
              <span key={b} className="pz-badge soft">
                {b}
              </span>
            ))}
            {n.hidden && <span className="pz-badge soft">hidden</span>}
            {!compact && <span className="pz-when">{nodeWhenText(project, n)}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="pz">
      <aside className="pz-left" aria-label="Puzzles">
        <div className="pz-new">
          <input className="inp small" aria-label="New puzzle name" placeholder="New puzzle, e.g. The Safe" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <select className="inp small" aria-label="New puzzle scale" value={newScale} onChange={(e) => setNewScale(e.target.value as PuzzleScale)}>
            {SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="tb-btn small" onClick={create}>
            + Puzzle
          </button>
        </div>
        <input className="inp small" aria-label="Find a puzzle" placeholder="Find a puzzle" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="pz-list" role="listbox" aria-label="Puzzle library">
          {shown.map((p) => {
            const n = nodesOf(p).length;
            const bad = puzzleIssues(project, p.id).some((i) => i.severity === 'error');
            return (
              <button
                key={p.id}
                role="option"
                aria-selected={p.id === selected}
                className={`pz-item${p.id === selected ? ' on' : ''}`}
                onClick={() => {
                  setSelected(p.id);
                  setNode(null);
                }}
              >
                <span className="pz-item-name">
                  <span className="mono muted">{p.data.code ?? ''}</span> {p.name}
                </span>
                <span className="pz-item-meta">
                  {SCALES.find((s) => s.id === definitionOf(p).scale)?.label} · {n} {n === 1 ? 'step' : 'steps'}
                  {bad && <span className="pz-dot" title="Something stops it being solved" />}
                </span>
              </button>
            );
          })}
          {!shown.length && <p className="lvl-hint">{all.length ? 'No puzzle matches.' : 'No puzzles yet. Name one above and start writing.'}</p>}
        </div>
        {current && (
          <>
            <span className="pz-label pz-tree-head">Steps of {current.name}</span>
            {tree(true)}
          </>
        )}
      </aside>

      <section className="pz-center" aria-label="Puzzle">
        {!current ? (
          <div className="pz-empty">
            <h2>Puzzle Creator</h2>
            <p>Describe a puzzle before building it: what the player is trying to do, what they know, what they find. Then turn it into steps that decide when it is solved, and bind them to the level.</p>
          </div>
        ) : (
          <>
            <header className="pz-head">
              <span className="mono muted">{current.data.code ?? ''}</span>
              <h2>{current.name}</h2>
              <div className="view-toggle" role="tablist" aria-label="View">
                <button role="tab" aria-selected={tab === 'writing'} className={tab === 'writing' ? 'on' : ''} onClick={() => setTab('writing')}>
                  Writing
                </button>
                <button role="tab" aria-selected={tab === 'steps'} className={tab === 'steps' ? 'on' : ''} onClick={() => setTab('steps')}>
                  Steps <span className="lvl-count">{nodes.length}</span>
                </button>
                <button role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')}>
                  Graph
                </button>
              </div>
            </header>
            {tab === 'writing' ? (
              <div className="pz-writing">
                <div className="pz-scales" role="radiogroup" aria-label="Scale">
                  {SCALES.map((s) => (
                    <label key={s.id} className={`pz-scale${def.scale === s.id ? ' on' : ''}`}>
                      <input type="radio" name="pz-scale" checked={def.scale === s.id} onChange={() => def1({ scale: s.id })} />
                      <strong>{s.label}</strong>
                      <span className="muted">{s.example}</span>
                      <span className="pref-hint">{s.focus}</span>
                    </label>
                  ))}
                </div>
                <Field label="The puzzle in plain words" multiline rows={5} value={def.concept} placeholder="The vault door is held shut by water in its seam. Somewhere in the chamber is the lever that drains it…" onCommit={(v) => def1({ concept: v })} />
                <Field label="The player’s objective" value={def.objective} placeholder="Open the vault door" onCommit={(v) => def1({ objective: v })} hint="What the player is told they are doing." />
                <Field label="Why it is here" multiline rows={2} value={def.purpose} placeholder="The Order sealed the vault; getting in is the turn of the act." onCommit={(v) => def1({ purpose: v })} />
                <Field label="What the player knows and can reach at the start" multiline rows={2} value={def.knows} onCommit={(v) => def1({ knows: v })} />
                <div className="pz-discover">
                  <Field
                    label="Discoveries, clues, objects and actions"
                    multiline
                    rows={6}
                    value={def.discoveries}
                    placeholder={'Find the lever:\nInspect the seam\nPull the lever\n\nCarry the Vault Key'}
                    onCommit={(v) => def1({ discoveries: v })}
                    hint="One per line. A line ending in a colon starts a sub-goal for the lines after it, until a blank line."
                  />
                  <button
                    className="tb-btn small"
                    onClick={() => {
                      const made = stepsFromWriting(project, current.id);
                      if (made.added) {
                        onCommit(made.project);
                        setTab('steps');
                      }
                      onSay(made.added ? `${made.added} new ${made.added === 1 ? 'step' : 'steps'}: say what marks each done.` : 'Every line is already a step.');
                    }}
                  >
                    Turn into steps ▸
                  </button>
                </div>
                <Field label="Intended solution" multiline rows={3} value={def.solution} onCommit={(v) => def1({ solution: v })} />
                <div className="pz-row">
                  <label className="pz-field">
                    <span className="pz-label">Difficulty</span>
                    <select className="inp small" aria-label="Difficulty" value={def.difficulty} onChange={(e) => def1({ difficulty: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((d) => (
                        <option key={d} value={d}>
                          {d} · {['easy', 'gentle', 'fair', 'hard', 'fiendish'][d - 1]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pz-field">
                    <span className="pz-label">Expected minutes</span>
                    <input className="inp small" type="number" min={0} aria-label="Expected minutes" value={def.minutes} onChange={(e) => def1({ minutes: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                  <label className="pz-field">
                    <span className="pz-label">Resets</span>
                    <select className="inp small" aria-label="Resets" value={def.reset} onChange={(e) => def1({ reset: e.target.value as PuzzleDefinition['reset'] })}>
                      {RESETS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pz-field">
                    <span className="pz-label">Tries (0: any)</span>
                    <input className="inp small" type="number" min={0} aria-label="Tries" value={def.retries} onChange={(e) => def1({ retries: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                  </label>
                </div>
                <Field label="What a failure does" value={def.failState} placeholder="The chamber floods" onCommit={(v) => def1({ failState: v })} />
              </div>
            ) : tab === 'graph' ? (
              nodes.length ? (
                <PuzzleGraph
                  project={project}
                  puzzleId={current.id}
                  objective={def.objective || current.name}
                  nodes={nodes}
                  selected={node}
                  broken={(id) => issues.some((i) => i.nodeId === id && i.severity === 'error')}
                  onSelect={setNode}
                  onCommit={onCommit}
                  onSay={onSay}
                />
              ) : (
                <p className="lvl-hint">No steps to draw yet. Add some in Steps, or write the discoveries in Writing and turn them into steps.</p>
              )
            ) : (
              <div className="pz-steps">
                <div className="pz-toolbar" role="toolbar" aria-label="Steps">
                  <button className="tb-btn small" onClick={() => add('goal')}>
                    + Sub-goal
                  </button>
                  <button className="tb-btn small" onClick={() => add('requirement')}>
                    + Requirement
                  </button>
                  <button className="tb-btn small" onClick={() => add('interaction')}>
                    + Interaction
                  </button>
                  <span className="pz-sep" />
                  <button className="icon-btn small" disabled={!picked} aria-label="Move up" title="Up among its siblings" onClick={() => picked && onCommit(reorderNode(project, current.id, picked.id, -1))}>
                    ↑
                  </button>
                  <button className="icon-btn small" disabled={!picked} aria-label="Move down" title="Down among its siblings" onClick={() => picked && onCommit(reorderNode(project, current.id, picked.id, 1))}>
                    ↓
                  </button>
                  <button className="icon-btn small" disabled={!picked} aria-label="Into the sub-goal above" title="Into the sub-goal above it" onClick={() => picked && onCommit(nestNode(project, current.id, picked.id))}>
                    →
                  </button>
                  <button className="icon-btn small" disabled={!picked?.parentId} aria-label="Out of its sub-goal" title="Out of its sub-goal" onClick={() => picked && onCommit(outdentNode(project, current.id, picked.id))}>
                    ←
                  </button>
                  <button
                    className="icon-btn small"
                    disabled={!picked}
                    aria-label="Delete step"
                    title="Delete it and what is under it"
                    onClick={() => {
                      if (!picked) return;
                      onCommit(removeNode(project, current.id, picked.id));
                      setNode(picked.parentId);
                    }}
                  >
                    ×
                  </button>
                </div>
                {nodes.length ? (
                  tree(false)
                ) : (
                  <p className="lvl-hint">No steps yet. Add a sub-goal, a requirement or an interaction, or write the discoveries in Writing and turn them into steps.</p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="pz-right" aria-label="Properties">
        {current && picked ? (
          <NodeInspector project={project} puzzleId={current.id} node={picked} goals={goals} onCommit={onCommit} onSay={onSay} onOpenBible={onOpenBible} />
        ) : current ? (
          <div className="pz-inspector">
            <span className="lvl-kind">Puzzle</span>
            <Field label="Name" value={current.name} onCommit={(v) => v.trim() && onCommit({ ...project, objects: { ...project.objects, [current.id]: { ...current, name: v.trim(), modified: new Date().toISOString() } } })} />
            <section className="pz-sec">
              <span className="pz-label">Solved when</span>
              {nodes.length > 0 && (
                <label className="lvl-toggle">
                  <input type="checkbox" checked={treeDrives(current)} onChange={(e) => onCommit(setTreeDrives(project, current.id, e.target.checked))} /> Its steps decide
                </label>
              )}
              {treeDrives(current) ? (
                <p className="pz-says">{solvedText}</p>
              ) : (
                <RuleEditor project={project} rule={current.data.rule as Rule | undefined} label="Solved when" onChange={(r) => onCommit(setValue(project, current.id, 'rule', r))} />
              )}
            </section>
            <RuleEditor project={project} rule={current.data.entry as Rule | undefined} label="Can begin when (empty: at once)" onChange={(r) => onCommit(setValue(project, current.id, 'entry', r))} />
            <EffectsEditor project={project} effects={current.data.effects as Effect[] | undefined} label="When solved" onChange={(e) => onCommit(setValue(project, current.id, 'effects', e))} />
            <section className="pz-sec">
              <span className="pz-label">In the levels</span>
              {places.length ? (
                places.map((p) => (
                  <button key={p.item.id} className="lvl-link-go" onClick={() => onOpenLevels?.(p.item.id)}>
                    {p.item.name}
                    <span className="muted">
                      {p.level} · {p.roles.map((r) => roleOf(r).label).join(', ')}
                    </span>
                  </button>
                ))
              ) : (
                <p className="lvl-hint">Not in a level yet. In the Level Designer, select an item and bind it under Puzzles.</p>
              )}
            </section>
            <button className="tb-btn small" onClick={() => onOpenBible(current.id)}>
              Open in the Bible ↗
            </button>
          </div>
        ) : null}
      </aside>

      <footer className="pz-bottom" aria-label="Validation">
        {current &&
          (issues.length ? (
            <ul className="pz-issues">
              {issues.map((i, n) => (
                <li key={n}>
                  <button className={`pz-issue ${i.severity}`} onClick={() => i.nodeId && (setNode(i.nodeId), setTab('steps'))}>
                    {i.severity === 'error' ? '●' : '○'} {i.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="pz-ok">✓ Nothing stops it being solved.</span>
          ))}
      </footer>
    </div>
  );
};

/** The selected step: what it is, what marks it done (or the element to make for it), and where it sits. */
const NodeInspector = ({ project, puzzleId, node, goals, onCommit, onSay, onOpenBible }: { project: Project; puzzleId: string; node: PuzzleNode; goals: PuzzleNode[]; onCommit: (p: Project) => void; onSay: (t: string) => void; onOpenBible: (id?: string) => void }) => {
  const patch = (p: Partial<Omit<PuzzleNode, 'id'>>) => onCommit(updateNode(project, puzzleId, node.id, p));
  const nodes = nodesOf(project.objects[puzzleId]);
  const ref = node.when && project.objects[node.when.ref];
  return (
    <div className="pz-inspector">
      <span className="lvl-kind">{NODE_KINDS.find((k) => k.id === node.kind)?.label}</span>
      <Field label="Step" value={node.label} onCommit={(v) => v.trim() && patch({ label: v.trim() })} />
      <label className="pz-field">
        <span className="pz-label">Kind</span>
        <select className="inp small" aria-label="Kind" value={node.kind} onChange={(e) => patch({ kind: e.target.value as NodeKind })}>
          {NODE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}: {k.hint}
            </option>
          ))}
        </select>
      </label>
      {node.kind === 'goal' ? (
        <label className="pz-field">
          <span className="pz-label">Done when</span>
          <select className="inp small" aria-label="Done when" value={node.gate ?? 'all'} onChange={(e) => patch({ gate: e.target.value as 'all' | 'any' | 'sequence' })}>
            <option value="all">All of its steps are (AND)</option>
            <option value="any">Any one of its steps is (OR: alternate paths)</option>
            <option value="sequence">All of them, in order (sequence)</option>
          </select>
          <span className="pref-hint">{childrenOf(nodes, node.id).length} steps under it.</span>
        </label>
      ) : (
        <>
          <ConditionEditor project={project} condition={node.when} label="Done when" onChange={(c) => patch({ when: c })} />
          {ref && (
            <button className="lvl-link-go" onClick={() => onOpenBible(ref.id)}>
              {ref.name}
              <span className="muted">open in the Bible ↗</span>
            </button>
          )}
          <div className="pz-make">
            <span className="pz-label">Make it into</span>
            <div className="lvl-btnrow wrap">
              {MAKES.map((m) => (
                <button
                  key={m.kind}
                  className="tb-btn small"
                  title={`Make a new ${m.type} named after this step, and have the step done when it is ${m.kind === 'item' ? 'carried' : m.kind === 'lore' ? 'known' : 'yes'}`}
                  onClick={() => {
                    const made = makeElementFor(project, puzzleId, node.id, m.kind);
                    if (!made.elementId) return;
                    onCommit(made.project);
                    onSay(`${made.project.objects[made.elementId]!.name} is in the Bible; the step is done when it is ${m.kind === 'item' ? 'carried' : m.kind === 'lore' ? 'known' : 'yes'}.`);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {node.kind === 'goal' && (
        <label className="pz-field">
          <span className="pz-label">Within (s)</span>
          <input
            className="inp small"
            type="number"
            min={0}
            aria-label="Within (s)"
            value={node.within ?? 0}
            onChange={(e) => patch({ within: Math.max(0, Number(e.target.value) || 0) || undefined })}
          />
          <span className="pref-hint">0: no time limit. With one, its clock starts at its first step done; run out and what was done under it is undone.</span>
        </label>
      )}
      <section className="pz-sec">
        <span className="pz-label">Needs first</span>
        {(node.requires ?? []).map((r) => (
          <span key={r} className="pz-need">
            {nodes.find((n) => n.id === r)?.label ?? r}
            <button className="icon-btn small" aria-label={`Doesn’t need ${nodes.find((n) => n.id === r)?.label ?? r}`} onClick={() => onCommit(removeRequire(project, puzzleId, node.id, r))}>
              ×
            </button>
          </span>
        ))}
        <select
          className="inp small"
          aria-label="Add a step it needs first"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            const next = addRequire(project, puzzleId, node.id, e.target.value);
            if (next === project) onSay('That step can’t come first: it would go round in a circle, or one is part of the other.');
            else onCommit(next);
          }}
        >
          <option value="">+ a step it needs done first…</option>
          {nodes
            .filter((n) => n.id !== node.id && !node.requires?.includes(n.id) && !descendantsOf(nodes, node.id).some((d) => d.id === n.id) && !descendantsOf(nodes, n.id).some((d) => d.id === node.id))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
      </section>
      <EffectsEditor project={project} effects={node.effects} label="When done (the first time)" onChange={(e) => patch({ effects: e?.length ? e : undefined })} />
      {node.kind !== 'goal' && (
        <section className="pz-sec pz-wrong">
          <span className="pz-label">A wrong move</span>
          <ConditionEditor project={project} condition={node.fail?.when} label="Wrong when" onChange={(c) => patch({ fail: c || node.fail?.effects?.length ? { ...node.fail, when: c } : undefined })} />
          {node.fail?.when && (
            <>
              <EffectsEditor project={project} effects={node.fail.effects} label="It does" onChange={(e) => patch({ fail: { ...node.fail, effects: e?.length ? e : undefined } })} />
              <label className="lvl-toggle">
                <input type="checkbox" checked={!!node.fail.forward} onChange={(e) => patch({ fail: { ...node.fail, forward: e.target.checked || undefined } })} /> Fail-forward: it still counts as done (the story goes on, worse off)
              </label>
            </>
          )}
        </section>
      )}
      <label className="lvl-toggle">
        <input type="checkbox" checked={!!node.optional} onChange={(e) => patch({ optional: e.target.checked || undefined })} /> Optional: a reward, a shortcut, an extra clue
      </label>
      {node.optional && (
        <label className="pz-field">
          <span className="pz-label">Branch</span>
          <select className="inp small" aria-label="Branch" value={node.branch ?? ''} onChange={(e) => patch({ branch: (e.target.value || undefined) as PuzzleNode['branch'] })}>
            <option value="">—</option>
            <option value="reward">A reward</option>
            <option value="shortcut">A shortcut</option>
            <option value="clue">An extra clue</option>
            <option value="alternate">An alternate way</option>
          </select>
        </label>
      )}
      <label className="lvl-toggle">
        <input type="checkbox" checked={!!node.hidden} onChange={(e) => patch({ hidden: e.target.checked || undefined })} /> Hidden from the player until reached
      </label>
      <label className="pz-field">
        <span className="pz-label">Part of</span>
        <select className="inp small" aria-label="Part of" value={node.parentId ?? ''} onChange={(e) => onCommit(moveNode(project, puzzleId, node.id, e.target.value || null))}>
          <option value="">The puzzle’s goal</option>
          {goals
            .filter((g) => g.id !== node.id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
        </select>
      </label>
      <Field label="Group" value={node.group ?? ''} placeholder="e.g. Study, Upstairs" onCommit={(v) => patch({ group: v.trim() || undefined })} />
      <Field label="Notes" multiline rows={3} value={node.notes ?? ''} onCommit={(v) => patch({ notes: v.trim() || undefined })} />
    </div>
  );
};
