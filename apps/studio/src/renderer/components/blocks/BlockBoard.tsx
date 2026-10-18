import { useRef } from 'react';
import type { Board } from '../../model/blocks/blocks';

/**
 * A puzzle level drawn on its grid: walls, floor, targets, the crates and
 * the player. With onCell, pressing and dragging over cells reports each,
 * for painting.
 */
export const BlockBoard = ({ board, crates = board.crates, player = board.player, onCell, label, className = '' }: { board: Board; crates?: readonly number[]; player?: number; onCell?: (i: number, first: boolean) => void; label: string; className?: string }) => {
  const down = useRef(false);
  const last = useRef(-1);
  const cellAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.currentTarget;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()?.inverse());
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < board.cols && y < board.rows ? y * board.cols + x : -1;
  };
  const on = new Set(crates);
  return (
    <svg
      className={`blk-board${onCell ? ' paint' : ''} ${className}`.trim()}
      viewBox={`-0.05 -0.05 ${board.cols + 0.1} ${board.rows + 0.1}`}
      role="img"
      aria-label={label}
      onPointerDown={
        onCell
          ? (e) => {
              const i = cellAt(e);
              down.current = true;
              last.current = i;
              if (i >= 0) onCell(i, true);
            }
          : undefined
      }
      onPointerMove={
        onCell
          ? (e) => {
              if (!down.current) return;
              const i = cellAt(e);
              if (i >= 0 && i !== last.current) {
                last.current = i;
                onCell(i, false);
              }
            }
          : undefined
      }
      onPointerUp={() => (down.current = false)}
      onPointerLeave={() => (down.current = false)}
    >
      {board.tiles.map((t, i) => {
        const x = i % board.cols;
        const y = Math.floor(i / board.cols);
        return (
          <g key={i} data-cell={i}>
            <rect x={x} y={y} width={1} height={1} className={`blk-${t}`} />
            {t === 'target' ? <circle cx={x + 0.5} cy={y + 0.5} r={0.16} className="blk-target-dot" /> : null}
          </g>
        );
      })}
      {[...on].map((i) => {
        const x = i % board.cols;
        const y = Math.floor(i / board.cols);
        return <rect key={`c${i}`} x={x + 0.12} y={y + 0.12} width={0.76} height={0.76} rx={0.1} className={`blk-crate${board.tiles[i] === 'target' ? ' home' : ''}`} />;
      })}
      {player >= 0 ? <circle cx={(player % board.cols) + 0.5} cy={Math.floor(player / board.cols) + 0.5} r={0.32} className="blk-player" /> : null}
    </svg>
  );
};
