import { useState } from 'react';
import { defaultGenerator, LAYOUT_RULES, type Proposal } from '../../model/level/generate';
import { floorCodes } from '../../model/level/structure';
import { THEMES, themeOf } from '../../model/level/themes';
import type { GeneratorSettings, LayoutRules, Level, LevelSettings, ThemeId } from '../../model/level/types';
import { fromDisplay, toDisplay, unitLabel } from './units';

export type GenerateScope = 'structure' | 'floor' | 'area';

export interface GenerateAsk {
  scope: GenerateScope;
  seed: number;
  settings: GeneratorSettings;
  /** Keep the layout as it is and dress its rooms only (V2 procedural themes). */
  dressOnly: boolean;
}

/**
 * The generator's controls (structure spec §6): plan-first or path-first, the
 * rule preset, what to lay out (the whole structure, this floor, or the
 * selected wing or room), the seed (kept, or a new one each time), sizes, and
 * for path-first the chambers, dead ends and secret branches. A layout is a
 * preview first, drawn on the map, to accept, regenerate or reject. The theme
 * (V2) dresses what it lays out; "Dress rooms only" dresses the rooms already
 * there, drawn by hand or not, and leaves the walls alone.
 */
export const GeneratePanel = ({
  level,
  floorId,
  units,
  areaName,
  proposal,
  onPreview,
  onAccept,
  onReject,
  onDrawRoute,
  onClose,
}: {
  level: Level;
  floorId: string;
  units: LevelSettings['units'];
  /** The selected space or volume, if one is: it can be laid out on its own. */
  areaName?: string;
  proposal: Proposal | null;
  onPreview: (ask: GenerateAsk) => void;
  onAccept: () => void;
  onReject: () => void;
  onDrawRoute: () => void;
  onClose: () => void;
}) => {
  const last = level.generation?.[level.generation.length - 1];
  const [settings, setSettings] = useState<GeneratorSettings>(() => ({ ...defaultGenerator(level.structure?.type), ...(last?.settings ?? {}) }));
  const [scope, setScope] = useState<GenerateScope>('structure');
  const [seed, setSeed] = useState(level.structure?.seed ?? 1);
  const [keepSeed, setKeepSeed] = useState(false);
  const [dressOnly, setDressOnly] = useState(false);
  const theme = themeOf(settings.theme);
  const set = (patch: Partial<GeneratorSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const floor = level.floors.find((f) => f.id === floorId);
  const code = floor ? floorCodes(level).get(floor.id) : '';
  const fresh = () => 1 + Math.floor(Math.random() * 99999);
  const go = (again: boolean) => {
    const next = again && !keepSeed ? fresh() : seed;
    setSeed(next);
    onPreview({ scope: scope === 'area' && !areaName ? 'floor' : scope, seed: next, settings, dressOnly });
  };
  const len = (label: string, key: 'roomMin' | 'roomMax' | 'corridor' | 'chamber', min = 1) => (
    <label className="dfld">
      <span>
        {label} ({unitLabel(units)})
      </span>
      <input className="inp small" type="number" min={min} step={0.5} aria-label={label} value={toDisplay(settings[key], units)} onChange={(e) => set({ [key]: Math.max(min, fromDisplay(Number(e.target.value) || 0, units)) })} />
    </label>
  );
  const share = (label: string, key: 'decay' | 'traps') => {
    const v = settings[key] ?? theme[key];
    return (
      <label className="dfld">
        <span>
          {label} ({Math.round(v * 100)}%)
        </span>
        <input type="range" min={0} max={100} step={5} aria-label={label} disabled={theme.id === 'none'} value={Math.round(v * 100)} onChange={(e) => set({ [key]: Number(e.target.value) / 100 })} />
      </label>
    );
  };
  const count = (label: string, key: 'entrances' | 'deadEnds' | 'secrets', max: number) => (
    <label className="dfld">
      <span>{label}</span>
      <input className="inp small" type="number" min={0} max={max} step={1} aria-label={label} value={settings[key]} onChange={(e) => set({ [key]: Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))) })} />
    </label>
  );
  return (
    <section className="lvl-generate" aria-label="Generate a layout">
      <header className="lvl-structure-head">
        <strong>Generate</strong>
        <span className="muted">{settings.mode === 'path' ? 'Rooms round the route drawn on each floor' : LAYOUT_RULES.find((r) => r.id === settings.rules)?.hint}</span>
        <span className="grow" />
        <button className="icon-btn small" aria-label="Close the generator" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="lvl-generate-body">
        <div className="lvl-generate-fields">
          <div role="radiogroup" aria-label="Mode" className="view-toggle">
            <button role="radio" aria-checked={settings.mode === 'plan'} className={settings.mode === 'plan' ? 'on' : ''} onClick={() => set({ mode: 'plan' })} title="Whole floor plates: corridors, rooms and a stair core">
              Plan-first
            </button>
            <button role="radio" aria-checked={settings.mode === 'path'} className={settings.mode === 'path' ? 'on' : ''} onClick={() => set({ mode: 'path' })} title="Chambers and passages along the route you draw, with dead ends and secret branches">
              Path-first
            </button>
          </div>
          <label className="dfld">
            <span>Lay out</span>
            <select className="inp small" aria-label="Lay out" value={scope} onChange={(e) => setScope(e.target.value as GenerateScope)}>
              <option value="structure">The whole structure</option>
              <option value="floor">This floor{code ? ` (${code})` : ''}</option>
              <option value="area" disabled={!areaName}>
                {areaName ? `Inside ${areaName}` : 'Inside the selected room (select one)'}
              </option>
            </select>
          </label>
          {settings.mode === 'plan' && (
            <label className="dfld">
              <span>Rules</span>
              <select className="inp small" aria-label="Rules" value={settings.rules} onChange={(e) => set({ rules: e.target.value as LayoutRules })}>
                {LAYOUT_RULES.map((r) => (
                  <option key={r.id} value={r.id} title={r.hint}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="dfld">
            <span>Seed</span>
            <input className="inp small" type="number" min={1} step={1} aria-label="Seed" value={seed} onChange={(e) => setSeed(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
          </label>
          <label className="dfld lvl-check">
            <input type="checkbox" aria-label="Keep the seed" checked={keepSeed} onChange={(e) => setKeepSeed(e.target.checked)} />
            <span>Keep the seed</span>
          </label>
          <label className="dfld">
            <span>Theme</span>
            <select className="inp small" aria-label="Theme" value={theme.id} title={theme.hint} onChange={(e) => set({ theme: e.target.value as ThemeId, decay: undefined, traps: undefined })}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id} title={t.hint}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {share('Ruin', 'decay')}
          {share('Traps', 'traps')}
          <label className="dfld lvl-check">
            <input type="checkbox" aria-label="Dress rooms only" checked={dressOnly} onChange={(e) => setDressOnly(e.target.checked)} />
            <span>Dress rooms only (keep the layout)</span>
          </label>
          {len('Smallest room', 'roomMin', 2)}
          {len('Largest room', 'roomMax', 2)}
          {len('Corridor width', 'corridor', 1)}
          {settings.mode === 'plan' ? (
            <>
              {count('Ways in', 'entrances', 8)}
              <label className="dfld">
                <span>Density ({Math.round(settings.density * 100)}%)</span>
                <input type="range" min={20} max={100} step={5} aria-label="Density" value={Math.round(settings.density * 100)} onChange={(e) => set({ density: Number(e.target.value) / 100 })} />
              </label>
            </>
          ) : (
            <>
              {len('Chamber size', 'chamber', 3)}
              {count('Dead ends', 'deadEnds', 12)}
              {count('Secret branches', 'secrets', 12)}
              <label className="dfld lvl-check">
                <input type="checkbox" aria-label="Fill the rest" checked={settings.fill} onChange={(e) => set({ fill: e.target.checked })} />
                <span>Fill the rest with rooms</span>
              </label>
            </>
          )}
        </div>
        <div className="lvl-generate-side">
          {settings.mode === 'path' && (
            <p className="pref-hint">
              Draw the route on each floor first: the Route tool, as a Progression path, from the way in to the last chamber.{' '}
              <button className="tb-btn small" onClick={onDrawRoute}>
                Draw the route
              </button>
            </p>
          )}
          {!proposal ? (
            <button className="tb-btn primary" onClick={() => go(false)}>
              Preview
            </button>
          ) : (
            <>
              <p className="lvl-generate-sum" role="status">
                Preview, seed {proposal.run.seed}:{' '}
                {proposal.counts.rooms || proposal.counts.corridors ? `${proposal.counts.rooms} rooms, ${proposal.counts.corridors} corridors, ${proposal.counts.doors} doors, ${proposal.counts.connectors} ways between floors` : 'the rooms as they are'}
                {proposal.dressing ? `; dressed with ${proposal.dressing.props} props, ${proposal.dressing.lights} lights, ${proposal.dressing.traps} traps and ${proposal.dressing.ruin} ruin` : ''}
                {proposal.removed.length ? `; replaces ${proposal.removed.length} generated before` : ''}.
              </p>
              <div className="lvl-structure-actions">
                <button className="tb-btn primary" onClick={onAccept}>
                  Accept
                </button>
                <button className="tb-btn" onClick={() => go(true)}>
                  Regenerate
                </button>
                <button className="tb-btn" onClick={onReject}>
                  Reject
                </button>
              </div>
              {(proposal.problems.length > 0 || proposal.kept.length > 0) && (
                <ul className="lvl-structure-issues lvl-generate-notes" aria-label="What the generator says">
                  {proposal.problems.map((p, n) => (
                    <li key={`p${n}`} className="lvl-issue warning">
                      {p}
                    </li>
                  ))}
                  {proposal.kept.map((k) => (
                    <li key={k.id} className="lvl-issue info">
                      Kept: {k.why}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="pref-hint">Rooms you placed by hand, locked rooms and generated rooms you changed are kept. A new layout replaces only what the generator made, and dressing you moved or changed stays.</p>
        </div>
      </div>
    </section>
  );
};
