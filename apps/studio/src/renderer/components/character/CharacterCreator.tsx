import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadText, readText } from '../../files';
import { ABILITY_CATEGORIES, ABILITY_LIBRARY, RESOURCES, type AbilityCategory, type Resource } from '../../model/character/abilities';
import {
  addCustomAbility,
  addLibraryAbility,
  addSkillAbility,
  addSlot,
  capacityOf,
  characterIssues,
  characters,
  describeCard,
  duplicateAbility,
  duplicateCharacter,
  equipStarting,
  exportCharacter,
  fitsSlot,
  grayboxOf,
  importCharacter,
  INVENTORY_MODES,
  itemsLibrary,
  matchesCharacter,
  MOVEMENTS,
  moveAbility,
  OVERFLOWS,
  patchInventory,
  patchProfile,
  patchStats,
  profileOf,
  removeAbility,
  removeSlot,
  roleLabel,
  ROLES,
  setStartingItem,
  STAT_RANGES,
  toggleRole,
  uniqueSlug,
  updateAbility,
  type CharacterIssue,
  type CharacterRole,
  type InventoryMode,
  type Movement,
  type Overflow,
} from '../../model/character/profile';
import { setField } from '../../model/details';
import { deletionImpact } from '../../model/impact';
import { levelsOf } from '../../model/level/level';
import { removeObject, renameObject } from '../../model/project';
import { skillsOf } from '../../model/skills';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { AbilityInspector } from './AbilityInspector';
import { ArtPane } from './ArtPane';
import { Figure } from './Figure';
import { NumberField } from './NumberField';
import { Wizard } from './Wizard';

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onOpenBible: (id?: string) => void;
  onOpenLevels?: (itemId?: string) => void;
  onSay: (text: string) => void;
  /** The character to open on. */
  focus?: string;
}

type Tab = 'dialogue' | 'ai' | 'variants' | 'placements' | 'relationships' | 'preview' | 'diagnostics';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dialogue', label: 'Dialogue & knowledge' },
  { id: 'ai', label: 'AI & detection' },
  { id: 'variants', label: 'Variants' },
  { id: 'placements', label: 'Placements' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'preview', label: '2D/3D preview' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

const CATEGORY_MARK: Record<AbilityCategory, string> = { movement: '➜', combat: '⚔', magic: '✦', utility: '⚙', social: '☺', defense: '⛨' };

const ROLE_MARK: Record<CharacterRole, string> = { player: 'P', enemy: 'E', npc: 'N', ally: 'A', extra: 'X' };

/**
 * The Character Creator (docs/specs/character-creator-spec.md §2): the one
 * character registry, with a toolbar (new, duplicate, import, export, roles,
 * search, validation), the art pane on the left, identity, abilities and
 * inventory in the centre, the selected ability or item on the right, and
 * tabs below. Every character is the story's own character element, so it
 * is a dialogue speaker, a Bible entry and a level actor's character at once.
 */
export const CharacterCreator = ({ project, onCommit, onOpenBible, onOpenLevels, onSay, focus }: Props) => {
  const all = characters(project);
  const [selected, setSelected] = useState<string | null>(() => (focus && project.objects[focus]?.type === 'character' ? focus : (all[0]?.id ?? null)));
  const [picked, setPicked] = useState<{ kind: 'ability' | 'item'; id: string } | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<CharacterRole | ''>('');
  const [wizard, setWizard] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>('diagnostics');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = selected ? project.objects[selected] : undefined;
  const ch = current?.type === 'character' ? current : undefined;
  if (selected && !ch && all[0]) setSelected(all[0].id);
  useEffect(() => setConfirmDelete(false), [selected]);

  const prof = ch ? profileOf(ch) : undefined;
  const issues = useMemo(() => (ch ? characterIssues(project, ch.id) : []), [project, ch]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const shown = all.filter((c) => matchesCharacter(c, query, roleFilter));
  const items = itemsLibrary(project);
  const skills = skillsOf(project);

  const select = (id: string) => {
    setSelected(id);
    setPicked(null);
    setAdding(false);
  };

  const duplicate = () => {
    if (!ch) return;
    const made = duplicateCharacter(project, ch.id);
    if (!made) return;
    onCommit(made.project);
    select(made.id);
    onSay(`${made.project.objects[made.id]!.name} made, with its own id.`);
  };

  const exportOne = () => {
    if (!ch) return;
    const file = exportCharacter(project, ch.id);
    if (!file) return;
    downloadText(`${profileOf(ch).slug}.character.json`, JSON.stringify(file, null, 2), 'application/json');
    onSay(`${ch.name} exported.`);
  };

  const importFile = async (f: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readText(f));
    } catch {
      onSay('That file isn’t JSON.');
      return;
    }
    const got = importCharacter(project, parsed);
    if ('error' in got) {
      onSay(got.error);
      return;
    }
    onCommit(got.project);
    select(got.id);
    onSay([`${got.project.objects[got.id]!.name} imported.`, ...got.notes].join(' '));
  };

  const remove = () => {
    if (!ch) return;
    const name = ch.name;
    onCommit(removeObject(project, ch.id));
    setSelected(null);
    onSay(`${name} deleted.`);
  };

  const placements = useMemo(() => {
    if (!ch) return [];
    const set = levelsOf(project);
    return set.items.filter((i) => i.params?.character === ch.id).map((i) => ({ item: i, level: set.levels.find((l) => l.id === i.levelId)?.name ?? '' }));
  }, [project, ch]);
  const lines = ch ? project.lines.filter((l) => l.speakerId === ch.id) : [];
  const scenes = ch ? [...new Set(project.connections.filter((c) => c.kind === 'contains' && c.targetId === ch.id).map((c) => c.sourceId))].map((id) => project.objects[id]).filter(Boolean) : [];

  const pickedCard = picked?.kind === 'ability' ? prof?.abilities.find((a) => a.id === picked.id) : undefined;
  const pickedItem = picked?.kind === 'item' ? project.objects[picked.id] : undefined;
  const cap = prof ? capacityOf(project, prof.inventory) : undefined;
  const inv = prof?.inventory;
  const limitsSlots = inv && (inv.mode === 'slots' || inv.mode === 'stack' || inv.mode === 'hybrid');
  const limitsWeight = inv && (inv.mode === 'weight' || inv.mode === 'hybrid');

  const issueList = (list: CharacterIssue[]) =>
    list.length ? (
      <ul className="pz-issues">
        {list.map((i, n) => (
          <li key={n}>
            <button
              className={`pz-issue ${i.severity}`}
              onClick={() => {
                if (i.ref && prof?.abilities.some((a) => a.id === i.ref)) setPicked({ kind: 'ability', id: i.ref });
                else if (i.ref && project.objects[i.ref]?.type === 'inventory') setPicked({ kind: 'item', id: i.ref });
              }}
            >
              {i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'} {i.text}
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="pz-ok">Nothing wrong: ready to place and export.</p>
    );

  return (
    <div className="cc">
      <header className="cc-top" aria-label="Character toolbar">
        <button className="tb-btn primary small" onClick={() => setWizard(true)}>
          + New character
        </button>
        <button className="tb-btn small" disabled={!ch} onClick={duplicate}>
          Duplicate
        </button>
        <button className="tb-btn small" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Import a character file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
        <button className="tb-btn small" disabled={!ch} onClick={exportOne}>
          Export
        </button>
        <span className="pz-sep" />
        {ch && prof && (
          <div className="cc-roles" role="group" aria-label="Roles">
            {ROLES.map((r) => (
              <button key={r.id} className={`cc-role${prof.roles.includes(r.id) ? ' on' : ''}`} aria-pressed={prof.roles.includes(r.id)} title={r.hint} onClick={() => onCommit(toggleRole(project, ch.id, r.id))}>
                {r.label}
              </button>
            ))}
          </div>
        )}
        <span className="cc-grow" />
        <input className="inp small cc-search" aria-label="Find a character" placeholder="Find by name, tag, species…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {ch && (
          <button className={`cc-state${errors.length ? ' bad' : warnings.length ? ' warn' : ' ok'}`} onClick={() => setTab('diagnostics')} title="Open the diagnostics">
            {errors.length ? `${errors.length} to fix` : warnings.length ? `${warnings.length} to check` : 'Valid'} · rev {prof?.revision ?? 0}
          </button>
        )}
      </header>

      <aside className="cc-left" aria-label="Characters">
        <select className="inp small" aria-label="Show role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as CharacterRole | '')}>
          <option value="">Every role</option>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="pz-list cc-list" role="listbox" aria-label="Character registry">
          {shown.map((c) => {
            const p = profileOf(c);
            const bad = characterIssues(project, c.id).some((i) => i.severity === 'error');
            return (
              <button key={c.id} role="option" aria-selected={c.id === selected} className={`pz-item cc-item${c.id === selected ? ' on' : ''}`} onClick={() => select(c.id)}>
                <span className="pz-item-name">
                  <span className="cc-swatch" style={{ background: p.art.placeholder.tint }} />
                  <span className="mono muted">{c.data.code ?? ''}</span> {c.name}
                </span>
                <span className="pz-item-meta">
                  {p.roles.map((r) => (
                    <span key={r} className="cc-mark" title={roleLabel(r)}>
                      {ROLE_MARK[r]}
                    </span>
                  ))}
                  {p.archetype || (p.roles.length ? '' : 'No role')}
                  {!p.enabled && <span className="pz-badge soft">off</span>}
                  {bad && <span className="pz-dot" title="Something to fix" />}
                </span>
              </button>
            );
          })}
          {!shown.length && <p className="lvl-hint">{all.length ? 'No character matches.' : 'No characters yet. Make one with + New character.'}</p>}
        </div>
        {ch && prof && <ArtPane project={project} character={ch} onCommit={onCommit} onSay={onSay} />}
      </aside>

      <section className="cc-center" aria-label="Character">
        {!ch || !prof ? (
          <div className="pz-empty">
            <h2>Character Creator</h2>
            <p>Every player character, enemy, NPC, ally and ambient extra, in one registry: their art, abilities and inventory. Each is the story’s own character, so dialogue, scenes, the Bible and the levels all use it, and a rename never breaks a link.</p>
            <button className="tb-btn primary" onClick={() => setWizard(true)}>
              + New character
            </button>
          </div>
        ) : (
          <>
            <header className="pz-head">
              <span className="mono muted">{ch.data.code ?? ''}</span>
              <h2>{ch.name}</h2>
              <button className="tb-btn small" onClick={() => onOpenBible(ch.id)}>
                Open in the Bible
              </button>
              {!confirmDelete ? (
                <button className="tb-btn small" onClick={() => setConfirmDelete(true)}>
                  Delete…
                </button>
              ) : (
                <span className="cc-confirm" role="alert">
                  {deletionImpact(project, ch.id).join(' ') || 'Nothing else refers to it.'}{' '}
                  <button className="tb-btn small danger" onClick={remove}>
                    Delete {ch.name}
                  </button>
                  <button className="tb-btn small" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </span>
              )}
            </header>

            <div className="cc-columns">
              <div className="cc-col">
                <section className="pz-sec" aria-label="Identity">
                  <span className="pz-label">Identity</span>
                  <Field label="Name" value={ch.name} onCommit={(v) => v.trim() && onCommit(renameObject(project, ch.id, v.trim()))} />
                  <Field
                    label="Internal id"
                    value={prof.slug}
                    hint="Kept when it is renamed; the engines and saves use it."
                    onCommit={(v) => onCommit(patchProfile(project, ch.id, { slug: uniqueSlug(project, v, ch.id) }))}
                  />
                  <div className="cc-pair">
                    <Field label="Archetype" value={prof.archetype} placeholder="Orc, merchant, guard" onCommit={(v) => onCommit(patchProfile(project, ch.id, { archetype: v.trim() }))} />
                    <Field label="Species" value={prof.species} placeholder="Human, orc, eel" onCommit={(v) => onCommit(patchProfile(project, ch.id, { species: v.trim() }))} />
                  </div>
                  <Field label="Presentation (optional)" value={prof.presentation} hint="Only where the story wants it; it never decides behaviour." onCommit={(v) => onCommit(patchProfile(project, ch.id, { presentation: v.trim() }))} />
                  <Field label="Appearance" multiline rows={2} value={prof.appearance} placeholder="Scarred, in a guard’s tabard" onCommit={(v) => onCommit(patchProfile(project, ch.id, { appearance: v.trim() }))} />
                  <Field
                    label="Tags"
                    value={prof.tags.join(', ')}
                    placeholder="With commas: village, market"
                    onCommit={(v) => onCommit(patchProfile(project, ch.id, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }))}
                  />
                  <label className="cc-check">
                    <input type="checkbox" checked={prof.enabled} onChange={(e) => onCommit(patchProfile(project, ch.id, { enabled: e.target.checked }))} /> Enabled (off keeps it in the registry but out of the game)
                  </label>
                </section>

                <section className="pz-sec" aria-label="Body and movement">
                  <span className="pz-label">Body and movement</span>
                  <div className="cc-stats">
                    {(Object.keys(STAT_RANGES) as (keyof typeof STAT_RANGES)[]).map((k) => (
                      <NumberField key={k} label={STAT_RANGES[k].label} unit={STAT_RANGES[k].unit} min={STAT_RANGES[k].min} max={STAT_RANGES[k].max} step={STAT_RANGES[k].step} value={prof.stats[k]} onCommit={(v) => onCommit(patchStats(project, ch.id, { [k]: v }))} />
                    ))}
                    <label className="pz-field">
                      <span className="pz-label">Movement</span>
                      <select className="inp" aria-label="Movement" value={prof.stats.movement} onChange={(e) => onCommit(patchStats(project, ch.id, { movement: e.target.value as Movement }))}>
                        {MOVEMENTS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="pz-field">
                      <span className="pz-label">Resource</span>
                      <select className="inp" aria-label="Resource" value={prof.stats.resource.kind} onChange={(e) => onCommit(patchStats(project, ch.id, { resource: { kind: e.target.value as Resource, max: prof.stats.resource.max || 100 } }))}>
                        {RESOURCES.filter((r) => r.id !== 'health').map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id === 'none' ? 'None' : r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {prof.stats.resource.kind !== 'none' && (
                      <NumberField label={`Max ${prof.stats.resource.kind}`} unit="pts" min={0} max={100000} step={1} value={prof.stats.resource.max} onCommit={(v) => onCommit(patchStats(project, ch.id, { resource: { ...prof.stats.resource, max: v } }))} />
                    )}
                  </div>
                </section>
              </div>

              <div className="cc-col">
                <section className="pz-sec" aria-label="Skills and powers">
                  <div className="cc-sec-head">
                    <span className="pz-label">Skills & powers</span>
                    <button className="tb-btn small" aria-expanded={adding} onClick={() => setAdding(!adding)}>
                      + Add
                    </button>
                  </div>
                  {adding && (
                    <div className="cc-library" aria-label="Ability library">
                      {ABILITY_CATEGORIES.map((cat) => (
                        <div key={cat.id} className="cc-lib-cat">
                          <span className="cc-lib-head">{cat.label}</span>
                          {ABILITY_LIBRARY.filter((a) => a.category === cat.id).map((a) => (
                            <button
                              key={a.key}
                              className="cc-lib-btn"
                              title={`${a.defaults.description} ${a.note}`}
                              onClick={() => {
                                const r = addLibraryAbility(project, ch.id, a.key);
                                onCommit(r.project);
                                if (r.cardId) setPicked({ kind: 'ability', id: r.cardId });
                              }}
                            >
                              {a.name}
                              <span className={`cc-gb ${a.graybox}`}>{a.graybox === 'working' ? 'plays' : 'stub'}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {skills.length > 0 && (
                        <div className="cc-lib-cat">
                          <span className="cc-lib-head">This game’s skills</span>
                          {skills.map((s) => (
                            <button
                              key={s.id}
                              className="cc-lib-btn"
                              onClick={() => {
                                const r = addSkillAbility(project, ch.id, s.id);
                                onCommit(r.project);
                                if (r.cardId) setPicked({ kind: 'ability', id: r.cardId });
                              }}
                            >
                              {s.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="cc-lib-cat">
                        <span className="cc-lib-head">Your own</span>
                        <button
                          className="cc-lib-btn"
                          onClick={() => {
                            const r = addCustomAbility(project, ch.id);
                            onCommit(r.project);
                            setPicked({ kind: 'ability', id: r.cardId });
                            setAdding(false);
                          }}
                        >
                          Custom power…
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="cc-cards">
                    {prof.abilities.map((a, i) => {
                      const gb = grayboxOf(a);
                      const bad = issues.some((x) => x.ref === a.id && x.severity === 'error');
                      return (
                        <div key={a.id} className={`cc-card${picked?.id === a.id ? ' on' : ''}${a.enabled ? '' : ' off'}${bad ? ' broken' : ''}`}>
                          <button className="cc-card-main" aria-label={`${a.name}, ${a.kind}${a.enabled ? '' : ', disabled'}`} onClick={() => setPicked({ kind: 'ability', id: a.id })}>
                            <span className={`cc-cat cc-cat-${a.category}`} aria-hidden="true">
                              {CATEGORY_MARK[a.category]}
                            </span>
                            <span className="cc-card-text">
                              <span className="cc-card-name">
                                {a.name} <span className="muted">· rank {a.rank}</span>
                              </span>
                              <span className="cc-card-desc">{describeCard(a)}</span>
                              <span className="cc-card-tags">
                                <span className="pz-badge soft">{a.kind}</span>
                                <span className={`cc-gb ${gb}`}>{gb === 'working' ? 'plays' : 'stub'}</span>
                                {a.source.kind === 'skill' && <span className="pz-badge soft">skill</span>}
                                {Object.keys(a.overrides).length > 0 && <span className="pz-badge soft">tuned</span>}
                              </span>
                            </span>
                          </button>
                          <span className="cc-card-tools">
                            <button className="icon-btn small" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => onCommit(moveAbility(project, ch.id, a.id, -1))}>
                              ↑
                            </button>
                            <button className="icon-btn small" aria-label={`Move ${a.name} down`} disabled={i === prof.abilities.length - 1} onClick={() => onCommit(moveAbility(project, ch.id, a.id, 1))}>
                              ↓
                            </button>
                            <button className="icon-btn small" aria-label={`${a.enabled ? 'Disable' : 'Enable'} ${a.name}`} onClick={() => onCommit(updateAbility(project, ch.id, a.id, { enabled: !a.enabled }))}>
                              {a.enabled ? '◉' : '○'}
                            </button>
                            <button
                              className="icon-btn small"
                              aria-label={`Duplicate ${a.name}`}
                              onClick={() => {
                                const r = duplicateAbility(project, ch.id, a.id);
                                onCommit(r.project);
                                if (r.cardId) setPicked({ kind: 'ability', id: r.cardId });
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              className="icon-btn small"
                              aria-label={`Remove ${a.name}`}
                              onClick={() => {
                                onCommit(removeAbility(project, ch.id, a.id));
                                if (picked?.id === a.id) setPicked(null);
                              }}
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      );
                    })}
                    {!prof.abilities.length && <p className="lvl-hint">No skills or powers yet. + Add one from the library, your game’s skills, or build your own.</p>}
                  </div>
                </section>

                {inv && cap && (
                  <section className="pz-sec" aria-label="Inventory">
                    <span className="pz-label">Inventory</span>
                    <div className="cc-pair">
                      <label className="pz-field">
                        <span className="pz-label">Capacity</span>
                        <select className="inp" aria-label="Capacity" value={inv.mode} onChange={(e) => onCommit(patchInventory(project, ch.id, { mode: e.target.value as InventoryMode }))}>
                          {INVENTORY_MODES.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="pz-field">
                        <span className="pz-label">When full</span>
                        <select className="inp" aria-label="When full" value={inv.overflow} disabled={inv.mode === 'unlimited'} onChange={(e) => onCommit(patchInventory(project, ch.id, { overflow: e.target.value as Overflow }))}>
                          {OVERFLOWS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="pz-says">{INVENTORY_MODES.find((m) => m.id === inv.mode)?.hint}</p>
                    <div className="cc-pair">
                      {limitsSlots && <NumberField label="Slots" unit="" min={1} max={500} step={1} value={inv.slots} onCommit={(v) => onCommit(patchInventory(project, ch.id, { slots: v }))} />}
                      {(inv.mode === 'stack' || inv.mode === 'hybrid') && <NumberField label="Stack size" unit="" min={1} max={9999} step={1} value={inv.stack} onCommit={(v) => onCommit(patchInventory(project, ch.id, { stack: v }))} />}
                      {limitsWeight && <NumberField label="Carries" unit="kg" min={0} max={10000} step={0.5} value={inv.weight} onCommit={(v) => onCommit(patchInventory(project, ch.id, { weight: v }))} />}
                    </div>
                    {(limitsSlots || limitsWeight) && (
                      <div className="cc-meters">
                        {limitsSlots && <Meter label="Slots" used={cap.slots.used} of={cap.slots.of} unit="" />}
                        {limitsWeight && <Meter label="Weight" used={cap.weight.used} of={cap.weight.of} unit=" kg" />}
                      </div>
                    )}
                    <label className="cc-check">
                      <input type="checkbox" checked={inv.persists} onChange={(e) => onCommit(patchInventory(project, ch.id, { persists: e.target.checked }))} /> Carried between scenes
                    </label>
                    <span className="pz-label">Starting items</span>
                    <ul className="cc-items">
                      {inv.items.map(({ item, qty }) => {
                        const o = project.objects[item];
                        return (
                          <li key={item} className={`cc-itemrow${picked?.id === item ? ' on' : ''}`}>
                            <button className="cc-item-name" onClick={() => setPicked({ kind: 'item', id: item })}>
                              {o?.name ?? 'Missing item'}
                            </button>
                            <NumberField label={`${o?.name ?? 'Item'} quantity`} bare unit="" min={0} max={9999} step={1} value={qty} onCommit={(v) => onCommit(setStartingItem(project, ch.id, item, v))} />
                            <button className="icon-btn small" aria-label={`Remove ${o?.name ?? 'item'}`} onClick={() => onCommit(setStartingItem(project, ch.id, item, 0))}>
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <select
                      className="inp small"
                      aria-label="Add a starting item"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        onCommit(setStartingItem(project, ch.id, e.target.value, 1));
                        setPicked({ kind: 'item', id: e.target.value });
                      }}
                    >
                      <option value="">{items.length ? '+ Add an item from the item library…' : 'No items in the game yet: add some in the Bible'}</option>
                      {items
                        .filter((it) => !inv.items.some((x) => x.item === it.id))
                        .map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                    </select>
                    <span className="pz-label">Equipment slots</span>
                    <ul className="cc-items">
                      {inv.equipment.map((e) => {
                        const fits = items.filter((it) => fitsSlot(project, it.id, e.slot));
                        const bad = issues.some((x) => x.ref === e.slot && x.severity === 'error');
                        return (
                          <li key={e.slot} className={`cc-itemrow${bad ? ' broken' : ''}`}>
                            <span className="cc-slot">{e.slot}</span>
                            <select className="inp small" aria-label={`${e.slot} slot`} value={e.item ?? ''} onChange={(x) => onCommit(equipStarting(project, ch.id, e.slot, x.target.value || undefined))}>
                              <option value="">Empty</option>
                              {e.item && !fits.some((f) => f.id === e.item) && <option value={e.item}>{project.objects[e.item]?.name ?? 'Missing item'} (doesn’t fit)</option>}
                              {fits.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.name}
                                </option>
                              ))}
                            </select>
                            <button className="icon-btn small" aria-label={`Remove the ${e.slot} slot`} onClick={() => onCommit(removeSlot(project, ch.id, e.slot))}>
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <NewSlot onAdd={(s) => onCommit(addSlot(project, ch.id, s))} />
                  </section>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="cc-right" aria-label="Properties">
        {ch && prof && pickedCard ? (
          <AbilityInspector project={project} characterId={ch.id} card={pickedCard} onCommit={onCommit} onClose={() => setPicked(null)} onOpenBible={onOpenBible} />
        ) : ch && prof && pickedItem ? (
          <div className="pz-inspector">
            <div className="cc-sec-head">
              <span className="pz-label">Item</span>
              <button className="icon-btn small" aria-label="Close" onClick={() => setPicked(null)}>
                ×
              </button>
            </div>
            <h3 className="cc-insp-title">{pickedItem.name}</h3>
            <p className="pz-says">{String(pickedItem.data.category ?? 'No category')} · {pickedItem.data.stacks === 'One at a time' ? 'one at a time' : 'stacks'} · {pickedItem.data.weight !== undefined && pickedItem.data.weight !== '' ? `${String(pickedItem.data.weight)} kg` : 'no weight set'}</p>
            {pickedItem.notes && <p className="pz-says">{pickedItem.notes}</p>}
            <Field label="Weight (kg)" value={pickedItem.data.weight === undefined ? '' : String(pickedItem.data.weight)} hint="Used by weight limits. It is the item’s own, so every character carrying it shares it." onCommit={(v) => onCommit(setItemWeight(project, pickedItem.id, v))} />
            <button className="tb-btn small" onClick={() => onOpenBible(pickedItem.id)}>
              Open the item in the Bible
            </button>
          </div>
        ) : ch && prof ? (
          <div className="pz-inspector">
            <span className="pz-label">Summary</span>
            <div className="cc-summary">
              <Figure placeholder={prof.art.placeholder} height={120} title={`${ch.name} at a glance`} />
              <div>
                <p className="pz-says">
                  {prof.roles.length ? prof.roles.map(roleLabel).join(' · ') : 'No role yet'}
                  <br />
                  {prof.abilities.filter((a) => a.enabled).length} abilities · {prof.inventory.items.length} starting items
                  <br />
                  {lines.length} lines in {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {placements.length} placed
                </p>
              </div>
            </div>
            <p className="pref-hint">Select an ability or an item to edit it here.</p>
            <span className="pz-label">To fix and check</span>
            {issueList(issues.filter((i) => i.severity !== 'info'))}
          </div>
        ) : (
          <p className="lvl-hint">Nothing selected.</p>
        )}
      </aside>

      <section className="cc-bottom" aria-label="More about the character">
        <div className="view-toggle" role="tablist" aria-label="More">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'diagnostics' && issues.length > 0 && <span className="lvl-count">{issues.length}</span>}
            </button>
          ))}
        </div>
        <div className="cc-tab" role="tabpanel">
          {!ch || !prof ? (
            <p className="lvl-hint">Make or pick a character.</p>
          ) : tab === 'dialogue' ? (
            <p className="pz-says">
              {ch.name} is a speaker in every scene’s script{lines.length ? `, with ${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}
              {scenes.length ? ` and in ${scenes.map((s) => s!.name).join(', ')}` : ''}. Lines point at the character’s id, so a rename here renames every cue. Topics, quest flags and dialogue entrances come with NPC profiles (phase 2).
            </p>
          ) : tab === 'ai' ? (
            <p className="pz-says">
              {prof.roles.includes('enemy') || prof.roles.includes('ally')
                ? `The AI profile (perception, reaction, pursuit, tactics, the Idle → Patrol → Alert → Chase → Attack → Search → Return state machine) comes in phase 2. Until then a placed ${prof.roles.includes('enemy') ? 'enemy patrols' : 'ally follows'} as its level actor says, and its Perception ability (${prof.abilities.find((a) => a.source.kind === 'library' && a.source.key === 'perception') ? 'set' : 'not set'}) is its sight distance.`
                : 'This role has no AI to set. Give it the Enemy NPC or Ally role for an AI profile (phase 2).'}
            </p>
          ) : tab === 'variants' ? (
            <p className="pz-says">Escalating variants (Orc → Orc Guard → Orc Elite) that inherit this character and list only what differs, with guardrails on stat growth and spawn budget, come in phase 2. Duplicate makes an independent copy today.</p>
          ) : tab === 'placements' ? (
            placements.length ? (
              <ul className="pz-issues">
                {placements.map(({ item, level }) => (
                  <li key={item.id}>
                    <button className="pz-issue" onClick={() => onOpenLevels?.(item.id)}>
                      {item.name} <span className="muted">· {level}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pz-says">Not placed in a level yet. Put an NPC, Companion, Enemy or Neutral actor on a map in Levels and pick {ch.name} as its character.</p>
            )
          ) : tab === 'relationships' ? (
            <div className="cc-pair">
              <Field label="Faction" value={String(ch.data.faction ?? '')} placeholder="The Order" onCommit={(v) => onCommit(setText(project, ch.id, 'faction', v))} />
              <Field label="Relationships" multiline rows={2} value={String(ch.data.relationships ?? '')} placeholder="Distrusts the Order; owes the explorer" onCommit={(v) => onCommit(setText(project, ch.id, 'relationships', v))} />
            </div>
          ) : tab === 'preview' ? (
            <div className="cc-preview">
              <Figure placeholder={prof.art.placeholder} height={110} title={`${ch.name} placeholder, front`} />
              <svg width="120" height="110" viewBox="-60 -55 120 110" role="img" aria-label="On the 2D map: its marker, facing and interaction radius">
                <circle r={Math.min(50, prof.stats.interactionRadius * 12)} fill="none" stroke="var(--gold-lo)" strokeDasharray="3 3" />
                <circle r={Math.max(4, prof.stats.radius * 12)} fill={prof.art.placeholder.tint} />
                <path d={`M0 ${-Math.max(4, prof.stats.radius * 12) - 8} l-4 6 h8 Z`} fill={prof.art.placeholder.tint} />
              </svg>
              <p className="pz-says">
                Front, and on the 2D map with its interaction radius ({prof.stats.interactionRadius} m). In the 3D graybox it stands {prof.stats.height} m tall with a {prof.stats.radius} m collider; Running, Jumping and Perception play there today, the rest are labelled stubs.
              </p>
            </div>
          ) : (
            issueList(issues)
          )}
        </div>
      </section>

      {wizard && (
        <Wizard
          project={project}
          onCancel={() => setWizard(false)}
          onDone={(next, id) => {
            onCommit(next);
            setWizard(false);
            select(id);
            onSay(`${next.objects[id]!.name} is in the registry, and a dialogue speaker now.`);
          }}
        />
      )}
    </div>
  );
};

const setText = (project: Project, id: string, key: string, v: string): Project => setField(project, id, key, v);

const setItemWeight = (project: Project, id: string, v: string): Project => {
  const n = Number(v);
  return setText(project, id, 'weight', v.trim() && Number.isFinite(n) && n >= 0 ? String(n) : '');
};

const Meter = ({ label, used, of, unit }: { label: string; used: number; of: number; unit: string }) => {
  const over = used > of;
  return (
    <div className={`cc-meter${over ? ' over' : ''}`} role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={of}>
      <span className="cc-meter-label">
        {label} {used}
        {unit} of {of}
        {unit}
      </span>
      <span className="cc-meter-bar">
        <span style={{ width: `${Math.min(100, of > 0 ? (used / of) * 100 : 100)}%` }} />
      </span>
    </div>
  );
};

const NewSlot = ({ onAdd }: { onAdd: (slot: string) => void }) => {
  const [name, setName] = useState('');
  return (
    <form
      className="cc-newslot"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName('');
      }}
    >
      <input className="inp small" aria-label="New equipment slot" placeholder="Another slot: Back, Belt" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="tb-btn small" disabled={!name.trim()}>
        + Slot
      </button>
    </form>
  );
};

