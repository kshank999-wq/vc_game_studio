import { useState } from 'react';
import { HALLWAY_WIDTHS } from '../../model/level/hallway';
import type { LevelSettings } from '../../model/level/types';
import { fromDisplay, toDisplay, unitLabel } from './units';

/**
 * How wide a hallway is, asked when the Hallway tool is picked: 4 ft or
 * 8 ft, or any width in the map's units. Then click along where it runs.
 */
export const HallwayDialog = ({ width, units, onPick, onClose }: { width: number; units: LevelSettings['units']; onPick: (metres: number) => void; onClose: () => void }) => {
  const preset = HALLWAY_WIDTHS.find((w) => Math.abs(w.metres - width) < 0.01);
  const [choice, setChoice] = useState<string>(preset ? preset.label : 'custom');
  const [custom, setCustom] = useState(() => String(toDisplay(width, units)));
  const metres = choice === 'custom' ? fromDisplay(Number(custom), units) : HALLWAY_WIDTHS.find((w) => w.label === choice)!.metres;
  const ok = Number.isFinite(metres) && metres >= 0.5 && metres <= 30;
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form
        className="dialog lvl-hall-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Hallway width"
        // Its own check (the width box may hold 2.44 m, between the browser's steps).
        noValidate
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onPick(metres);
        }}
      >
        <div className="dialog-head">
          <h2>Draw a hallway</h2>
        </div>
        <p className="muted">Click along where it runs (it goes straight along or across the map), then press Enter or double-click to finish. Esc drops it.</p>
        <fieldset className="lvl-hall-widths">
          <legend>How wide</legend>
          {HALLWAY_WIDTHS.map((w) => (
            <label key={w.label}>
              <input type="radio" name="hall-width" checked={choice === w.label} onChange={() => setChoice(w.label)} autoFocus={choice === w.label} /> {w.label}
              {units !== 'ft' && <span className="muted"> ({toDisplay(w.metres, units)} m)</span>}
            </label>
          ))}
          <label>
            <input type="radio" name="hall-width" checked={choice === 'custom'} onChange={() => setChoice('custom')} /> Other:
            <input
              className="inp small"
              type="number"
              min={0.5}
              step="any"
              aria-label={`Width in ${unitLabel(units)}`}
              value={custom}
              onFocus={() => setChoice('custom')}
              onChange={(e) => {
                setChoice('custom');
                setCustom(e.target.value);
              }}
            />{' '}
            {unitLabel(units)}
          </label>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="tb-btn primary" disabled={!ok}>
            Draw it
          </button>
        </div>
      </form>
    </div>
  );
};
