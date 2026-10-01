import { useEffect, useState } from 'react';
import { act, codeFor, screenKind, startScreen, type ScreenAction, type ScreenPuzzle, type ScreenState } from '../../model/puzzle/screens';
import type { Project } from '../../model/types';

const PIECE_SIDES: Record<string, number> = { empty: 0, end: 1, straight: 5, corner: 3, tee: 7, cross: 15 };

/** A circuit piece, drawn turned: a line from the middle to each side it joins. */
const Piece = ({ piece, rot, lit }: { piece: string; rot: number; lit: boolean }) => {
  let sides = PIECE_SIDES[piece] ?? 0;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) sides = ((sides << 1) | (sides >> 3)) & 15;
  const ends: [number, number][] = [
    [1, 0],
    [2, 1],
    [4, 2],
    [8, 3],
  ];
  const xy = [
    [20, 0],
    [40, 20],
    [20, 40],
    [0, 20],
  ];
  return (
    <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden>
      {ends
        .filter(([bit]) => sides & bit)
        .map(([bit, i]) => (
          <line key={bit} x1={20} y1={20} x2={xy[i]![0]} y2={xy[i]![1]} className={lit ? 'scr-wire lit' : 'scr-wire'} />
        ))}
      {sides !== 0 && <circle cx={20} cy={20} r={4} className={lit ? 'scr-wire-dot lit' : 'scr-wire-dot'} />}
    </svg>
  );
};

interface Props {
  project?: Project;
  screen: ScreenPuzzle;
  /** Shuffles alike for the same seed (the element's id). */
  seed: string;
  title: string;
  onRight?: () => void;
  onWrong?: () => void;
  onLeave?: () => void;
  /** Wrong answers already given (in play): a screen with a limit stays locked. */
  triesUsed?: number;
  /** The designer's preview: it can start again. */
  preview?: boolean;
}

/**
 * A screen puzzle as the player sees it (puzzle spec §8): the same component
 * previews it in the Puzzle Creator and plays it in the play-through and
 * Play Mode, with proxy art until the real art replaces it.
 */
export const ScreenPlayer = ({ project, screen: s, seed, title, onRight, onWrong, onLeave, triesUsed = 0, preview }: Props) => {
  const begin = (): ScreenState => ({ ...startScreen(s, seed), tries: triesUsed, locked: (s.attempts ?? 0) > 0 && triesUsed >= s.attempts! });
  const [st, setSt] = useState<ScreenState>(begin);
  const [pick, setPick] = useState<number | string | null>(null);
  // A change to the design starts it again.
  const key = JSON.stringify(s);
  useEffect(() => {
    setSt(begin());
    setPick(null);
  }, [key, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (a: ScreenAction) => {
    const r = act(project, s, st, a);
    setSt(r.state);
    if (r.outcome === 'right') onRight?.();
    if (r.outcome === 'wrong') onWrong?.();
  };
  const busy = st.solved || st.locked;
  const submit = (label = 'Enter') => (
    <button className="scr-go" disabled={busy} onClick={() => go({ type: 'submit' })}>
      {label}
    </button>
  );

  let body: React.ReactNode = null;
  switch (s.kind) {
    case 'keypad': {
      const length = codeFor(project, s).length || 4;
      body = (
        <>
          <div className="scr-display" aria-label="Display">
            {st.entry.join('').padEnd(length, '·')}
          </div>
          <div className="scr-keys" role="group" aria-label="Keys">
            {[...(s.keys ?? '1234567890')].map((k, i) => (
              <button key={`${k}${i}`} className="scr-key" disabled={busy} onClick={() => go({ type: 'press', key: k })}>
                {k}
              </button>
            ))}
          </div>
          <div className="scr-row">
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'clear' })}>
              Clear
            </button>
            {submit()}
          </div>
        </>
      );
      break;
    }
    case 'dial': {
      const n = Math.max(2, s.positions ?? 40);
      body = (
        <>
          <div className="scr-dial" aria-label={`Dial at ${st.dial}`}>
            <svg viewBox="-50 -50 100 100" width={140} height={140} aria-hidden>
              <circle r={44} className="scr-dial-face" />
              {Array.from({ length: n }, (_, i) => (
                <line key={i} x1={0} y1={-44} x2={0} y2={i % 5 ? -40 : -36} transform={`rotate(${(i - st.dial) * (360 / n)})`} className="scr-tick" />
              ))}
              <text y={6} textAnchor="middle" className="scr-dial-num">
                {st.dial}
              </text>
              <path d="M-4 -50 L4 -50 L0 -44 z" className="scr-pointer" />
            </svg>
          </div>
          <div className="scr-row">
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'turn', by: -1 })} aria-label="Turn left">
              ⟲
            </button>
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'turn', by: 1 })} aria-label="Turn right">
              ⟳
            </button>
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'set' })}>
              Set
            </button>
          </div>
          <div className="scr-display small" aria-label="Set so far">
            {st.entry.join(' – ') || '—'}
          </div>
          <div className="scr-row">
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'clear' })}>
              Clear
            </button>
            {submit('Pull the handle')}
          </div>
        </>
      );
      break;
    }
    case 'tiles': {
      const n = Math.max(2, s.size ?? 3);
      body = (
        <div className="scr-tiles" role="group" aria-label="Tiles" style={{ gridTemplateColumns: `repeat(${n}, 44px)` }}>
          {st.tiles.map((t, i) => (
            <button key={i} className={`scr-tile${t ? '' : ' gap'}`} disabled={busy || !t} aria-label={t ? `Tile ${t}` : 'Gap'} onClick={() => go({ type: 'slide', at: i })}>
              {t || ''}
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'symbols':
      body = (
        <>
          <div className="scr-display" aria-label="Pressed">
            {st.entry.join(' ') || '—'}
          </div>
          <div className="scr-keys" role="group" aria-label="Symbols">
            {(s.symbols ?? []).map((k, i) => (
              <button key={`${k}${i}`} className="scr-key" disabled={busy} onClick={() => go({ type: 'press', key: k })}>
                {k}
              </button>
            ))}
          </div>
          <div className="scr-row">
            <button className="scr-go soft" disabled={busy} onClick={() => go({ type: 'clear' })}>
              Clear
            </button>
            {submit()}
          </div>
        </>
      );
      break;
    case 'rings': {
      const n = Math.max(2, s.segments ?? 8);
      body = (
        <div className="scr-rings">
          <svg viewBox="-60 -60 120 120" width={170} height={170} aria-hidden>
            {st.rings.map((r, i) => {
              const radius = 54 - i * (40 / Math.max(1, st.rings.length));
              return (
                <g key={i} transform={`rotate(${(r * 360) / n})`}>
                  <circle r={radius} className="scr-ring" />
                  <circle cx={0} cy={-radius} r={4} className={r === 0 ? 'scr-mark lit' : 'scr-mark'} />
                </g>
              );
            })}
            <line x1={0} y1={-60} x2={0} y2={-8} className="scr-guide" />
          </svg>
          <div className="scr-ring-buttons">
            {st.rings.map((_, i) => (
              <div key={i} className="scr-row">
                <span className="muted">Ring {i + 1}</span>
                <button className="scr-go soft" disabled={busy} aria-label={`Turn ring ${i + 1} back`} onClick={() => go({ type: 'rotate', ring: i, by: -1 })}>
                  ⟲
                </button>
                <button className="scr-go soft" disabled={busy} aria-label={`Turn ring ${i + 1} on`} onClick={() => go({ type: 'rotate', ring: i, by: 1 })}>
                  ⟳
                </button>
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
    case 'circuit': {
      const w = Math.max(1, s.width ?? 3);
      body = (
        <div className="scr-circuit" role="group" aria-label="Circuit" style={{ gridTemplateColumns: `repeat(${w}, 42px)` }}>
          {(s.cells ?? []).map((c, i) => (
            <button
              key={i}
              className={`scr-cell${i === s.source ? ' source' : ''}${i === s.sink ? ' sink' : ''}`}
              disabled={busy || c.piece === 'empty' || i === s.source || i === s.sink}
              aria-label={`Cell ${i + 1}${i === s.source ? ', source' : i === s.sink ? ', sink' : ''}`}
              onClick={() => go({ type: 'spin', cell: i })}
            >
              <Piece piece={c.piece} rot={st.rot[i] ?? 0} lit={st.solved} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'assembly':
      body = (
        <>
          <div className="scr-parts" role="group" aria-label="Parts">
            {(s.parts ?? []).map((p) => {
              const used = Object.values(st.placed).includes(p.id);
              return (
                <button key={p.id} className={`scr-part${pick === p.id ? ' on' : ''}${used ? ' used' : ''}`} disabled={busy} aria-pressed={pick === p.id} onClick={() => setPick(pick === p.id ? null : p.id)}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="scr-slots" role="group" aria-label="Slots">
            {(s.slots ?? []).map((sl) => {
              const part = (s.parts ?? []).find((p) => p.id === st.placed[sl.id]);
              return (
                <button
                  key={sl.id}
                  className="scr-slot"
                  disabled={busy}
                  aria-label={`${sl.label}: ${part?.label ?? 'empty'}`}
                  onClick={() => {
                    go({ type: 'place', slot: sl.id, part: typeof pick === 'string' ? pick : null });
                    setPick(null);
                  }}
                >
                  <span className="muted">{sl.label}</span>
                  {part?.label ?? '—'}
                </button>
              );
            })}
          </div>
          <div className="scr-row">{submit('Try it')}</div>
        </>
      );
      break;
    case 'matching': {
      const pairs = s.pairs ?? [];
      body = (
        <>
          <div className="scr-match">
            <div className="scr-col" role="group" aria-label="Left">
              {pairs.map((p, i) => (
                <button key={i} className={`scr-part${pick === i ? ' on' : ''}${st.matched[i] !== undefined ? ' used' : ''}`} disabled={busy} aria-pressed={pick === i} onClick={() => setPick(pick === i ? null : i)}>
                  {p.left}
                  {st.matched[i] !== undefined && <span className="muted"> → {pairs[st.matched[i]!]!.right}</span>}
                </button>
              ))}
            </div>
            <div className="scr-col" role="group" aria-label="Right">
              {st.shown.map((j) => (
                <button
                  key={j}
                  className={`scr-part${Object.values(st.matched).includes(j) ? ' used' : ''}`}
                  disabled={busy || typeof pick !== 'number'}
                  onClick={() => {
                    if (typeof pick === 'number') go({ type: 'match', left: pick, right: j });
                    setPick(null);
                  }}
                >
                  {pairs[j]!.right}
                </button>
              ))}
            </div>
          </div>
          <div className="scr-row">{submit('Check')}</div>
        </>
      );
      break;
    }
    case 'ordering':
      body = (
        <>
          <ol className="scr-order" aria-label="Order">
            {st.order.map((x, i) => (
              <li key={x}>
                <span>{s.items?.[x]}</span>
                <button className="icon-btn small" disabled={busy || i === 0} aria-label={`Move ${s.items?.[x]} up`} onClick={() => go({ type: 'move', at: i, by: -1 })}>
                  ↑
                </button>
                <button className="icon-btn small" disabled={busy || i === st.order.length - 1} aria-label={`Move ${s.items?.[x]} down`} onClick={() => go({ type: 'move', at: i, by: 1 })}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <div className="scr-row">{submit('Check')}</div>
        </>
      );
      break;
    case 'levers':
      body = (
        <div className="scr-levers" role="group" aria-label="Switches">
          {(s.switches ?? []).map((label, i) => (
            <button key={i} className={`scr-lever${st.on[i] ? ' on' : ''}`} disabled={busy} aria-pressed={!!st.on[i]} aria-label={`Switch ${label}`} onClick={() => go({ type: 'flip', switch: i })}>
              <span className="scr-lever-arm" />
              {label}
            </button>
          ))}
        </div>
      );
      break;
    case 'custom':
      body = (
        <>
          <input className="inp" aria-label="Answer" value={st.text} disabled={busy} onChange={(e) => go({ type: 'type', text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && go({ type: 'submit' })} />
          <div className="scr-row">{submit()}</div>
        </>
      );
      break;
  }

  return (
    <div className={`scr scr-${s.kind}${st.solved ? ' solved' : ''}${st.locked ? ' locked' : ''}`} role="dialog" aria-label={`${title} screen`}>
      <div className="scr-head">
        <span className="scr-title">
          {screenKind(s.kind).icon} {title}
        </span>
        {s.art && <span className="muted" title="The art that replaces this proxy">art: {s.art}</span>}
      </div>
      {s.prompt && <p className="scr-prompt">{s.prompt}</p>}
      {body}
      <p className={`scr-message${st.solved ? ' right' : st.message ? ' wrong' : ''}`} role="status">
        {st.message ?? (st.locked ? 'It won’t take another try.' : st.tries ? `${st.tries} wrong${s.attempts ? ` of ${s.attempts}` : ''}` : ' ')}
      </p>
      <div className="scr-row">
        {preview && (
          <button className="tb-btn small" onClick={() => go({ type: 'reset', seed })}>
            Start again
          </button>
        )}
        {onLeave && (
          <button className="tb-btn small" onClick={onLeave}>
            {st.solved ? 'Close' : 'Leave'}
          </button>
        )}
      </div>
    </div>
  );
};
