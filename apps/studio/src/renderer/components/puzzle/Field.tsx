import { useEffect, useState } from 'react';

/** A text field that commits when you leave it, so a paragraph is one undo step. */
export const Field = ({ label, value, onCommit, multiline, rows = 3, placeholder, hint }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; rows?: number; placeholder?: string; hint?: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="pz-field">
      <span className="pz-label">{label}</span>
      {multiline ? (
        <textarea className="inp" aria-label={label} rows={rows} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input className="inp" aria-label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      )}
      {hint && <span className="pref-hint">{hint}</span>}
    </label>
  );
};
