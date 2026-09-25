import type { ObjectType } from '../model/types';

/**
 * The symbol for each element type (HANDOFF fixed mapping). Shape carries the
 * meaning as well as colour, so every type is distinct in greyscale.
 */
const FILL: Partial<Record<ObjectType, string>> = {
  plotPoint: 'var(--gold)',
  scene: 'var(--c-scene)',
  cinematic: 'var(--c-cinematic)',
  choice: 'var(--c-choice)',
  dialogue: 'var(--c-dialogue)',
  character: 'var(--c-character)',
  object: 'var(--c-object)',
  environment: 'var(--c-environment)',
  inventory: 'var(--c-inventory)',
  puzzle: 'var(--c-puzzle)',
  trigger: 'var(--c-logic)',
  gate: 'var(--c-logic)',
  state: 'var(--c-logic)',
  arcEvent: 'var(--c-character)',
  begin: 'var(--gold)',
  end: 'var(--gold)',
};

export const Symbol = ({ type, size = 14, color }: { type: ObjectType; size?: number; color?: string }) => {
  const fill = color ?? FILL[type] ?? 'var(--muted)';
  const svg = (children: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="symbol">
      {children}
    </svg>
  );
  switch (type) {
    case 'plotPoint':
      return svg(<rect x="6.5" y="1.5" width="3" height="13" rx="1" fill={fill} />);
    case 'scene':
      return svg(<rect x="1.5" y="3" width="13" height="10" rx="3" fill={fill} />);
    case 'cinematic':
      return svg(
        <>
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill={fill} />
          <path d="M4.5 3v10M11.5 3v10" stroke="var(--panel)" strokeWidth="1.3" />
        </>,
      );
    case 'choice':
      return svg(<circle cx="8" cy="8" r="6" fill={fill} />);
    case 'dialogue':
      return svg(<path d="M2 3h12v8H7.5L4.5 14v-3H2z" fill={fill} />);
    case 'character':
      return svg(<path d="M8 2l6.5 11.5h-13z" fill={fill} />);
    case 'object':
      return svg(<rect x="2.5" y="2.5" width="11" height="11" rx="1" fill={fill} />);
    case 'environment':
      return svg(<path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" fill={fill} />);
    case 'inventory':
      return svg(<path d="M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3L1.8 6.3l4.3-.5z" fill={fill} />);
    case 'puzzle':
      return svg(<path d="M3 3h3.6a1.7 1.7 0 113 0H13v3.6a1.7 1.7 0 110 3V13H3z" fill={fill} />);
    case 'trigger':
      return svg(
        <>
          <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" fill="none" stroke={fill} strokeWidth="1.6" />
          <path d="M8.8 4.5L6.5 8.5h3l-2.3 3" fill="none" stroke={fill} strokeWidth="1.3" />
        </>,
      );
    case 'gate':
      return svg(
        <>
          <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" fill="none" stroke={fill} strokeWidth="1.6" />
          <path d="M5 8h6" stroke={fill} strokeWidth="2" />
        </>,
      );
    case 'state':
      return svg(
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke={fill} strokeWidth="1.5" />
          <path d="M8 5v6M5 8h6" stroke={fill} strokeWidth="1.5" />
        </>,
      );
    case 'arcEvent':
      return svg(
        <>
          <path d="M1 8h14" stroke={fill} strokeWidth="1.6" />
          <circle cx="8" cy="8" r="3.4" fill={fill} />
        </>,
      );
    case 'begin':
    case 'end':
      return <LockIcon size={size} />;
  }
};

export const LockIcon = ({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1" />
    <path d="M5 7V5a3 3 0 016 0v2" />
  </svg>
);

export const UnlockIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1" />
    <path d="M5 7V5a3 3 0 015.8-1" />
  </svg>
);

export const EyeIcon = ({ size = 14, open = true }: { size?: number; open?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
    {!open && <path d="M2 14L14 2" />}
  </svg>
);
