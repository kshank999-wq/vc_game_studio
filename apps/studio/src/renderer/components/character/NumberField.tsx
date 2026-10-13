import { useEffect, useState } from 'react';

/** A number with its unit that commits when you leave it, kept within its range. */
export const NumberField = ({ label, unit, min, max, step, value, onCommit, bare }: { label: string; unit: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void; bare?: boolean }) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value));
    const v = Math.min(max, Math.max(min, n));
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  const input = (
    <span className="cc-num">
      <input className="inp" type="number" aria-label={label} min={min} max={max} step={step} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      {unit && <span className="cc-unit">{unit}</span>}
    </span>
  );
  if (bare) return input;
  return (
    <label className="pz-field">
      <span className="pz-label">{label}</span>
      {input}
    </label>
  );
};
