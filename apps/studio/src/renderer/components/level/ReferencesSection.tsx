import { useRef, useState } from 'react';
import { levelsOf } from '../../model/level/level';
import { addReference, fitReference, metresPerPixel, referenceDepth, REFERENCE_KINDS, removeReference, setMetresPerPixel, updateReference } from '../../model/level/references';
import type { AssetDefinition, ReferenceKind } from '../../model/level/types';
import type { Project } from '../../model/types';
import { BoolField, NumberField, Section, SelectField, TextField } from './fields';
import { readImage } from './import-files';
import { formatLength } from './units';

/**
 * A map's reference images (spec V2 §10): an existing map, a floor plan, a
 * heightmap or a photo, laid under the map to trace over. Each is sized in
 * metres (or by metres per pixel), placed, turned, faded, and kept to one
 * floor or shown on all of them.
 */
export const ReferencesSection = ({
  project,
  levelId,
  floorId,
  global,
  open,
  onToggle,
  onCommit,
  onSay,
}: {
  project: Project;
  levelId: string;
  floorId: string;
  global: readonly AssetDefinition[];
  open: boolean;
  onToggle: () => void;
  onCommit: (p: Project) => void;
  onSay?: (text: string) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const units = set.settings.units;
  const refs = level.references ?? [];
  const many = level.floors.length > 1;

  const take = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { image, pixels } = await readImage(file);
      const made = addReference(project, levelId, { name: file.name.replace(/\.[^.]+$/, ''), image, pixels, ...(many ? { floorId } : {}) }, global);
      if (made.id) {
        onCommit(made.project);
        onSay?.(`${file.name} is under the map. Set its width, or metres per pixel, so it comes out the right size.`);
      }
    } catch (e) {
      onSay?.(e instanceof Error ? e.message : 'Could not read that picture.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Section title="Reference images" open={open} onToggle={onToggle} count={refs.length || undefined}>
      <p className="lvl-hint">Lay an existing map, a floor plan, a heightmap or a photo under the map to trace over. It stays in the studio; the engines never get it.</p>
      <div className="lvl-btnrow wrap">
        <button className="tb-btn small" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : 'Import image…'}
        </button>
        <input ref={input} type="file" accept="image/*" hidden aria-label="Reference image file" onChange={(e) => void take(e.target.files)} />
      </div>
      {refs.map((r) => {
        const patch = (p: Parameters<typeof updateReference>[3]) => onCommit(updateReference(project, levelId, r.id, p));
        const locked = !!r.locked;
        const mpp = metresPerPixel(r);
        return (
          <div key={r.id} className={`lvl-ref${r.hidden ? ' off' : ''}`} aria-label={`Reference ${r.name}`} role="group">
            <img src={r.image} alt="" className="lvl-ref-thumb" />
            <TextField label="Name" value={r.name} disabled={locked} onCommit={(v) => v.trim() && patch({ name: v.trim() })} />
            <SelectField label="What it is" value={r.kind} disabled={locked} options={REFERENCE_KINDS.map((k) => ({ value: k.id, label: k.label }))} onCommit={(v) => patch({ kind: v as ReferenceKind })} />
            <NumberField label="Width" unit="length" units={units} value={r.width} min={0.01} step={level.grid ?? 1} disabled={locked} onCommit={(v) => patch({ width: v })} />
            <NumberField
              label="Metres per pixel"
              value={Math.round(mpp * 100000) / 100000}
              min={0.00001}
              step={0.01}
              disabled={locked}
              hint={`${r.pixels.w} × ${r.pixels.h} pixels`}
              onCommit={(v) => onCommit(setMetresPerPixel(project, levelId, r.id, v))}
            />
            <p className="lvl-hint">
              {formatLength(r.width, units)} × {formatLength(referenceDepth(r), units)} · {r.pixels.w} × {r.pixels.h} px
            </p>
            <NumberField label="East" unit="length" units={units} value={r.x} step={level.grid ?? 1} disabled={locked} hint="its centre" onCommit={(v) => patch({ x: v })} />
            <NumberField label="South" unit="length" units={units} value={r.y} step={level.grid ?? 1} disabled={locked} onCommit={(v) => patch({ y: v })} />
            <NumberField label="Rotation (°)" value={r.rotation} step={1} disabled={locked} onCommit={(v) => patch({ rotation: ((v % 360) + 360) % 360 })} />
            <NumberField label="Opacity (%)" value={Math.round(r.opacity * 100)} min={5} max={100} step={5} disabled={locked} onCommit={(v) => patch({ opacity: v / 100 })} />
            {many && (
              <SelectField
                label="On"
                value={r.floorId ?? ''}
                disabled={locked}
                options={[{ value: '', label: 'Every floor' }, ...level.floors.map((f) => ({ value: f.id, label: f.name }))]}
                onCommit={(v) => patch({ floorId: v || undefined })}
              />
            )}
            <BoolField label="Shown" value={!r.hidden} onCommit={(v) => patch({ hidden: v ? undefined : true })} />
            <BoolField label="Locked" value={locked} onCommit={(v) => patch({ locked: v || undefined })} />
            <div className="lvl-btnrow wrap">
              <button className="tb-btn small" disabled={locked} title="Stretch it over the map’s extent, centred" onClick={() => onCommit(fitReference(project, levelId, r.id, global))}>
                Fit to the map
              </button>
              <button className="tb-btn small danger-btn" disabled={locked} aria-label={`Remove ${r.name}`} onClick={() => onCommit(removeReference(project, levelId, r.id))}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </Section>
  );
};
