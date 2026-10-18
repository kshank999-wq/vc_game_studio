import { useEffect, useState } from 'react';

/** A number that commits when you leave it or press Enter, so typing is one undo step. */
export const Num = ({ label, value, onCommit, min, max, step = 1, suffix, title }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; title?: string }) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let v = Number(draft);
    if (!Number.isFinite(v)) return setDraft(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <label className="dfn-num" title={title}>
      <span>
        {label}
        {suffix ? <em> · {suffix}</em> : null}
      </span>
      <input className="inp small" type="number" inputMode="decimal" step={step} min={min} max={max} value={draft} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
};

/** Text that commits when you leave it. */
export const Text = ({ label, value, onCommit, placeholder, area = false }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; area?: boolean }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <label className="dfn-text">
      <span>{label}</span>
      {area ? (
        <textarea className="inp" rows={3} value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input className="inp small" value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </label>
  );
};
