import { useState } from 'react';
import { FOOTPRINT_SHAPES, presetOf, STRUCTURE_PRESETS, TRAVERSAL_STYLES, type FootprintShape, type NewStructure } from '../../model/level/structure';
import type { LevelSettings, StructureType, TraversalStyle } from '../../model/level/types';
import { formatLength, fromDisplay, toDisplay, unitLabel } from './units';

export type StructureChoice = Omit<NewStructure, 'parentId' | 'floorId' | 'at'>;

/**
 * Add a structure (structure spec §2, §5): a preset — pyramid, temple,
 * fortress, office, apartments, industrial, bunker, dungeon or blank — each
 * editable: its size, floors above and below, floor height, roof, footprint
 * shape, how its floors are reached and the scene it plays as.
 */
export const NewStructureDialog = ({ units, scenes, onCreate, onClose }: { units: LevelSettings['units']; scenes: { id: string; name: string }[]; onCreate: (s: StructureChoice) => void; onClose: () => void }) => {
  const [type, setType] = useState<StructureType>('pyramid');
  const p = presetOf(type);
  const [name, setName] = useState('');
  const [w, setW] = useState<number | null>(null);
  const [d, setD] = useState<number | null>(null);
  const [above, setAbove] = useState<number | null>(null);
  const [below, setBelow] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [roof, setRoof] = useState<boolean | null>(null);
  const [shape, setShape] = useState<FootprintShape | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [traversal, setTraversal] = useState<TraversalStyle | null>(null);
  const [scene, setScene] = useState('');
  const pick = (t: StructureType) => {
    setType(t);
    for (const reset of [setW, setD, setAbove, setBelow, setHeight, setStep]) reset(null);
    setRoof(null);
    setShape(null);
    setTraversal(null);
  };
  const v = {
    w: w ?? p.w,
    d: d ?? p.d,
    above: above ?? p.above,
    below: below ?? p.below,
    floorHeight: height ?? p.floorHeight,
    roof: roof ?? p.roof,
    shape: shape ?? p.shape,
    step: step ?? p.step,
    traversal: traversal ?? p.traversal,
  };
  const create = () => onCreate({ type, name: name.trim() || p.label.split(' /')[0]!, ...v, ...(scene ? { scene } : {}) });
  const len = (label: string, value: number, set: (n: number) => void, min = 1) => (
    <label className="dfld">
      <span>
        {label} ({unitLabel(units)})
      </span>
      <input className="inp small" type="number" min={min} step={0.5} aria-label={label} value={toDisplay(value, units)} onChange={(e) => set(Math.max(min, fromDisplay(Number(e.target.value) || 0, units)))} />
    </label>
  );
  const count = (label: string, value: number, set: (n: number) => void, min: number, max: number) => (
    <label className="dfld">
      <span>{label}</span>
      <input className="inp small" type="number" min={min} max={max} step={1} aria-label={label} value={value} onChange={(e) => set(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))))} />
    </label>
  );
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form
        className="dialog lvl-world-dialog lvl-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New structure"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="dialog-head">
          <h2>New structure</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">A mini-level inside this map: its mass goes here, and it opens as a map of its own with every floor, from the basements to the roof.</p>
        <label className="dfld">
          <span>Name</span>
          <input className="inp" aria-label="Structure name" placeholder={`e.g. ${type === 'pyramid' ? 'Royal Pyramid' : p.label.split(' /')[0]}`} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="lvl-world-presets lvl-structure-presets" role="radiogroup" aria-label="Kind of structure">
          {STRUCTURE_PRESETS.map((x) => (
            <label key={x.id} className={`lvl-world-preset${type === x.id ? ' on' : ''}`}>
              <input type="radio" name="structure-type" checked={type === x.id} onChange={() => pick(x.id)} />
              <strong>{x.label}</strong>
              <span className="muted">
                {formatLength(x.w, units)} × {formatLength(x.d, units)} · {x.above} up{x.below ? `, ${x.below} down` : ''}
                {x.roof ? ', roof' : ''}
              </span>
              {x.purpose && <span className="pref-hint">{x.purpose}</span>}
            </label>
          ))}
        </div>
        <div className="lvl-world-size">
          {len('Width', v.w, setW, 2)}
          {len('Depth', v.d, setD, 2)}
          {count('Floors above ground', v.above, setAbove, 1, 200)}
          {count('Basements', v.below, setBelow, 0, 20)}
          {len('Floor height', v.floorHeight, setHeight, 2)}
          <label className="dfld">
            <span>Footprint</span>
            <select className="inp small" aria-label="Footprint" value={v.shape} onChange={(e) => setShape(e.target.value as FootprintShape)}>
              {FOOTPRINT_SHAPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {len('Step in per floor', v.step, setStep, 0)}
          <label className="dfld">
            <span>Between floors</span>
            <select className="inp small" aria-label="Between floors" value={v.traversal} onChange={(e) => setTraversal(e.target.value as TraversalStyle)}>
              {TRAVERSAL_STYLES.map((s) => (
                <option key={s.id} value={s.id} title={s.hint}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dfld lvl-check">
            <input type="checkbox" aria-label="Roof" checked={v.roof} onChange={(e) => setRoof(e.target.checked)} />
            <span>A roof to walk on</span>
          </label>
          {scenes.length > 0 && (
            <label className="dfld">
              <span>Plays as scene</span>
              <select className="inp small" aria-label="Plays as scene" value={scene} onChange={(e) => setScene(e.target.value)}>
                <option value="">None yet</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="pref-hint">
          {formatLength(v.w, units)} × {formatLength(v.d, units)}, {v.above + v.below + (v.roof ? 1 : 0)} floors {formatLength(v.floorHeight, units)} high
          {v.step ? `, each floor up drawn in ${formatLength(v.step, units)} on every side` : ''}. Every floor gets a footprint you can reshape by its corners. Then draw its rooms, doors and stairs, or Generate them.
        </p>
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="tb-btn primary"
            onClick={(e) => {
              e.preventDefault();
              create();
            }}
          >
            Create structure
          </button>
        </div>
      </form>
    </div>
  );
};
