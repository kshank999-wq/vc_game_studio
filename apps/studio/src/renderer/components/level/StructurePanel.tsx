import { useMemo, useState } from 'react';
import { floorCodes, OUTSIDE, structureGraph, structureIssues, type StructureEdge } from '../../model/level/structure';
import type { AssetDefinition, LevelSet } from '../../model/level/types';
import { walkStructure } from '../../model/level/walkthrough';
import type { Project } from '../../model/types';

const KIND_LABEL: Record<StructureEdge['kind'], string> = { door: 'door', opening: 'open', stairs: 'stairs', ramp: 'ramp', ladder: 'ladder', elevator: 'lift', traversal: 'climb', portal: 'portal' };

/**
 * The structure graph (structure spec §4 bottom panel, §8): each floor a band,
 * top floor first; its rooms as nodes; doors, openings, stairs, ladders and
 * lifts as edges (dashed between floors, red where something keeps them shut);
 * the outside on the left, joined by the entrances. Rooms no one can reach are
 * ringed, and the structure's issues are listed beside it, with the
 * walkthrough the solvability check found (structure spec §11): how a player
 * gets through, key by key. Click a room to go to it.
 */
export const StructurePanel = ({ project, levelId, floorId, global, selection, onSelect, onClose, onPopOut }: { project: Project; levelId: string; floorId: string; global: readonly AssetDefinition[]; selection: readonly string[]; onSelect: (id: string, floorId: string) => void; onClose: () => void; onPopOut?: () => void }) => {
  const set = project.levels as LevelSet;
  const level = set.levels.find((l) => l.id === levelId)!;
  const [tab, setTab] = useState<'issues' | 'walk'>('issues');
  const { graph, issues, walk } = useMemo(() => {
    const walk = walkStructure(project, levelId, global);
    return { graph: structureGraph(set, levelId, global), issues: [...structureIssues(set, levelId, global), ...walk.issues], walk };
  }, [project, set, levelId, global]);
  const walked = new Set(walk.reached);
  const codes = floorCodes(level);
  const floors = [...level.floors].sort((a, b) => b.elevation - a.elevation);
  const band = 54;
  const left = 96;
  const width = 760;
  const xs = graph.nodes.map((n) => n.x);
  const x0 = Math.min(...xs, 0);
  const x1 = Math.max(...xs, 1);
  const pos = new Map<string, { x: number; y: number }>();
  // Rooms in a band, spread by where they are east to west; ones at the same spot nudged apart.
  for (const f of floors) {
    const row = graph.nodes.filter((n) => n.floorId === f.id).sort((a, b) => a.x - b.x);
    const fy = floors.indexOf(f) * band + band / 2 + 6;
    let last = -Infinity;
    for (const n of row) {
      let x = left + 20 + ((n.x - x0) / (x1 - x0 || 1)) * (width - left - 60);
      if (x - last < 70) x = last + 70;
      last = x;
      pos.set(n.id, { x, y: fy + (row.indexOf(n) % 2 ? 9 : -9) });
    }
  }
  const ground = floors.find((f) => codes.get(f.id) === 'G') ?? floors[floors.length - 1]!;
  pos.set(OUTSIDE, { x: 40, y: floors.indexOf(ground) * band + band / 2 + 6 });
  const height = floors.length * band + 12;
  const svgWidth = Math.max(width, ...[...pos.values()].map((p) => p.x + 80));
  const unreachable = new Set(graph.unreachable);
  const counts = { rooms: graph.nodes.length, ways: graph.edges.length, entrances: graph.edges.filter((e) => e.from === OUTSIDE || e.to === OUTSIDE).length };
  return (
    <section className="lvl-structure" aria-label="Structure graph">
      <header className="lvl-structure-head">
        <strong>Structure</strong>
        <span className="muted">
          {counts.rooms} rooms · {counts.ways} connections · {counts.entrances} {counts.entrances === 1 ? 'way in' : 'ways in'}
          {graph.unreachable.length ? ` · ${graph.unreachable.length} unreachable` : ''}
        </span>
        <span className="grow" />
        {onPopOut && (
          <button className="icon-btn small" aria-label="Open in its own window" title="Open in its own window, to put on another screen" onClick={onPopOut}>
            ⧉
          </button>
        )}
        <button className="icon-btn small" aria-label="Close the structure graph" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="lvl-structure-body">
        <div className="lvl-structure-graph">
          <svg width={svgWidth} height={height} role="img" aria-label={`Rooms on ${floors.length} floors and how they connect`}>
            <defs>
              <marker id="lvl-oneway" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="lvl-structure-arrow" />
              </marker>
            </defs>
            {floors.map((f, i) => (
              <g key={f.id}>
                <rect x={0} y={i * band + 6} width={svgWidth} height={band - 2} className={`lvl-structure-band${f.id === floorId ? ' on' : ''}`} />
                <text x={8} y={i * band + 22} className="lvl-structure-floor">
                  {codes.get(f.id)}
                </text>
                <text x={8} y={i * band + 36} className="lvl-structure-floorname">
                  {f.name.length > 12 ? `${f.name.slice(0, 11)}…` : f.name}
                </text>
              </g>
            ))}
            {graph.edges.map((e) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              return (
                <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd={e.oneWay ? 'url(#lvl-oneway)' : undefined} className={`lvl-structure-edge ${e.kind}${e.vertical ? ' vertical' : ''}${e.gated ? ' gated' : ''}${e.secret ? ' secret' : ''}`}>
                  <title>
                    {e.secret ? 'secret door' : KIND_LABEL[e.kind]}
                    {e.oneWay ? ', one way' : ''}
                    {e.gated ? ' (closed until something opens it)' : ''}
                  </title>
                </line>
              );
            })}
            {graph.edges.some((e) => e.from === OUTSIDE || e.to === OUTSIDE) && (
              <g>
                <circle cx={40} cy={pos.get(OUTSIDE)!.y} r={9} className="lvl-structure-outside" />
                <text x={40} y={pos.get(OUTSIDE)!.y + 22} textAnchor="middle" className="lvl-structure-label">
                  Outside
                </text>
              </g>
            )}
            {graph.nodes.map((n) => {
              const p = pos.get(n.id)!;
              const on = selection.includes(n.id);
              return (
                <g key={n.id} className="lvl-structure-node" role="button" tabIndex={0} aria-label={`${n.name}${unreachable.has(n.id) ? ', unreachable' : graph.start && !walked.has(n.id) ? ', shut off' : ''}`} onClick={() => onSelect(n.id, n.floorId)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onSelect(n.id, n.floorId)}>
                  <circle cx={p.x} cy={p.y} r={on ? 8 : 6.5} className={`${unreachable.has(n.id) ? 'unreachable' : graph.start && !walked.has(n.id) ? 'shut' : ''}${on ? ' on' : ''} ${n.role}`} />
                  <text x={p.x + 10} y={p.y + 4} className="lvl-structure-label">
                    {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}
                  </text>
                </g>
              );
            })}
          </svg>
          {!graph.nodes.length && <p className="muted lvl-structure-empty">No rooms yet. Draw rooms on the floors, put doors in their walls and stairs between floors: they appear here as you go.</p>}
        </div>
        <div className="lvl-structure-side">
          <div role="tablist" aria-label="Structure checks" className="view-toggle small">
            <button role="tab" aria-selected={tab === 'issues'} className={tab === 'issues' ? 'on' : ''} onClick={() => setTab('issues')}>
              Issues{issues.filter((i) => i.severity !== 'info').length ? ` (${issues.filter((i) => i.severity !== 'info').length})` : ''}
            </button>
            <button role="tab" aria-selected={tab === 'walk'} className={tab === 'walk' ? 'on' : ''} onClick={() => setTab('walk')}>
              Walkthrough
            </button>
          </div>
          {tab === 'walk' ? (
            <ol className="lvl-structure-issues lvl-structure-walk" aria-label="Walkthrough">
              {walk.steps.length === 0 && <li className="muted">No way in yet: the walkthrough starts at an entrance or the player start.</li>}
              {walk.steps.map((st, n) => (
                <li key={n} className={`lvl-walk-step ${st.kind}`}>
                  <button
                    className="lvl-issue info"
                    disabled={!st.id}
                    onClick={() => {
                      const item = set.items.find((x) => x.id === st.id);
                      if (item) onSelect(item.id, item.floorId);
                    }}
                  >
                    {st.text}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <ul className="lvl-structure-issues" aria-label="Structure issues">
              {issues.length === 0 && <li className="muted">{graph.nodes.length ? 'Every room can be reached, every key before its door, and the floors line up.' : 'Nothing to check yet.'}</li>}
              {issues.map((i, n) => (
                <li key={n}>
                  <button
                    className={`lvl-issue ${i.severity}`}
                    onClick={() => {
                      const item = set.items.find((x) => x.id === i.id);
                      if (item) onSelect(item.id, item.floorId);
                    }}
                  >
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};
