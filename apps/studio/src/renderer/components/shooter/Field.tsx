import type { ReactNode } from 'react';
import { FIELD } from '../../model/shooter/shooter';

/** An invader's colour, by its place in the list. */
export const invaderHue = (index: number) => `hsl(${(index * 97 + 330) % 360} 60% 62%)`;

/** The arcade shooter's playfield, in field units: what is on it is drawn by whoever uses it. */
export const Field = ({ children, label }: { children?: ReactNode; label: string }) => (
  <svg className="sht-field" viewBox={`0 0 ${FIELD.width} ${FIELD.height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
    <rect x={0} y={0} width={FIELD.width} height={FIELD.height} className="sht-space" />
    <line x1={0} x2={FIELD.width} y1={FIELD.shipY + 0.45} y2={FIELD.shipY + 0.45} className="sht-ground" />
    {children}
  </svg>
);

/** An invader, drawn as a little blocky sprite centred on x, y. */
export const InvaderShape = ({ x, y, fill, hurt = 1 }: { x: number; y: number; fill: string; hurt?: number }) => (
  <g transform={`translate(${x} ${y})`} className="sht-invader" opacity={0.45 + 0.55 * hurt}>
    <rect x={-0.35} y={-0.2} width={0.7} height={0.32} rx={0.06} fill={fill} />
    <rect x={-0.42} y={0.04} width={0.14} height={0.22} fill={fill} />
    <rect x={0.28} y={0.04} width={0.14} height={0.22} fill={fill} />
    <rect x={-0.2} y={-0.32} width={0.08} height={0.14} fill={fill} />
    <rect x={0.12} y={-0.32} width={0.08} height={0.14} fill={fill} />
    <rect x={-0.18} y={-0.1} width={0.1} height={0.1} className="sht-eye" />
    <rect x={0.08} y={-0.1} width={0.1} height={0.1} className="sht-eye" />
  </g>
);

export const ShipShape = ({ x, blink = false }: { x: number; blink?: boolean }) => (
  <g transform={`translate(${x} ${FIELD.shipY})`} className={`sht-ship${blink ? ' blink' : ''}`}>
    <path d="M -0.5 0.3 L 0.5 0.3 L 0.5 0.05 L 0.12 0.05 L 0.06 -0.3 L -0.06 -0.3 L -0.12 0.05 L -0.5 0.05 Z" />
  </g>
);
