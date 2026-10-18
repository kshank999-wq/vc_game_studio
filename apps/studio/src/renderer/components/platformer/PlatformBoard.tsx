import type { Grid } from '../../model/platformer/platformer';

/**
 * A platformer level drawn tile by tile, a tile a unit: solid ground,
 * one-way platforms, spikes, coins, enemies, the start and the goal. It can
 * show where the hero can stand and the route the studio found, and paint
 * by pressing and dragging. It is drawn at its full size, to scroll.
 */
export const PlatformBoard = ({ grid, stand, trace, missed, onPaint, label, scale = 26 }: { grid: Grid; stand?: number[]; trace?: [number, number][]; missed?: number[]; onPaint?: (i: number) => void; label: string; scale?: number }) => {
  const reach = new Set(stand);
  const lost = new Set(missed);
  const paint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPaint || e.buttons !== 1) return;
    const el = e.currentTarget;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()?.inverse());
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) onPaint(y * grid.cols + x);
  };
  return (
    <div className="pf-scroll">
      <svg className={`pf-board${onPaint ? ' paint' : ''}`} width={grid.cols * scale} height={grid.rows * scale} viewBox={`0 0 ${grid.cols} ${grid.rows}`} role="img" aria-label={label} onPointerDown={paint} onPointerMove={paint}>
        <rect x={0} y={0} width={grid.cols} height={grid.rows} className="pf-sky" />
        {grid.tiles.map((t, i) => {
          const x = i % grid.cols;
          const y = Math.floor(i / grid.cols);
          return (
            <g key={i}>
              {reach.has(i) ? <rect x={x} y={y} width={1} height={1} className="pf-reach" /> : null}
              <Tile t={t} x={x} y={y} lost={lost.has(i)} />
            </g>
          );
        })}
        {trace?.length ? <polyline points={trace.map(([x, y]) => `${x},${y}`).join(' ')} className="pf-route" /> : null}
      </svg>
    </div>
  );
};

/** One tile, at x, y. */
export const Tile = ({ t, x, y, lost = false }: { t: string; x: number; y: number; lost?: boolean }) => {
  if (t === '#') return <rect x={x} y={y} width={1} height={1} className="pf-solid" />;
  if (t === '=') return <rect x={x} y={y} width={1} height={0.25} className="pf-oneway" />;
  if (t === '^') return <path d={`M${x} ${y + 1} L${x + 0.25} ${y + 0.5} L${x + 0.5} ${y + 1} L${x + 0.75} ${y + 0.5} L${x + 1} ${y + 1} Z`} className="pf-spikes" />;
  if (t === 'o') return <circle cx={x + 0.5} cy={y + 0.5} r={0.22} className={`pf-coin${lost ? ' lost' : ''}`} />;
  if (t === 'e') return <rect x={x + 0.1} y={y + 0.2} width={0.8} height={0.8} rx={0.3} className="pf-enemy" />;
  if (t === 'S') return <rect x={x + 0.1} y={y + 0.1} width={0.8} height={0.9} rx={0.2} className="pf-start" />;
  if (t === 'G')
    return (
      <g className="pf-goal">
        <rect x={x + 0.45} y={y} width={0.08} height={1} />
        <path d={`M${x + 0.53} ${y} L${x + 1} ${y + 0.2} L${x + 0.53} ${y + 0.4} Z`} />
      </g>
    );
  return null;
};
