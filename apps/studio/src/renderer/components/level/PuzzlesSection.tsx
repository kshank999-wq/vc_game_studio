import { useState } from 'react';
import { levelsOf } from '../../model/level/level';
import { bindableNodes, bindToPuzzle, PUZZLE_ROLES, puzzleRolesOf, puzzlesOf, puzzlesOnMap, roleOf, unbindFromPuzzle } from '../../model/level/puzzles';
import type { AssetDefinition, PuzzleRole } from '../../model/level/types';
import type { Project } from '../../model/types';
import { Section } from './fields';
import { useNav } from '../../nav';

const Chip = ({ role, count }: { role: PuzzleRole; count?: number }) => {
  const r = roleOf(role);
  return (
    <span className="lvl-puzzle-chip" style={{ borderColor: r.color, color: r.color }} title={r.hint}>
      {r.mark} {r.label}
      {count !== undefined ? ` ${count}` : ''}
    </span>
  );
};

/**
 * A map's puzzles (spec V2 §14): each puzzle with a part here, its parts by
 * role, what solving it does, and its parts on other maps. The puzzle itself
 * is edited in the Puzzle Creator.
 */
export const MapPuzzles = ({
  project,
  levelId,
  global,
  open,
  onToggle,
  onShow,
  onOpenStory,
  onOpenMap,
}: {
  project: Project;
  levelId: string;
  global: readonly AssetDefinition[];
  open: boolean;
  onToggle: () => void;
  onShow?: (puzzleId: string) => void;
  onOpenStory: (id: string) => void;
  onOpenMap?: (levelId: string) => void;
}) => {
  const set = levelsOf(project);
  const nav = useNav();
  const openPuzzle = (id: string) => (nav.openPuzzles ? nav.openPuzzles(id) : onOpenStory(id));
  const here = puzzlesOnMap(project, levelId, global);
  const all = puzzlesOf(project);
  return (
    <Section title="Puzzles" open={open} onToggle={onToggle} count={here.length || undefined}>
      {!here.length && <p className="lvl-hint">{all.length ? 'No puzzle has a part on this map yet. Select an item and bind it to one under Puzzles.' : 'The story has no puzzles yet: make one in the Puzzle Creator (the Bible).'}</p>}
      {here.map((o) => (
        <div key={o.puzzle.id} className="lvl-puzzle-row" role="group" aria-label={`Puzzle ${o.puzzle.name}`}>
          <strong>🧩 {o.puzzle.name}</strong>
          <div className="lvl-puzzle-chips">
            {PUZZLE_ROLES.map((r) => {
              const n = o.parts.filter((p) => p.role === r.id).length;
              return n ? <Chip key={r.id} role={r.id} count={n} /> : null;
            })}
          </div>
          {o.outputs.length > 0 && <p className="lvl-hint">Solving it: {o.outputs.join(' · ')}</p>}
          {o.elsewhere.map((e) => (
            <button key={e.levelId} className="lvl-link-go" onClick={() => onOpenMap?.(e.levelId)}>
              {e.count} more on {set.levels.find((l) => l.id === e.levelId)?.name ?? 'another map'} ▸
            </button>
          ))}
          <div className="lvl-btnrow wrap">
            <button className="tb-btn small" onClick={() => onShow?.(o.puzzle.id)}>
              Show on the map
            </button>
            <button className="tb-btn small" onClick={() => openPuzzle(o.puzzle.id)} title="Its rule and what solving it does live there, once">
              Open in the Puzzle Creator ↗
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
};

/**
 * An item's parts in puzzles (spec V2 §14): what it is read as (a door there
 * only while a puzzle is unsolved is a gate), what it is bound as, and
 * binding it: as the entry, a required object (to a step of the puzzle), a
 * clue (that can reveal lore), a gate or an output.
 */
export const ItemPuzzles = ({
  project,
  itemId,
  global,
  open,
  onToggle,
  onCommit,
  onOpenStory,
  onShow,
}: {
  project: Project;
  itemId: string;
  global: readonly AssetDefinition[];
  open: boolean;
  onToggle: () => void;
  onCommit: (p: Project) => void;
  onOpenStory: (id: string) => void;
  onShow?: (puzzleId: string) => void;
}) => {
  const all = puzzlesOf(project);
  const nav = useNav();
  const openPuzzle = (id: string) => (nav.openPuzzles ? nav.openPuzzles(id) : onOpenStory(id));
  const item = levelsOf(project).items.find((i) => i.id === itemId);
  const [puzzle, setPuzzle] = useState('');
  const [role, setRole] = useState<PuzzleRole>('required');
  const [node, setNode] = useState('');
  if (!item) return null;
  const parts = puzzleRolesOf(project, itemId, global);
  const chosen = puzzle || all[0]?.id || '';
  const nodes = chosen ? bindableNodes(project, chosen, role) : [];
  const pickedNode = nodes.some((n) => n.id === node) ? node : '';
  return (
    <Section title="Puzzles" open={open} onToggle={onToggle} count={parts.length || undefined}>
      {parts.map((p) => (
        <div key={`${p.puzzle}-${p.role}`} className="lvl-puzzle-part-row">
          <Chip role={p.role} />
          <span>
            <button className="lvl-link-go inline" onClick={() => onShow?.(p.puzzle)} title="Show it on the map">
              {project.objects[p.puzzle]?.name}
            </button>{' '}
            <span className="muted">{p.why}</span>
            {!p.bound && <span className="muted"> · read from the level</span>}
          </span>
          {p.bound && (
            <button className="icon-btn small" disabled={item.locked} aria-label={`Unbind ${roleOf(p.role).label} of ${project.objects[p.puzzle]?.name}`} title="Unbind: undoes what binding did" onClick={() => onCommit(unbindFromPuzzle(project, itemId, { puzzle: p.puzzle, role: p.role }, global))}>
              ×
            </button>
          )}
        </div>
      ))}
      {!all.length ? (
        <p className="lvl-hint">No puzzles in the story yet: make one in the Puzzle Creator (the Bible), then bind this to it.</p>
      ) : (
        <div className="lvl-puzzle-bind">
          <label className="lvl-field">
            <span className="lvl-flabel">Puzzle</span>
            <select className="inp small" aria-label="Bind to puzzle" value={chosen} onChange={(e) => setPuzzle(e.target.value)}>
              {all.map((pz) => (
                <option key={pz.id} value={pz.id}>
                  {pz.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lvl-field">
            <span className="lvl-flabel">As</span>
            <select className="inp small" aria-label="Puzzle role" value={role} onChange={(e) => setRole(e.target.value as PuzzleRole)}>
              {PUZZLE_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}: {r.hint}
                </option>
              ))}
            </select>
          </label>
          {nodes.length > 0 && (
            <label className="lvl-field">
              <span className="lvl-flabel">{role === 'clue' ? 'Reveals' : 'Step'}</span>
              <select className="inp small" aria-label="Puzzle step" value={pickedNode} onChange={(e) => setNode(e.target.value)}>
                <option value="">{role === 'clue' ? 'Nothing: a clue to see' : 'Any: just mark it'}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="lvl-btnrow wrap">
            <button className="tb-btn small" disabled={!chosen || item.locked} onClick={() => onCommit(bindToPuzzle(project, itemId, { puzzle: chosen, role, ...(pickedNode ? { node: pickedNode } : {}) }, global))}>
              Bind
            </button>
            {chosen && (
              <button className="tb-btn small" onClick={() => openPuzzle(chosen)}>
                Open in the Puzzle Creator ↗
              </button>
            )}
          </div>
          <p className="lvl-hint">
            {role === 'gate'
              ? 'A gate is there only while the puzzle is unsolved: a door, a rockfall, a barrier.'
              : role === 'output'
                ? 'An output is there only once it is solved: a reward, a way on, a cinematic’s trigger.'
                : role === 'required'
                  ? 'Bound to a step, it is tied to that element, so using it works the puzzle’s own logic.'
                  : role === 'clue'
                    ? 'A clue bound to lore reveals it when examined.'
                    : 'Where the puzzle is played: it is tied to the puzzle.'}
          </p>
        </div>
      )}
    </Section>
  );
};
