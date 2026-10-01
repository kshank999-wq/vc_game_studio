import { useMemo, useState } from 'react';
import { CATEGORIES } from '../../model/level/library';
import { fittedSize, guessUnits, MAX_KEPT, modelAsset, MODEL_UNITS, type ParsedModel } from '../../model/level/models';
import { CATEGORY_COLOR } from '../../model/level/geometry';
import type { AssetCategory, AssetDefinition, LevelSettings, ModelInfo, ModelUnits } from '../../model/level/types';
import { modelPictures } from './import-files';
import { formatLength } from './units';

const PIVOTS: { id: ModelInfo['pivot']; label: string }[] = [
  { id: 'base', label: 'Its base, centred' },
  { id: 'centre', label: 'Its middle' },
  { id: 'origin', label: 'The file’s own origin' },
];

const COLLISIONS = [
  { id: 'static', label: 'Solid (static)' },
  { id: 'dynamic', label: 'Physics (dynamic)' },
  { id: 'trigger', label: 'Trigger only' },
  { id: 'none', label: 'None' },
] as const;

/**
 * Bring in a proxy model (spec V2 §10): the units it was made in (guessed
 * from its size), its up axis and an extra scale, so it comes out the right
 * size; where it is anchored, how it collides, its category and tags. What it
 * will measure is shown before it is added.
 */
export const ModelImportDialog = ({
  file,
  parsed,
  units,
  onAdd,
  onClose,
}: {
  file: string;
  parsed: ParsedModel;
  units: LevelSettings['units'];
  onAdd: (asset: AssetDefinition) => void;
  onClose: () => void;
}) => {
  const [name, setName] = useState(file.replace(/\.[^.]+$/, ''));
  const [made, setMade] = useState<ModelUnits>(() => guessUnits(parsed));
  const [scale, setScale] = useState(1);
  const [upAxis, setUpAxis] = useState<'y' | 'z'>('y');
  const [pivot, setPivot] = useState<ModelInfo['pivot']>('base');
  const [category, setCategory] = useState<AssetCategory>('props');
  const [collision, setCollision] = useState<(typeof COLLISIONS)[number]['id']>('static');
  const [tags, setTags] = useState('');
  const size = useMemo(() => fittedSize(parsed, { units: made, scale, upAxis }), [parsed, made, scale, upAxis]);
  const guessed = guessUnits(parsed);
  const shape = parsed.positions.length > 0;

  const add = () => {
    const opts = { file, name, units: made, scale, upAxis, pivot, category, collision, tags: tags.split(',') };
    const asset = modelAsset(parsed, opts);
    const pictures = asset.model?.mesh ? modelPictures(asset.model.mesh, asset.size, CATEGORY_COLOR[category]) : {};
    onAdd({ ...asset, model: { ...asset.model!, ...pictures } });
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog lvl-model-dialog" role="dialog" aria-modal="true" aria-label="Import model" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Import model</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          <span className="mono">{file}</span> · {parsed.format.toUpperCase()} · {parsed.triangles.toLocaleString('en')} triangles, {parsed.vertices.toLocaleString('en')} vertices
        </p>
        {parsed.note && <p className="lvl-hint warn">{parsed.note}</p>}
        <label className="dfld">
          <span>Name</span>
          <input className="inp" aria-label="Model name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="lvl-world-size">
          <label className="dfld">
            <span>Made in</span>
            <select className="inp small" aria-label="Made in" value={made} onChange={(e) => setMade(e.target.value as ModelUnits)}>
              {MODEL_UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                  {u.id === guessed ? ' (by its size)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="dfld">
            <span>Scale</span>
            <input className="inp small" type="number" min={0.0001} step={0.1} aria-label="Scale" value={scale} onChange={(e) => setScale(Math.max(0.0001, Number(e.target.value) || 1))} />
          </label>
          <label className="dfld">
            <span>Up is</span>
            <select className="inp small" aria-label="Up axis" value={upAxis} onChange={(e) => setUpAxis(e.target.value as 'y' | 'z')}>
              <option value="y">Y (glTF, Maya, most)</option>
              <option value="z">Z (Blender, 3ds Max, CAD)</option>
            </select>
          </label>
        </div>
        <p className="lvl-model-size" aria-live="polite">
          Comes out <strong>{formatLength(size.w, units)}</strong> wide, <strong>{formatLength(size.d, units)}</strong> deep and <strong>{formatLength(size.h, units)}</strong> tall.
        </p>
        <div className="lvl-world-size">
          <label className="dfld">
            <span>Anchored at</span>
            <select className="inp small" aria-label="Anchored at" value={pivot} onChange={(e) => setPivot(e.target.value as ModelInfo['pivot'])}>
              {PIVOTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dfld">
            <span>Collision</span>
            <select className="inp small" aria-label="Collision" value={collision} onChange={(e) => setCollision(e.target.value as typeof collision)}>
              {COLLISIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dfld">
            <span>Category</span>
            <select className="inp small" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
              {CATEGORIES.filter((c) => c.id !== 'custom').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="dfld">
          <span>Tags</span>
          <input className="inp" aria-label="Tags" placeholder="e.g. medieval, crate, kit-01" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <p className="pref-hint">
          {shape
            ? parsed.triangles > MAX_KEPT
              ? `The studio keeps ${MAX_KEPT.toLocaleString('en')} of its triangles to draw it; the engines get its box, and you put the real model in its Final asset.`
              : 'The studio draws its shape; the engines get its box, and you put the real model in its Final asset.'
            : 'The studio draws it as a box this size.'}{' '}
          It goes in your Personal assets, for every project on this computer.
        </p>
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tb-btn primary" onClick={add}>
            Add to Personal assets
          </button>
        </div>
      </div>
    </div>
  );
};
