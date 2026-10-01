import { useMemo, useRef, useState } from 'react';
import { addRequire, childrenOf, removeRequire, type PuzzleNode } from '../../model/puzzle/design';
import type { Project } from '../../model/types';
import { badgesOf } from './badges';

const W = 168;
const H = 46;
const GAP_X = 24;
const GAP_Y = 64;
const PAD = 24;

interface Placed {
  node: PuzzleNode | null;
  x: number;
  y: number;
}

/**
 * A tidy layout of the steps: the puzzle's goal on top, each sub-goal over
 * what it needs, its leaves side by side (puzzle spec §5). Leaves take a slot
 * each in tree order; a sub-goal sits over the middle of its own.
 */
export const layoutGraph = (nodes: readonly PuzzleNode[]): { placed: Map<string, Placed>; width: number; height: number } => {
  const placed = new Map<string, Placed>();
  let slot = 0;
  let deepest = 0;
  const place = (node: PuzzleNode | null, depth: number): number => {
    deepest = Math.max(deepest, depth);
    const kids = childrenOf(nodes, node?.id ?? null);
    let cx: number;
    if (!kids.length) cx = slot++ * (W + GAP_X);
    else {
      const xs = kids.map((k) => place(k, depth + 1));
      cx = (xs[0]! + xs[xs.length - 1]!) / 2;
    }
    placed.set(node?.id ?? '', { node, x: cx, y: depth * (H + GAP_Y) });
    return cx;
  };
  place(null, 0);
  for (const p of placed.values()) {
    p.x += PAD;
    p.y += PAD;
  }
  return { placed, width: Math.max(1, slot) * (W + GAP_X) - GAP_X + PAD * 2, height: (deepest + 1) * (H + GAP_Y) - GAP_Y + PAD * 2 + 30 };
};

interface Props {
  project: Project;
  puzzleId: string;
  objective: string;
  nodes: readonly PuzzleNode[];
  selected: string | null;
  broken: (id: string) => boolean;
  onSelect: (id: string | null) => void;
  onCommit: (project: Project) => void;
  onSay: (text: string) => void;
}

/** The dependency graph: what each step is part of (solid), what it needs done first (dashed), drawn from the same tree. */
export const PuzzleGraph = ({ project, puzzleId, objective, nodes, selected, broken, onSelect, onCommit, onSay }: Props) => {
  const { placed, width, height } = useMemo(() => layoutGraph(nodes), [nodes]);
  const [edge, setEdge] = useState<{ from: string; to: string } | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const at = (id: string | null) => placed.get(id ?? '')!;
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  const local = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const link = (from: string, to: string) => {
    if (from === to) return;
    const next = addRequire(project, puzzleId, to, from);
    if (next === project) onSay(`${label(to)} can’t need ${label(from)} first: that would go round in a circle, or one is part of the other.`);
    else {
      onCommit(next);
      onSay(`${label(to)} now needs ${label(from)} done first.`);
    }
  };
  const unlink = (e: { from: string; to: string }) => {
    onCommit(removeRequire(project, puzzleId, e.to, e.from));
    setEdge(null);
  };

  const links = nodes.flatMap((n) => (n.requires ?? []).filter((r) => placed.has(r)).map((r) => ({ from: r, to: n.id })));
  const isEdge = (e: { from: string; to: string }) => edge?.from === e.from && edge.to === e.to;

  return (
    <div className="pz-graph-wrap">
      <div className="pz-graph-bar">
        <span className="pref-hint">Solid lines: part of. Dashed arrows: needs done first. Drag from a step’s ● to the step that needs it; click an arrow to select it.</span>
        {edge && (
          <span className="pz-edge-picked">
            {label(edge.to)} needs {label(edge.from)} first
            <button className="tb-btn small" onClick={() => unlink(edge)}>
              Remove link
            </button>
          </span>
        )}
      </div>
      <svg
        ref={svg}
        className="pz-graph"
        role="group"
        aria-label="Puzzle graph"
        width={width}
        height={height}
        tabIndex={0}
        onKeyDown={(e) => edge && (e.key === 'Delete' || e.key === 'Backspace') && unlink(edge)}
        onPointerMove={(e) => drag && setDrag({ ...drag, ...local(e) })}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        onClick={(e) => e.target === e.currentTarget && (setEdge(null), onSelect(null))}
      >
        <defs>
          <marker id="pz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="pz-arrowhead" />
          </marker>
        </defs>
        {/* Part of: each step up to its sub-goal, numbered in a sequence. */}
        {nodes.map((n) => {
          const c = at(n.id);
          const p = at(n.parentId);
          const parent = n.parentId ? nodes.find((x) => x.id === n.parentId) : undefined;
          const steps = childrenOf(nodes, n.parentId).filter((s) => !s.optional);
          const order = parent?.gate === 'sequence' && !n.optional ? steps.findIndex((s) => s.id === n.id) + 1 : 0;
          const x1 = c.x + W / 2;
          const y1 = c.y;
          const x2 = p.x + W / 2;
          const y2 = p.y + H;
          const my = (y1 + y2) / 2;
          return (
            <g key={`p-${n.id}`} className={`pz-part${n.optional ? ' optional' : ''}`}>
              <path d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} />
              {order > 0 && (
                <text x={x1} y={y1 - 6} className="pz-order" textAnchor="middle">
                  {order}
                </text>
              )}
            </g>
          );
        })}
        {/* Needs first: dashed arrows from the step that comes first. */}
        {links.map((e) => {
          const a = at(e.from);
          const b = at(e.to);
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x;
          const y2 = b.y + H / 2;
          const back = x2 < x1;
          // Backwards (right to left): under the boxes, bottom to bottom, clear of what is between.
          const sag = Math.max(a.y, b.y) + H + 36;
          const d = back ? `M${a.x + W / 2} ${a.y + H} C${a.x + W / 2} ${sag} ${b.x + W / 2} ${sag} ${b.x + W / 2} ${b.y + H}` : `M${x1} ${y1} C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2} ${y2}`;
          return (
            <g key={`r-${e.from}-${e.to}`} className={`pz-needs${isEdge(e) ? ' on' : ''}`} role="button" aria-label={`${label(e.to)} needs ${label(e.from)} first`} aria-pressed={isEdge(e)} onClick={() => setEdge(isEdge(e) ? null : e)}>
              <path d={d} className="pz-needs-hit" />
              <path d={d} className="pz-needs-line" markerEnd="url(#pz-arrow)" />
            </g>
          );
        })}
        {drag && <line className="pz-drag" x1={at(drag.from).x + W} y1={at(drag.from).y + H / 2} x2={drag.x} y2={drag.y} />}
        {[...placed.values()].map(({ node: n, x, y }) => {
          const id = n?.id ?? '';
          const on = n ? selected === n.id : !selected;
          const gate = n ? (n.kind === 'goal' ? (n.gate ?? 'all') : '') : 'all';
          return (
            <g
              key={`n-${id || 'root'}`}
              className={`pz-gnode ${n ? `pz-k-${n.kind}` : 'root'}${on ? ' on' : ''}${n?.optional ? ' optional' : ''}${n && broken(n.id) ? ' broken' : ''}`}
              transform={`translate(${x} ${y})`}
              role="button"
              aria-label={n ? `${n.label} (graph)` : `${objective} (graph)`}
              aria-pressed={on}
              onClick={() => (setEdge(null), onSelect(n?.id ?? null))}
              onPointerUp={() => {
                if (drag && n && drag.from !== n.id) link(drag.from, n.id);
                setDrag(null);
              }}
            >
              <rect width={W} height={H} rx={n?.kind === 'goal' || !n ? 10 : 6} />
              <text x={10} y={18} className="pz-gl">
                {(n ? n.label : objective).slice(0, 22)}
              </text>
              <text x={10} y={36} className="pz-gb">
                {[gate && gate.toUpperCase().replace('SEQUENCE', 'SEQ'), ...(n ? badgesOf(n) : [])].filter(Boolean).join(' · ')}
              </text>
              {n && (
                <circle
                  className="pz-port"
                  cx={W}
                  cy={H / 2}
                  r={6}
                  aria-label={`Link from ${n.label}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).releasePointerCapture?.(e.pointerId);
                    setDrag({ from: n.id, ...local(e) });
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
