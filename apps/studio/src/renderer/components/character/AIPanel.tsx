import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_STATES, AI_TRIGGERS, aiStep, SKILL_LABELS, startMemory, stateLabel, TACTICS, type AIMemory, type AIProfile, type AIState, type AITransition, type AITrigger, type AIWorld, type Tactics, starterTransitions } from '../../model/character/ai';
import { patchAI, type CharacterProfile } from '../../model/character/profile';
import { resolveVariant } from '../../model/character/variants';
import { newId } from '../../model/project';
import type { Project } from '../../model/types';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  id: string;
  profile: CharacterProfile;
  onCommit: (p: Project) => void;
}

const SENSES: { key: 'visionAngle' | 'viewDistance' | 'hearingRadius' | 'proximityRadius' | 'attackRange' | 'attackCooldown' | 'reaction'; label: string; unit: string; max: number; step: number }[] = [
  { key: 'visionAngle', label: 'Vision cone', unit: '°', max: 360, step: 5 },
  { key: 'viewDistance', label: 'Sight distance', unit: 'm', max: 200, step: 0.5 },
  { key: 'hearingRadius', label: 'Hearing', unit: 'm', max: 100, step: 0.5 },
  { key: 'proximityRadius', label: 'Proximity radius', unit: 'm', max: 50, step: 0.1 },
  { key: 'attackRange', label: 'Attack range', unit: 'm', max: 100, step: 0.1 },
  { key: 'attackCooldown', label: 'Between attacks', unit: 's', max: 60, step: 0.1 },
  { key: 'reaction', label: 'Reaction time', unit: 's', max: 10, step: 0.1 },
];

const LIMITS: { key: 'chaseTimeout' | 'disengageDistance' | 'investigateSeconds' | 'searchSeconds' | 'stunSeconds'; label: string; unit: string; max: number; step: number }[] = [
  { key: 'chaseTimeout', label: 'Chase timeout', unit: 's', max: 600, step: 0.5 },
  { key: 'disengageDistance', label: 'Disengage distance', unit: 'm', max: 1000, step: 1 },
  { key: 'investigateSeconds', label: 'Investigates for', unit: 's', max: 600, step: 0.5 },
  { key: 'searchSeconds', label: 'Searches for', unit: 's', max: 600, step: 0.5 },
  { key: 'stunSeconds', label: 'Stunned for', unit: 's', max: 60, step: 0.1 },
];

/**
 * AI & detection (spec §6.2): the skill profile, independent detection
 * modes, the limits that end a chase, and the state machine as a table of
 * typed transitions, in priority order. Below, the preview runs it.
 */
export const AIPanel = ({ project, id, profile, onCommit }: Props) => {
  const ai = profile.ai;
  const set = (patch: Partial<AIProfile>) => onCommit(patchAI(project, id, patch));
  const setT = (tid: string, patch: Partial<AITransition>) => set({ transitions: ai.transitions.map((t) => (t.id === tid ? { ...t, ...patch } : t)) });
  const move = (tid: string, by: -1 | 1) => {
    const list = [...ai.transitions];
    const at = list.findIndex((t) => t.id === tid);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to]!, list[at]!];
    set({ transitions: list });
  };
  const on = new Set(ai.states);
  return (
    <div className="cc-ai">
      <div className="cc-columns">
        <section className="pz-sec" aria-label="Detection">
          <span className="pz-label">Detection</span>
          <div className="cc-stats">
            {SENSES.map((f) => (
              <NumberField key={f.key} label={f.label} unit={f.unit} min={0} max={f.max} step={f.step} value={ai[f.key]} onCommit={(v) => set({ [f.key]: v })} />
            ))}
          </div>
          <label className="cc-check">
            <input type="checkbox" checked={ai.lineOfSight} onChange={(e) => set({ lineOfSight: e.target.checked })} /> Needs line of sight (walls block it)
          </label>
          <span className="pz-label">Giving up</span>
          <div className="cc-stats">
            {LIMITS.map((f) => (
              <NumberField key={f.key} label={f.label} unit={f.unit} min={0} max={f.max} step={f.step} value={ai[f.key]} onCommit={(v) => set({ [f.key]: v })} />
            ))}
          </div>
          <label className="cc-check">
            <input type="checkbox" checked={ai.resetToPost} onChange={(e) => set({ resetToPost: e.target.checked })} /> Goes back to its post after a search
          </label>
        </section>
        <section className="pz-sec" aria-label="Skill">
          <span className="pz-label">Skill profile</span>
          <p className="pz-says">Not one intelligence number: each part on its own, 0–100.</p>
          {(Object.keys(SKILL_LABELS) as (keyof AIProfile['skill'])[]).map((k) => (
            <label key={k} className="cc-slider" title={SKILL_LABELS[k].hint}>
              <span>{SKILL_LABELS[k].label}</span>
              <input type="range" min={0} max={100} step={5} aria-label={SKILL_LABELS[k].label} value={ai.skill[k]} onChange={(e) => set({ skill: { ...ai.skill, [k]: Number(e.target.value) } })} />
              <span className="mono">{ai.skill[k]}</span>
            </label>
          ))}
          <label className="pz-field">
            <span className="pz-label">Tactics</span>
            <select className="inp small" aria-label="Tactics" value={ai.tactics} onChange={(e) => set({ tactics: e.target.value as Tactics })}>
              {TACTICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}: {t.hint}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>

      <section className="pz-sec" aria-label="State machine">
        <div className="cc-sec-head">
          <span className="pz-label">States</span>
          <label className="cc-check">
            Starts in
            <select className="inp small" aria-label="Starts in" value={ai.start} onChange={(e) => set({ start: e.target.value as 'idle' | 'patrol' })}>
              <option value="patrol">Patrol</option>
              <option value="idle">Idle</option>
            </select>
          </label>
        </div>
        <div className="cc-states" role="group" aria-label="States it uses">
          {AI_STATES.map((s) => (
            <label key={s.id} className={`cc-state-chip${on.has(s.id) ? ' on' : ''}${s.core ? '' : ' optional'}`} title={s.hint}>
              <input type="checkbox" checked={on.has(s.id)} onChange={() => set({ states: on.has(s.id) ? ai.states.filter((x) => x !== s.id) : AI_STATES.map((x) => x.id).filter((x) => x === s.id || on.has(x)) })} /> {s.label}
            </label>
          ))}
        </div>
        <div className="cc-sec-head">
          <span className="pz-label">Transitions, first that holds wins</span>
          <span>
            <button className="tb-btn small" onClick={() => set({ transitions: [...ai.transitions, { id: newId('tr'), from: 'idle', to: 'alert', trigger: 'seesTarget', enabled: true }] })}>
              + Transition
            </button>{' '}
            <button className="tb-btn small" onClick={() => set({ transitions: starterTransitions() })}>
              Back to the starter
            </button>
          </span>
        </div>
        <table className="cc-table" aria-label="Transitions">
          <thead>
            <tr>
              <th>On</th>
              <th>From</th>
              <th>To</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ai.transitions.map((t, i) => {
              const live = t.enabled && (t.from === 'any' || on.has(t.from)) && on.has(t.to);
              const trig = AI_TRIGGERS.find((x) => x.id === t.trigger);
              return (
                <tr key={t.id} className={live ? '' : 'off'}>
                  <td>
                    <input type="checkbox" aria-label={`${stateLabel(t.from)} to ${stateLabel(t.to)} on`} checked={t.enabled} onChange={(e) => setT(t.id, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <select className="inp small" aria-label="From" value={t.from} onChange={(e) => setT(t.id, { from: e.target.value as AIState | 'any' })}>
                      <option value="any">Any state</option>
                      {AI_STATES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="inp small" aria-label="To" value={t.to} onChange={(e) => setT(t.id, { to: e.target.value as AIState })}>
                      {AI_STATES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cc-when">
                    <select className="inp small" aria-label="When" value={t.trigger} onChange={(e) => setT(t.id, { trigger: e.target.value as AITrigger, ...(e.target.value === 'healthBelow' ? { value: t.value ?? 25 } : {}) })}>
                      {AI_TRIGGERS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    {trig?.takes === 'percent' && <NumberField label="Percent" bare unit="%" min={1} max={99} step={1} value={t.value ?? 25} onCommit={(v) => setT(t.id, { value: v })} />}
                  </td>
                  <td className="cc-row-tools">
                    <button className="icon-btn small" aria-label="Higher priority" disabled={i === 0} onClick={() => move(t.id, -1)}>
                      ↑
                    </button>
                    <button className="icon-btn small" aria-label="Lower priority" disabled={i === ai.transitions.length - 1} onClick={() => move(t.id, 1)}>
                      ↓
                    </button>
                    <button className="icon-btn small" aria-label="Remove transition" onClick={() => set({ transitions: ai.transitions.filter((x) => x.id !== t.id) })}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <AIPreview profile={profile} />
    </div>
  );
};

const W = 40;
const H = 24;
const SCALE = 14;

/**
 * The preview (spec §12 diagnostics): its AI on a flat 40 × 24 m floor with
 * a patrol, an optional wall and a target you place with a click. It shows
 * its state, what it senses and why, why each transition happened, its
 * attack cooldown, and pause, step and speed controls. Pick a variant to
 * see how it differs.
 */
const AIPreview = ({ profile }: { profile: CharacterProfile }) => {
  const [variant, setVariant] = useState('');
  const effective = useMemo(() => {
    const v = profile.variants.find((x) => x.id === variant);
    return v ? resolveVariant(profile, v) : profile;
  }, [profile, variant]);
  const ai = effective.ai;
  const [world, setWorld] = useState<AIWorld>(() => ({ patrol: [{ x: 8, y: 12 }, { x: 22, y: 12 }, { x: 22, y: 6 }], walls: [], target: { x: 30, y: 16, noisy: false, alive: true } }));
  const [mem, setMem] = useState<AIMemory>(() => startMemory(world, ai, effective.stats.health));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const [senses, setSenses] = useState('');
  const [hits, setHits] = useState(0);
  const pending = useRef(false);
  const state = useRef({ world, mem, ai, speed: effective.stats.speed });
  state.current = { world, mem, ai, speed: effective.stats.speed };

  const reset = () => {
    setMem(startMemory(world, ai, effective.stats.health));
    setLog([]);
    setHits(0);
    setSenses('');
  };
  useEffect(reset, [variant]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dt: number) => {
    const { world: w, mem: m, ai: a, speed: sp } = state.current;
    const r = aiStep(a, sp, { ...m, hit: pending.current }, w, dt);
    pending.current = false;
    setMem(r.memory);
    setSenses(r.senses.why);
    if (r.reason) setLog((l) => [r.reason!, ...l].slice(0, 12));
    if (r.attacked) setHits((h) => h + 1);
  };

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      for (let i = 0; i < speed; i++) step(0.1);
    }, 100);
    return () => clearInterval(t);
  }, [running, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    setWorld((w) => ({ ...w, target: { ...w.target, x, y, alive: true } }));
  };

  const cone = ai.visionAngle >= 360 ? null : (() => {
    const half = (ai.visionAngle / 2) * (Math.PI / 180);
    const a1 = mem.facing - half;
    const a2 = mem.facing + half;
    const R = ai.viewDistance;
    const p = (a: number) => `${(mem.pos.x + Math.cos(a) * R) * SCALE} ${(mem.pos.y + Math.sin(a) * R) * SCALE}`;
    return `M${mem.pos.x * SCALE} ${mem.pos.y * SCALE} L${p(a1)} A${R * SCALE} ${R * SCALE} 0 ${ai.visionAngle > 180 ? 1 : 0} 1 ${p(a2)} Z`;
  })();
  const tint = profile.art.placeholder.tint;
  return (
    <section className="pz-sec cc-preview-ai" aria-label="AI preview">
      <div className="cc-sec-head">
        <span className="pz-label">Preview</span>
        <span className="cc-preview-tools">
          {profile.variants.length > 0 && (
            <select className="inp small" aria-label="Preview as" value={variant} onChange={(e) => setVariant(e.target.value)}>
              <option value="">The base character</option>
              {profile.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          <button className="tb-btn small" onClick={() => setRunning(!running)}>
            {running ? 'Pause' : 'Play'}
          </button>
          <button className="tb-btn small" disabled={running} onClick={() => step(0.1)}>
            Step
          </button>
          <select className="inp small" aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
          <label className="cc-check">
            <input type="checkbox" checked={world.target.noisy} onChange={(e) => setWorld((w) => ({ ...w, target: { ...w.target, noisy: e.target.checked } }))} /> Target noisy
          </label>
          <label className="cc-check">
            <input type="checkbox" checked={world.walls.length > 0} onChange={(e) => setWorld((w) => ({ ...w, walls: e.target.checked ? [[{ x: 26, y: 8 }, { x: 26, y: 20 }]] : [] }))} /> Wall
          </label>
          <button
            className="tb-btn small"
            onClick={() => {
              pending.current = true;
              setMem((m) => ({ ...m, health: Math.max(0, m.health - m.maxHealth * 0.25) }));
            }}
            title="Hit it for a quarter of its health (Stunned, Flee and Dead, when on)"
          >
            Hit it
          </button>
          <button className="tb-btn small" onClick={reset}>
            Reset
          </button>
        </span>
      </div>
      <svg className="cc-arena" viewBox={`0 0 ${W * SCALE} ${H * SCALE}`} role="img" aria-label={`${stateLabel(mem.state)}: the AI preview`} onClick={place}>
        <rect width={W * SCALE} height={H * SCALE} fill="var(--ground)" />
        {Array.from({ length: W / 5 + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i * 5 * SCALE} y1={0} x2={i * 5 * SCALE} y2={H * SCALE} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {Array.from({ length: H / 5 + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 5 * SCALE} x2={W * SCALE} y2={i * 5 * SCALE} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        <circle cx={world.patrol[0]!.x * SCALE} cy={world.patrol[0]!.y * SCALE} r={ai.disengageDistance * SCALE} fill="none" stroke="#e07a5f" strokeDasharray="6 4" opacity="0.5" />
        <polyline points={[...world.patrol, world.patrol[0]!].map((p) => `${p.x * SCALE},${p.y * SCALE}`).join(' ')} fill="none" stroke="var(--gold-lo)" strokeDasharray="4 4" />
        {world.walls.map(([a, b], i) => (
          <line key={i} x1={a.x * SCALE} y1={a.y * SCALE} x2={b.x * SCALE} y2={b.y * SCALE} stroke="var(--text-soft)" strokeWidth="4" />
        ))}
        {cone && <path d={cone} fill="rgba(226,180,81,0.14)" stroke="rgba(226,180,81,0.5)" />}
        <circle cx={mem.pos.x * SCALE} cy={mem.pos.y * SCALE} r={ai.hearingRadius * SCALE} fill="none" stroke="#7fa3c9" strokeDasharray="2 4" opacity="0.6" />
        <circle cx={mem.pos.x * SCALE} cy={mem.pos.y * SCALE} r={ai.proximityRadius * SCALE} fill="none" stroke="#e07a5f" opacity="0.7" />
        {mem.lastKnown && (mem.state === 'search' || mem.state === 'investigate' || mem.state === 'chase') && (
          <path d={`M${mem.lastKnown.x * SCALE - 5} ${mem.lastKnown.y * SCALE - 5} l10 10 m0 -10 l-10 10`} stroke="#e2b451" strokeWidth="2" />
        )}
        {world.target.alive && <circle cx={world.target.x * SCALE} cy={world.target.y * SCALE} r={7} fill="#c9a24a" stroke="#fff" strokeWidth="1.5" />}
        <g transform={`translate(${mem.pos.x * SCALE} ${mem.pos.y * SCALE}) rotate(${(mem.facing * 180) / Math.PI})`}>
          <circle r={8} fill={tint} />
          <path d="M8 0 L2 -4 L2 4 Z" fill="#fff" />
        </g>
      </svg>
      <div className="cc-diag" role="status">
        <span className={`cc-ai-state s-${mem.state}`}>{stateLabel(mem.state)}</span>
        <span>{senses || 'Click the floor to place the target, then Play or Step.'}</span>
        <span className="muted">
          Health {Math.round(mem.health)} · cooldown {mem.cooldown.toFixed(1)} s · attacks {hits} · {mem.timer.toFixed(1)} s in state
        </span>
      </div>
      <ol className="cc-log" aria-label="Why it changed state">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
      <p className="pref-hint">A 2D check of the machine on a flat floor. The same profile runs in Play Mode for every placed Enemy (and group member) with this character, walls blocking its sight; the engines get it in phase 4.</p>
    </section>
  );
};
