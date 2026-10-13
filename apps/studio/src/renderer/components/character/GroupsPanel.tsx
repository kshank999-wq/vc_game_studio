import { useMemo, useState } from 'react';
import { ACTIVITIES, addEntry, createGroup, duplicateGroup, FORMATIONS, groupById, groupProblems, groupsOf, headcount, populate, removeEntry, removeGroup, updateEntry, updateGroup, type Activity, type CharacterGroup, type Formation } from '../../model/character/groups';
import { characters, profileOf } from '../../model/character/profile';
import { levelsOf } from '../../model/level/level';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  onCommit: (p: Project) => void;
  onOpenLevels?: (itemId?: string) => void;
  onSay: (t: string) => void;
  focus?: string;
}

/**
 * Groups (spec §7): population recipes. Each lists who is in it (a
 * character or one of its variants, how many, how likely, doing what), how
 * they spread out (formation, spacing, wander radius, route, density cap)
 * and when and with whom they belong (schedule, faction, persistence). The
 * preview spreads the group over a sample area as a level will, the same
 * every time for its seed; Reshuffle picks another seed. Put a group in a
 * level with a Character group area from the Level Designer's library.
 */
export const GroupsPanel = ({ project, onCommit, onOpenLevels, onSay, focus }: Props) => {
  const groups = groupsOf(project);
  const [selected, setSelected] = useState<string | null>(() => (focus && groupById(project, focus) ? focus : (groups[0]?.id ?? null)));
  const [name, setName] = useState('');
  const [area, setArea] = useState({ w: 30, d: 20 });
  const g = selected ? groupById(project, selected) : undefined;
  if (selected && !g && groups[0]) setSelected(groups[0].id);
  const cast = characters(project);
  const set = (patch: Partial<CharacterGroup>) => g && onCommit(updateGroup(project, g.id, patch));
  const pop = useMemo(() => (g ? populate(project, g, { x: 0, y: 0, w: area.w, d: area.d, rotation: 0 }, 'preview') : undefined), [project, g, area]);
  const problems = g ? groupProblems(project, g) : [];
  const placed = useMemo(() => (g ? levelsOf(project).items.filter((i) => i.assetId === 'actor.group' && i.params?.group === g.id) : []), [project, g]);

  const create = () => {
    const made = createGroup(project, name || 'New group');
    onCommit(made.project);
    setSelected(made.id);
    setName('');
  };

  const W = 380;
  const k = W / area.w;
  return (
    <div className="cc-groups">
      <aside className="cc-left" aria-label="Groups">
        <form
          className="pz-new"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input className="inp small" aria-label="New group name" placeholder="New group, e.g. Village Market" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="tb-btn small">
            + Group
          </button>
        </form>
        <div className="pz-list" role="listbox" aria-label="Group library">
          {groups.map((x) => {
            const h = headcount(x);
            const bad = groupProblems(project, x).some((p) => p.severity === 'error');
            return (
              <button key={x.id} role="option" aria-selected={x.id === selected} className={`pz-item${x.id === selected ? ' on' : ''}`} onClick={() => setSelected(x.id)}>
                <span className="pz-item-name">{x.name}</span>
                <span className="pz-item-meta">
                  {h.min === h.max ? h.min : `${h.min}–${h.max}`} people · {x.entries.length} {x.entries.length === 1 ? 'kind' : 'kinds'}
                  {bad && <span className="pz-dot" />}
                </span>
              </button>
            );
          })}
          {!groups.length && <p className="lvl-hint">No groups yet. Name one above, or add the sample cast for Village Market and Orc Patrol.</p>}
        </div>
      </aside>

      <section className="cc-center" aria-label="Group">
        {!g ? (
          <div className="pz-empty">
            <h2>Groups</h2>
            <p>A group is a recipe for a crowd: who is in it, how many, what they do, and how they spread out. Put it in a level with a Character group area, and its people appear on the map, in 3D and in Play Mode.</p>
          </div>
        ) : (
          <>
            <header className="pz-head">
              <h2>{g.name}</h2>
              <button
                className="tb-btn small"
                onClick={() => {
                  const d = duplicateGroup(project, g.id);
                  if (d) {
                    onCommit(d.project);
                    setSelected(d.id);
                  }
                }}
              >
                Duplicate
              </button>
              <button
                className="tb-btn small"
                onClick={() => {
                  onCommit(removeGroup(project, g.id));
                  onSay(`${g.name} removed.${placed.length ? ` ${placed.length} area${placed.length === 1 ? '' : 's'} in the levels now pick no group.` : ''}`);
                }}
              >
                Remove
              </button>
            </header>
            <div className="cc-columns">
              <section className="pz-sec" aria-label="Who">
                <span className="pz-label">Who is in it</span>
                <table className="cc-table" aria-label="Entries">
                  <thead>
                    <tr>
                      <th>Character</th>
                      <th>Variant</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Weight</th>
                      <th>Doing</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.entries.map((e) => {
                      const c = project.objects[e.character];
                      const variants = c?.type === 'character' ? profileOf(c).variants : [];
                      return (
                        <tr key={e.id}>
                          <td>
                            <select className="inp small" aria-label="Character" value={e.character} onChange={(x) => onCommit(updateEntry(project, g.id, e.id, { character: x.target.value, variant: undefined }))}>
                              {!c && <option value={e.character}>(gone)</option>}
                              {cast.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select className="inp small" aria-label="Variant" value={e.variant ?? ''} disabled={!variants.length} onChange={(x) => onCommit(updateEntry(project, g.id, e.id, { variant: x.target.value || undefined }))}>
                              <option value="">{variants.length ? 'Base' : '—'}</option>
                              {variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <NumberField label="From" bare unit="" min={0} max={500} step={1} value={e.min} onCommit={(v) => onCommit(updateEntry(project, g.id, e.id, { min: v }))} />
                          </td>
                          <td>
                            <NumberField label="To" bare unit="" min={0} max={500} step={1} value={e.max} onCommit={(v) => onCommit(updateEntry(project, g.id, e.id, { max: v }))} />
                          </td>
                          <td>
                            <NumberField label="Weight" bare unit="" min={0} max={100} step={0.5} value={e.weight} onCommit={(v) => onCommit(updateEntry(project, g.id, e.id, { weight: v }))} />
                          </td>
                          <td>
                            <select className="inp small" aria-label="Doing" value={e.activity} onChange={(x) => onCommit(updateEntry(project, g.id, e.id, { activity: x.target.value as Activity }))}>
                              {ACTIVITIES.map((a) => (
                                <option key={a.id} value={a.id} title={a.hint}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button className="icon-btn small" aria-label={`Take ${c?.name ?? 'it'} out`} onClick={() => onCommit(removeEntry(project, g.id, e.id))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <select
                  className="inp small"
                  aria-label="Add a character to the group"
                  value=""
                  disabled={!cast.length}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const c = project.objects[e.target.value]!;
                    const p = profileOf(c);
                    onCommit(addEntry(project, g.id, { character: c.id, min: 5, max: 5, weight: 1, activity: p.roles.includes('enemy') ? 'guard' : p.roles.includes('npc') ? 'talk' : 'wander' }));
                  }}
                >
                  <option value="">{cast.length ? '+ Add a character…' : 'No characters yet'}</option>
                  {cast.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </section>
              <section className="pz-sec" aria-label="Spread">
                <span className="pz-label">How they spread out</span>
                <div className="cc-stats">
                  <label className="pz-field">
                    <span className="pz-label">Formation</span>
                    <select className="inp small" aria-label="Formation" value={g.formation} onChange={(e) => set({ formation: e.target.value as Formation })}>
                      {FORMATIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField label="Spacing" unit="m" min={0} max={50} step={0.1} value={g.spacing} onCommit={(v) => set({ spacing: v })} />
                  <NumberField label="Wander radius" unit="m" min={0} max={500} step={0.5} value={g.wanderRadius} onCommit={(v) => set({ wanderRadius: v })} />
                  <NumberField label="Density cap" unit="/100 m²" min={0} max={500} step={0.5} value={g.density} onCommit={(v) => set({ density: v })} />
                  <Field label="Route (a patrol’s name)" value={g.route} placeholder="Orc Route" onCommit={(v) => set({ route: v.trim() })} />
                  <label className="pz-field">
                    <span className="pz-label">There</span>
                    <select className="inp small" aria-label="Schedule" value={g.schedule} onChange={(e) => set({ schedule: e.target.value as CharacterGroup['schedule'] })}>
                      <option value="always">Always</option>
                      <option value="day">By day</option>
                      <option value="night">By night</option>
                    </select>
                  </label>
                  <Field label="Faction" value={g.faction} placeholder="Orcs" onCommit={(v) => set({ faction: v.trim() })} />
                  <NumberField label="Seed" unit="" min={1} max={999999} step={1} value={g.seed} onCommit={(v) => set({ seed: v })} />
                </div>
                <label className="cc-check">
                  <input type="checkbox" checked={g.persists} onChange={(e) => set({ persists: e.target.checked })} /> Stays as left when the player comes back
                </label>
              </section>
            </div>

            <section className="pz-sec" aria-label="Group preview">
              <div className="cc-sec-head">
                <span className="pz-label">
                  Preview: {pop?.members.length ?? 0} people on {area.w} × {area.d} m
                </span>
                <span className="cc-preview-tools">
                  <NumberField label="Preview width" bare unit="m" min={4} max={500} step={1} value={area.w} onCommit={(v) => setArea((a) => ({ ...a, w: v }))} />
                  <NumberField label="Preview depth" bare unit="m" min={4} max={500} step={1} value={area.d} onCommit={(v) => setArea((a) => ({ ...a, d: v }))} />
                  <button className="tb-btn small" onClick={() => set({ seed: 1 + ((g.seed * 48271) % 999983) })}>
                    Reshuffle
                  </button>
                </span>
              </div>
              <svg className="cc-arena" viewBox={`${(-area.w / 2) * k} ${(-area.d / 2) * k} ${W} ${area.d * k}`} role="img" aria-label={`${g.name}: ${pop?.members.length ?? 0} people`}>
                <rect x={(-area.w / 2) * k} y={(-area.d / 2) * k} width={W} height={area.d * k} fill="var(--ground)" stroke="var(--border)" />
                {pop?.members.map((m) => {
                  const c = project.objects[m.character];
                  const tint = c?.type === 'character' ? profileOf(c).art.placeholder.tint : '#888';
                  return (
                    <g key={m.key}>
                      {m.activity === 'wander' && g.wanderRadius > 0 && <circle cx={m.x * k} cy={m.y * k} r={g.wanderRadius * k} fill="none" stroke={tint} strokeOpacity={0.12} />}
                      <line x1={m.x * k} y1={m.y * k} x2={(m.x + Math.sin(m.yaw) * 0.8) * k} y2={(m.y - Math.cos(m.yaw) * 0.8) * k} stroke={tint} strokeWidth="1.5" />
                      <circle cx={m.x * k} cy={m.y * k} r={Math.max(2.5, 0.35 * k)} fill={tint}>
                        <title>
                          {c?.name ?? '?'} · {ACTIVITIES.find((a) => a.id === m.activity)?.label}
                        </title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
              {pop?.notes.map((n) => (
                <p key={n} className="pz-issue warning">
                  ! {n}
                </p>
              ))}
            </section>

            <section className="pz-sec" aria-label="Where it is">
              <span className="pz-label">In the levels</span>
              {placed.length ? (
                <ul className="pz-issues">
                  {placed.map((i) => (
                    <li key={i.id}>
                      <button className="pz-issue" onClick={() => onOpenLevels?.(i.id)}>
                        {i.name} <span className="muted">· {levelsOf(project).levels.find((l) => l.id === i.levelId)?.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pz-says">Not in a level yet. In Levels, put a Character group (Actors) on a square or street and pick {g.name}; draw it freeform for an irregular shape.</p>
              )}
            </section>

            <section className="pz-sec" aria-label="Group problems">
              <span className="pz-label">To fix and check</span>
              {problems.length ? (
                <ul className="pz-issues">
                  {problems.map((p, i) => (
                    <li key={i} className={`pz-issue ${p.severity}`}>
                      {p.severity === 'error' ? '✕' : '!'} {p.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pz-ok">Nothing wrong.</p>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
};
