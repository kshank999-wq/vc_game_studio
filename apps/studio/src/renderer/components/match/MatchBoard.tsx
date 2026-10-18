import { GEM_HUES, type Shape } from '../../model/match/match';
import type { Gem } from '../../model/match/sim';

/**
 * A match-3 board: its cells (with jelly), and the gems on them if given.
 * A line gem shows a stripe its way, a bomb a ring. Clicking a cell reports
 * it; pressing and dragging reports each cell, for painting.
 */
export const MatchBoard = ({ shape, gems, jelly = shape.jelly, selected = -1, flash = [], onCell, onPaint, label, className = '' }: { shape: Shape; gems?: (Gem | null)[]; jelly?: boolean[]; selected?: number; flash?: number[]; onCell?: (i: number) => void; onPaint?: (i: number) => void; label: string; className?: string }) => {
  const lit = new Set(flash);
  const paint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPaint || e.buttons !== 1) return;
    const el = e.currentTarget;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()?.inverse());
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x >= 0 && y >= 0 && x < shape.cols && y < shape.rows) onPaint(y * shape.cols + x);
  };
  return (
    <svg className={`m3-board${onPaint ? ' paint' : ''} ${className}`.trim()} viewBox={`-0.05 -0.05 ${shape.cols + 0.1} ${shape.rows + 0.1}`} role="img" aria-label={label} onPointerDown={paint} onPointerMove={paint}>
      {shape.cell.map((on, i) => {
        const x = i % shape.cols;
        const y = Math.floor(i / shape.cols);
        const gem = gems?.[i];
        return (
          <g key={i} data-cell={i} onClick={onCell ? () => onCell(i) : undefined} className={onCell && on ? 'm3-cell-hit' : undefined}>
            <rect x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} rx={0.12} className={on ? (jelly[i] ? 'm3-jelly' : 'm3-cell') : 'm3-hole'} />
            {lit.has(i) ? <rect x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} rx={0.12} className="m3-flash" /> : null}
            {on && gem ? (
              <g className={`m3-gem${selected === i ? ' on' : ''}`}>
                <circle cx={x + 0.5} cy={y + 0.5} r={0.36} fill={GEM_HUES[gem.c] ?? '#888'} />
                {gem.s === 1 ? <rect x={x + 0.16} y={y + 0.44} width={0.68} height={0.12} className="m3-mark" /> : null}
                {gem.s === 2 ? <rect x={x + 0.44} y={y + 0.16} width={0.12} height={0.68} className="m3-mark" /> : null}
                {gem.s === 3 ? <circle cx={x + 0.5} cy={y + 0.5} r={0.18} className="m3-bomb" /> : null}
              </g>
            ) : null}
            {selected === i ? <rect x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} rx={0.14} className="m3-sel" /> : null}
          </g>
        );
      })}
    </svg>
  );
};
