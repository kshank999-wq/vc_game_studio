import { useId, type ReactNode } from 'react';
import type { Cell, DefenseGame } from '../../model/defense/defense';

/**
 * The castle defense map, a cell a unit: grass, the path from where enemies
 * come in to the castle, and the build spots. Clicking a cell reports it;
 * what is on top (towers, enemies, shots) is drawn by whoever uses it.
 */
export const Board = ({ game, onCell, onSpot, children, label }: { game: DefenseGame; onCell?: (cell: Cell) => void; onSpot?: (index: number) => void; children?: ReactNode; label: string }) => {
  const { cols, rows, path, spots } = game.map;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  const onPath = new Map(path.map((p, i) => [`${p[0]},${p[1]}`, i]));
  const first = path[0];
  const last = path[path.length - 1];
  // Tower ranges and shots stay on the board.
  const clip = useId();
  return (
    <svg className="dfn-board" viewBox={`-0.1 -0.1 ${cols + 0.2} ${rows + 0.2}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {cells.map(([c, r]) => {
        const i = onPath.get(`${c},${r}`);
        return (
          <rect
            key={`${c},${r}`}
            x={c}
            y={r}
            width={1}
            height={1}
            className={i !== undefined ? 'dfn-path' : 'dfn-grass'}
            data-cell={`${c},${r}`}
            onClick={onCell ? () => onCell([c, r]) : undefined}
          />
        );
      })}
      {path.length > 1 && <polyline className="dfn-path-line" points={path.map(([c, r]) => `${c + 0.5},${r + 0.5}`).join(' ')} />}
      {spots.map(([c, r], i) => (
        <rect key={`s${i}`} x={c + 0.12} y={r + 0.12} width={0.76} height={0.76} rx={0.1} className="dfn-spot" data-spot={i} onClick={onSpot ? () => onSpot(i) : onCell ? () => onCell([c, r]) : undefined} />
      ))}
      {first && (
        <text x={first[0] + 0.5} y={first[1] + 0.62} className="dfn-mark" textAnchor="middle">
          IN
        </text>
      )}
      {last && path.length > 1 && (
        <g className="dfn-castle" pointerEvents="none">
          <rect x={last[0] + 0.15} y={last[1] + 0.15} width={0.7} height={0.7} rx={0.05} />
          <text x={last[0] + 0.5} y={last[1] + 0.62} textAnchor="middle">
            ♜
          </text>
        </g>
      )}
      <clipPath id={clip}>
        <rect x={0} y={0} width={cols} height={rows} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>{children}</g>
    </svg>
  );
};
