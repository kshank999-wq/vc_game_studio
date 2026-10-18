import { HEIGHTS, cellAt, chunkLength, type Chunk } from '../../model/runner/runner';

/**
 * A chunk of track side on: its cells (solid and coins) at four heights over
 * the ground, the ground with its pits, and, if given, the way through the
 * solver found. Pressing and dragging over cells reports each, for painting;
 * the ground row is height -1.
 */
export const ChunkStrip = ({ chunk, way, onPaint, label, className = '' }: { chunk: Chunk; way?: [number, number][] | null; onPaint?: (x: number, h: number) => void; label: string; className?: string }) => {
  const len = chunkLength(chunk);
  const top = HEIGHTS;
  // y in the drawing: 0 at the top of height 3, ground row from top to top + 1.
  const paint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPaint || e.buttons !== 1) return;
    const el = e.currentTarget;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()?.inverse());
    const x = Math.floor(p.x);
    const row = Math.floor(p.y);
    if (x < 0 || x >= len || row < 0 || row > top) return;
    onPaint(x, top - 1 - row);
  };
  return (
    <svg className={`run-strip${onPaint ? ' paint' : ''} ${className}`.trim()} viewBox={`-0.05 -0.05 ${len + 0.1} ${top + 1.1}`} role="img" aria-label={label} onPointerDown={paint} onPointerMove={paint}>
      <rect x={0} y={0} width={len} height={top} className="run-sky" />
      {Array.from({ length: len }, (_, x) => (
        <g key={x}>
          {Array.from({ length: HEIGHTS }, (_, h) => {
            const c = cellAt(chunk, x, h);
            const y = top - 1 - h;
            return c === 'solid' ? <rect key={h} x={x + 0.02} y={y + 0.02} width={0.96} height={0.96} rx={0.08} className="run-solid" /> : c === 'coin' ? <circle key={h} cx={x + 0.5} cy={y + 0.5} r={0.22} className="run-coin" /> : <rect key={h} x={x} y={y} width={1} height={1} className="run-cell" />;
          })}
          {cellAt(chunk, x, -1) === 'solid' ? <rect x={x} y={top} width={1} height={1} className="run-ground" /> : <rect x={x} y={top} width={1} height={1} className="run-pit" />}
        </g>
      ))}
      {way?.length ? <polyline points={way.map(([x, y]) => `${x},${top - y}`).join(' ')} className="run-way" /> : null}
    </svg>
  );
};
