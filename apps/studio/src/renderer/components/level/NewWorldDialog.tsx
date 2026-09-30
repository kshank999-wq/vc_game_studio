import { useState } from 'react';
import { WORLD_PRESETS, type WorldPreset } from '../../model/level/hierarchy';
import type { LevelSettings } from '../../model/level/types';
import { formatLength, fromDisplay, toDisplay, unitLabel } from './units';

export interface NewWorld {
  preset: WorldPreset['id'];
  name: string;
  width?: number;
  depth?: number;
  grid?: number;
  origin?: { x: number; y: number };
}

/**
 * Start a world (spec V2 §3): a preset to begin from, each editable, or a size
 * of your own with its grid and origin. Nothing here is an engine limit.
 */
export const NewWorldDialog = ({ units, onCreate, onClose }: { units: LevelSettings['units']; onCreate: (w: NewWorld) => void; onClose: () => void }) => {
  const [preset, setPreset] = useState<WorldPreset['id']>('small');
  const p = WORLD_PRESETS.find((x) => x.id === preset)!;
  const km = (m: number) => Math.round((units === 'ft' ? m / 1609.344 : m / 1000) * 1000) / 1000;
  const fromKm = (v: number) => (units === 'ft' ? v * 1609.344 : v * 1000);
  const big = units === 'ft' ? 'mi' : 'km';
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [grid, setGrid] = useState<number | null>(null);
  const [ox, setOx] = useState(0);
  const [oy, setOy] = useState(0);
  const w = width ?? p.size;
  const d = depth ?? width ?? p.size;
  const g = grid ?? p.grid;
  const create = () => onCreate({ preset, name: name.trim() || 'World', width: w, depth: d, grid: g, ...(ox || oy ? { origin: { x: ox, y: oy } } : {}) });
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form
        className="dialog lvl-world-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New world"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="dialog-head">
          <h2>New world</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">Start big: place regions and destinations on the world map, then open each to work closer in. You can change the size later.</p>
        <label className="dfld">
          <span>Name</span>
          <input className="inp" aria-label="World name" placeholder="e.g. The Drowned Coast" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="lvl-world-presets" role="radiogroup" aria-label="Size">
          {WORLD_PRESETS.map((x) => (
            <label key={x.id} className={`lvl-world-preset${preset === x.id ? ' on' : ''}`}>
              <input
                type="radio"
                name="world-size"
                checked={preset === x.id}
                onChange={() => {
                  setPreset(x.id);
                  setWidth(null);
                  setDepth(null);
                  setGrid(null);
                }}
              />
              <strong>{x.label}</strong>
              <span className="muted">{x.id === 'custom' ? 'your own size, grid and origin' : `${formatLength(x.size, units)} × ${formatLength(x.size, units)}`}</span>
              <span className="pref-hint">{x.use}</span>
            </label>
          ))}
        </div>
        <div className="lvl-world-size">
          <label className="dfld">
            <span>Width ({big})</span>
            <input className="inp small" type="number" min={0.001} step={0.1} aria-label="Width" value={km(w)} onChange={(e) => setWidth(Math.max(1, fromKm(Number(e.target.value) || 0)))} />
          </label>
          <label className="dfld">
            <span>Depth ({big})</span>
            <input className="inp small" type="number" min={0.001} step={0.1} aria-label="Depth" value={km(d)} onChange={(e) => setDepth(Math.max(1, fromKm(Number(e.target.value) || 0)))} />
          </label>
          <label className="dfld">
            <span>Grid ({unitLabel(units)})</span>
            <input className="inp small" type="number" min={0.01} step={1} aria-label="Grid" value={toDisplay(g, units)} onChange={(e) => setGrid(Math.max(0.01, fromDisplay(Number(e.target.value) || 0, units)))} />
          </label>
          {preset === 'custom' && (
            <>
              <label className="dfld">
                <span>Origin east ({unitLabel(units)})</span>
                <input className="inp small" type="number" step={1} aria-label="Origin east" value={toDisplay(ox, units)} onChange={(e) => setOx(fromDisplay(Number(e.target.value) || 0, units))} />
              </label>
              <label className="dfld">
                <span>Origin south ({unitLabel(units)})</span>
                <input className="inp small" type="number" step={1} aria-label="Origin south" value={toDisplay(oy, units)} onChange={(e) => setOy(fromDisplay(Number(e.target.value) || 0, units))} />
              </label>
            </>
          )}
        </div>
        <p className="pref-hint">
          {formatLength(w, units)} × {formatLength(d, units)}, a {formatLength(g, units)} grid. Units are the project’s ({units === 'ft' ? 'feet' : 'metres'}); change them under Units, grid and names.
        </p>
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="tb-btn primary" onClick={(e) => {
            e.preventDefault();
            create();
          }}>
            Create world
          </button>
        </div>
      </form>
    </div>
  );
};
