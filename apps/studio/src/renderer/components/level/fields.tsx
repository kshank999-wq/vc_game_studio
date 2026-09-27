import { useEffect, useState } from 'react';
import type { ObjectType, Project } from '../../model/types';
import { TYPE_LABEL } from '../../model/semantics';
import { fromDisplay, toDisplay, unitLabel } from './units';
import type { LevelSettings } from '../../model/level/types';

/**
 * Inspector fields. Each commits once, when you leave it or press Enter, so a
 * typed number is one undo step. An inherited value shows muted; a changed
 * one shows a reset that puts back the library's value.
 */

export const Reset = ({ onReset, label }: { onReset?: () => void; label: string }) =>
  onReset ? (
    <button className="lvl-reset" title="Reset to the library’s value" aria-label={`Reset ${label}`} onClick={onReset}>
      ↺
    </button>
  ) : null;

interface Base {
  label: string;
  overridden?: boolean;
  onReset?: () => void;
  hint?: string;
  disabled?: boolean;
}

export const FieldLabel = ({ label, overridden, onReset, hint }: Base) => (
  <span className="lvl-flabel" title={hint}>
    {label}
    {overridden && <span className="lvl-changed" title="Changed from the library">•</span>}
    {overridden && <Reset onReset={onReset} label={label} />}
  </span>
);

export const NumberField = ({
  value,
  onCommit,
  unit,
  units,
  step,
  min,
  max,
  ...base
}: Base & { value: number; onCommit: (v: number) => void; unit?: string; units?: LevelSettings['units']; step?: number; min?: number; max?: number }) => {
  const length = unit === 'length' && units;
  const shown = length ? toDisplay(value, units) : Math.round(value * 1000) / 1000;
  const [draft, setDraft] = useState(String(shown));
  useEffect(() => setDraft(String(shown)), [shown]);
  const commit = () => {
    const n = Number(draft.replace(',', '.'));
    if (!Number.isFinite(n) || draft.trim() === '') {
      setDraft(String(shown));
      return;
    }
    let v = length ? fromDisplay(n, units) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    else setDraft(String(shown));
  };
  const suffix = length ? unitLabel(units) : unit === 'deg' ? '°' : unit === 's' ? 's' : unit === 'percent' ? '%' : '';
  return (
    <label className={`lvl-field${base.overridden ? ' changed' : ''}`}>
      <FieldLabel {...base} />
      <span className="lvl-num">
        <input
          className="inp small"
          inputMode="decimal"
          aria-label={base.label}
          value={draft}
          step={step}
          disabled={base.disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(String(shown));
              e.currentTarget.blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const s = (step ?? 1) * (e.shiftKey ? 10 : 1);
              const n = Number(draft) + (e.key === 'ArrowUp' ? s : -s);
              setDraft(String(Math.round(n * 1000) / 1000));
            }
          }}
        />
        {suffix && <span className="lvl-unit">{suffix}</span>}
      </span>
    </label>
  );
};

export const TextField = ({ value, onCommit, placeholder, ...base }: Base & { value: string; onCommit: (v: string) => void; placeholder?: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className={`lvl-field wide${base.overridden ? ' changed' : ''}`}>
      <FieldLabel {...base} />
      <input
        className="inp small"
        aria-label={base.label}
        value={draft}
        placeholder={placeholder}
        disabled={base.disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
};

export const BoolField = ({ value, onCommit, ...base }: Base & { value: boolean; onCommit: (v: boolean) => void }) => (
  <label className={`lvl-field check${base.overridden ? ' changed' : ''}`}>
    <input type="checkbox" checked={value} disabled={base.disabled} onChange={(e) => onCommit(e.target.checked)} aria-label={base.label} />
    <FieldLabel {...base} />
  </label>
);

export const SelectField = ({ value, options, onCommit, ...base }: Base & { value: string; options: readonly (string | { value: string; label: string })[]; onCommit: (v: string) => void }) => (
  <label className={`lvl-field${base.overridden ? ' changed' : ''}`}>
    <FieldLabel {...base} />
    <select className="inp small" value={value} aria-label={base.label} disabled={base.disabled} onChange={(e) => onCommit(e.target.value)}>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  </label>
);

/** A story element of the given types, grouped by type. */
export const RefField = ({ project, value, types, onCommit, ...base }: Base & { project: Project; value: string; types: readonly ObjectType[]; onCommit: (v: string) => void }) => {
  const missing = value && !project.objects[value];
  return (
    <label className={`lvl-field wide${base.overridden ? ' changed' : ''}${missing ? ' broken' : ''}`}>
      <FieldLabel {...base} />
      <select className="inp small" value={value} aria-label={base.label} onChange={(e) => onCommit(e.target.value)}>
        <option value="">— none —</option>
        {missing && <option value={value}>(deleted)</option>}
        {types.map((t) => {
          const objects = Object.values(project.objects).filter((o) => o.type === t).sort((a, b) => a.name.localeCompare(b.name));
          if (!objects.length) return null;
          return (
            <optgroup key={t} label={TYPE_LABEL[t]}>
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {`${o.data.code ? `${String(o.data.code)} ` : ''}${o.name}`}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
};

/** One collapsible inspector section; a search hides it unless something in it matches. */
export const Section = ({ title, open, onToggle, children, count }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode; count?: number }) => (
  <section className={`lvl-sec${open ? ' open' : ''}`}>
    <button className="lvl-sec-head" aria-expanded={open} onClick={onToggle}>
      <span className="lvl-sec-caret">{open ? '▾' : '▸'}</span>
      {title}
      {count ? <span className="lvl-count">{count}</span> : null}
    </button>
    {open && <div className="lvl-sec-body">{children}</div>}
  </section>
);
