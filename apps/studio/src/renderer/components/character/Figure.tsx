import type { Placeholder } from '../../model/character/profile';

/**
 * The placeholder dummy (Character Creator spec §8): a simple silhouette in
 * the character's tint, with its label and a primitive prop in hand. The
 * same proportions stand in on the 2D map and in the 3D graybox, so final
 * art swaps in later without moving the collider or the hand socket.
 */
export const Figure = ({ placeholder, height = 160, title }: { placeholder: Placeholder; height?: number; title?: string }) => {
  const { silhouette: s, tint, label, prop } = placeholder;
  const w = Math.round((height * 100) / 160);
  const dark = 'rgba(0,0,0,0.28)';
  const body = (() => {
    switch (s) {
      case 'beast':
        return (
          <>
            <ellipse cx="50" cy="96" rx="34" ry="16" fill={tint} />
            <circle cx="84" cy="80" r="11" fill={tint} />
            {[24, 36, 64, 76].map((x) => (
              <rect key={x} x={x - 3} y="104" width="6" height="30" rx="3" fill={tint} />
            ))}
            <path d="M16 92 Q4 84 8 74" stroke={tint} strokeWidth="5" fill="none" strokeLinecap="round" />
          </>
        );
      case 'flyer':
        return (
          <>
            <path d="M50 70 L8 50 L20 86 Z M50 70 L92 50 L80 86 Z" fill={tint} opacity="0.7" />
            <ellipse cx="50" cy="82" rx="12" ry="22" fill={tint} />
            <circle cx="50" cy="52" r="10" fill={tint} />
            <rect x="44" y="102" width="4" height="20" rx="2" fill={tint} />
            <rect x="52" y="102" width="4" height="20" rx="2" fill={tint} />
          </>
        );
      default: {
        const wide = s === 'stocky' ? 1.35 : s === 'slender' ? 0.8 : 1;
        const small = s === 'small' ? 0.72 : 1;
        const t = (v: number) => 152 - (152 - v) * small;
        const bw = 26 * wide;
        return (
          <>
            <circle cx="50" cy={t(30)} r={12 * small} fill={tint} />
            <rect x={50 - bw / 2} y={t(46)} width={bw} height={50 * small} rx={8} fill={tint} />
            <rect x={50 - bw / 2 - 9} y={t(48)} width="8" height={44 * small} rx="4" fill={tint} />
            <rect x={50 + bw / 2 + 1} y={t(48)} width="8" height={44 * small} rx="4" fill={tint} />
            <rect x={50 - 11 * wide} y={t(94)} width={9 * wide} height={56 * small} rx="4" fill={tint} />
            <rect x={50 + 2 * wide} y={t(94)} width={9 * wide} height={56 * small} rx="4" fill={tint} />
            <rect x={50 - bw / 2} y={t(70)} width={bw} height="4" fill={dark} />
          </>
        );
      }
    }
  })();
  // The hand socket: right hand of a humanoid, the mouth of a beast.
  const hand = s === 'beast' ? { x: 90, y: 86 } : s === 'flyer' ? { x: 62, y: 96 } : { x: 50 + (26 * (s === 'stocky' ? 1.35 : s === 'slender' ? 0.8 : 1)) / 2 + 5, y: s === 'small' ? 108 : 92 };
  const propShape =
    prop === 'sword' ? (
      <g>
        <rect x={hand.x - 1.5} y={hand.y - 44} width="3" height="40" fill="#d8dde3" />
        <rect x={hand.x - 7} y={hand.y - 6} width="14" height="3" fill="#8a6a3a" />
      </g>
    ) : prop === 'shield' ? (
      <path d={`M${hand.x - 14} ${hand.y - 18} h28 v14 q0 14 -14 20 q-14 -6 -14 -20 Z`} fill="#8a7a5a" stroke="#d8dde3" strokeWidth="2" />
    ) : prop === 'bow' ? (
      <path d={`M${hand.x} ${hand.y - 30} Q${hand.x + 16} ${hand.y} ${hand.x} ${hand.y + 30}`} stroke="#8a6a3a" strokeWidth="3" fill="none" />
    ) : prop === 'staff' ? (
      <g>
        <rect x={hand.x - 1.5} y={hand.y - 50} width="3" height="90" fill="#8a6a3a" />
        <circle cx={hand.x} cy={hand.y - 52} r="5" fill="#9fd0ff" />
      </g>
    ) : null;
  return (
    <svg className="cc-figure" width={w} height={height} viewBox="0 0 100 160" role="img" aria-label={title ?? 'Placeholder figure'}>
      <ellipse cx="50" cy="154" rx="30" ry="4" fill="rgba(0,0,0,0.25)" />
      {body}
      {propShape}
      {label && (
        <text x="50" y={s === 'beast' ? 100 : 82} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" style={{ fontFamily: 'var(--font-label, sans-serif)', letterSpacing: '0.08em' }}>
          {label.slice(0, 6)}
        </text>
      )}
    </svg>
  );
};
