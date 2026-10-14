import { useMemo, useRef, useState } from 'react';
import { CAD_ROLES, guessRole, guessUnits, parseCad, readPlan, type CadDrawing, type CadRole, type CadUnits, type PlanRead } from '../../model/level/cad';

const ROLE_COLOR: Record<CadRole, string> = {
  rooms: '#4f8fd8',
  walls: '#8a8578',
  doors: '#e0a03a',
  stairs: '#9b6bd6',
  footprint: '#3aa57a',
  labels: '#888',
  ignore: 'transparent',
};

/**
 * Import a floor plan from CAD (structure spec V2): a DXF or SVG file, read
 * here and never sent anywhere. Each layer gets a role (guessed from its
 * name, A-WALL, A-DOOR, Rooms…), the units are what the file says or a guess
 * from its size, and the preview shows what it will make before it is put on
 * this floor.
 */
export const ImportPlanDialog = ({ floorName, onImport, onClose }: { floorName: string; onImport: (plan: PlanRead, file: string) => void; onClose: () => void }) => {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState('');
  const [drawing, setDrawing] = useState<CadDrawing | null>(null);
  const [error, setError] = useState('');
  const [units, setUnits] = useState<CadUnits>('m');
  const [roles, setRoles] = useState<Record<string, CadRole>>({});
  const take = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const text =
        typeof f.text === 'function'
          ? await f.text()
          : await new Promise<string>((ok, fail) => {
              const r = new FileReader();
              r.onload = () => ok(String(r.result ?? ''));
              r.onerror = () => fail(r.error ?? new Error('Could not read that file.'));
              r.readAsText(f);
            });
      const d = parseCad(f.name, text);
      setFile(f.name);
      setDrawing(d);
      setUnits(guessUnits(d));
      setRoles(Object.fromEntries(d.layers.map((l) => [l, guessRole(l)])));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const plan = useMemo(() => (drawing ? readPlan(drawing, { roles, units }) : null), [drawing, roles, units]);
  const counts = (layer: string) => (drawing ? drawing.shapes.filter((s) => s.layer === layer).length + drawing.texts.filter((t) => t.layer === layer).length : 0);
  const view = useMemo(() => {
    if (!plan || !plan.lines.length) return null;
    const pts = plan.lines.flatMap((l) => l.points);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 1;
    const x0 = Math.min(...xs) - pad;
    const y0 = Math.min(...ys) - pad;
    return { box: `${x0} ${y0} ${Math.max(...xs) - x0 + pad} ${Math.max(...ys) - y0 + pad}`, stroke: Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) / 300 };
  }, [plan]);
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form
        className="dialog lvl-world-dialog lvl-import-plan"
        role="dialog"
        aria-modal="true"
        aria-label="Import a floor plan"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (plan) onImport(plan, file);
        }}
      >
        <div className="dialog-head">
          <h2>Import a floor plan</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          A plan drawn in CAD, as DXF (saved as text) or SVG, onto {floorName}. Closed shapes on a Rooms layer become rooms, named by the text inside them; the outline becomes the footprint; door swings and door blocks become doors in the nearest wall. The file stays on this computer.
        </p>
        <div className="lvl-btnrow wrap">
          <button type="button" className="tb-btn" onClick={() => input.current?.click()}>
            {drawing ? 'Choose another file…' : 'Choose a DXF or SVG…'}
          </button>
          <input ref={input} type="file" accept=".dxf,.svg,image/svg+xml,application/dxf" hidden aria-label="Plan file" onChange={(e) => void take(e.target.files)} />
          {file && <span className="mono">{file}</span>}
        </div>
        {error && <p className="lvl-issue error">{error}</p>}
        {drawing && plan && (
          <div className="lvl-import-body">
            <div className="lvl-import-fields">
              <label className="dfld">
                <span>Drawn in</span>
                <select className="inp small" aria-label="Drawn in" value={units} onChange={(e) => setUnits(e.target.value as CadUnits)}>
                  <option value="mm">Millimetres</option>
                  <option value="cm">Centimetres</option>
                  <option value="m">Metres</option>
                  <option value="in">Inches</option>
                  <option value="ft">Feet</option>
                </select>
              </label>
              {drawing.units ? <p className="pref-hint">The file says {drawing.units}.</p> : <p className="pref-hint">The file doesn’t say; guessed from its size.</p>}
              <table className="lvl-import-layers" aria-label="Layers">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>Items</th>
                    <th>Is</th>
                  </tr>
                </thead>
                <tbody>
                  {drawing.layers.map((l) => (
                    <tr key={l}>
                      <td>
                        <span className="lvl-import-swatch" style={{ background: ROLE_COLOR[roles[l] ?? 'ignore'] }} /> {l}
                      </td>
                      <td className="mono">{counts(l)}</td>
                      <td>
                        <select className="inp small" aria-label={`Layer ${l}`} value={roles[l] ?? 'ignore'} onChange={(e) => setRoles((r) => ({ ...r, [l]: e.target.value as CadRole }))}>
                          {CAD_ROLES.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lvl-import-preview">
              {view && (
                <svg viewBox={view.box} role="img" aria-label="Plan preview">
                  {plan.lines
                    .filter((l) => l.role !== 'ignore' && l.role !== 'labels')
                    .map((l, n) => (
                      <polyline key={n} points={l.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={l.closed && l.role === 'rooms' ? 'rgba(79,143,216,0.12)' : 'none'} stroke={ROLE_COLOR[l.role]} strokeWidth={view.stroke} {...(l.closed ? { strokeLinejoin: 'round' } : {})} />
                    ))}
                  {plan.doors.map((d, n) => (
                    <circle key={`d${n}`} cx={d.at.x} cy={d.at.y} r={d.width / 2} fill="none" stroke={ROLE_COLOR.doors} strokeWidth={view.stroke * 2} />
                  ))}
                  {plan.rooms.map((r, n) => {
                    const c = r.points.reduce((a, p) => ({ x: a.x + p.x / r.points.length, y: a.y + p.y / r.points.length }), { x: 0, y: 0 });
                    return (
                      <text key={`r${n}`} x={c.x} y={c.y} fontSize={view.stroke * 12} textAnchor="middle" fill="currentColor">
                        {r.name}
                      </text>
                    );
                  })}
                </svg>
              )}
              <p className="lvl-generate-sum" role="status">
                {plan.size.w} × {plan.size.d} m: {plan.rooms.length} rooms, {plan.doors.length} doors, {plan.stairs.length} stairs.
              </p>
              {plan.notes.length > 0 && (
                <ul className="lvl-structure-issues" aria-label="What the import says">
                  {plan.notes.map((n, k) => (
                    <li key={k} className="lvl-issue info">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="tb-btn primary" disabled={!plan || !plan.rooms.length}>
            Import onto {floorName}
          </button>
        </div>
      </form>
    </div>
  );
};
