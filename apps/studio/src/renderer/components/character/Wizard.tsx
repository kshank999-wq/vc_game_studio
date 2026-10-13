import { useState } from 'react';
import { ABILITY_CATEGORIES, ABILITY_LIBRARY } from '../../model/character/abilities';
import { ARCHETYPES, archetypeOf, createCharacter, INVENTORY_MODES, itemsLibrary, overrideAbility, patchStats, profileOf, ROLES, setStartingItem, type CharacterRole, type InventoryMode } from '../../model/character/profile';
import type { Project } from '../../model/types';
import { Figure } from './Figure';
import { NumberField } from './NumberField';

const STEPS = ['Role', 'Archetype', 'Abilities', 'Inventory', 'Settings', 'Name'] as const;

/**
 * The creation wizard (spec §2): role → baseline archetype → abilities →
 * inventory → role-specific settings → save to the registry. Everything it
 * sets can be changed afterwards in the Character Creator.
 */
export const Wizard = ({ project, onCancel, onDone }: { project: Project; onCancel: () => void; onDone: (project: Project, id: string) => void }) => {
  const [step, setStep] = useState(0);
  const [roles, setRoles] = useState<CharacterRole[]>([]);
  const [archetype, setArchetype] = useState('blank');
  const [abilities, setAbilities] = useState<string[]>([]);
  const [mode, setMode] = useState<InventoryMode>('unlimited');
  const [slots, setSlots] = useState(12);
  const [items, setItems] = useState<string[]>([]);
  const [interaction, setInteraction] = useState(2);
  const [sight, setSight] = useState(12);
  const [health, setHealth] = useState(100);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const arch = archetypeOf(archetype)!;
  const library = itemsLibrary(project);

  const pickArchetype = (id: string) => {
    const a = archetypeOf(id)!;
    setArchetype(id);
    setAbilities(a.abilities);
    setHealth(a.stats.health ?? 100);
    if (!roles.length && a.roles[0]) setRoles([a.roles[0]]);
  };

  const finish = () => {
    const made = createCharacter(project, { name: name || arch.label || 'New character', roles, archetype, species, abilities, inventory: { mode, slots } });
    let p = made.project;
    for (const item of items) p = setStartingItem(p, made.id, item, 1);
    p = patchStats(p, made.id, { health, interactionRadius: interaction });
    // Perception is the sight distance a placed actor sees by (graybox: working).
    if (roles.includes('enemy') && sight !== 12) {
      const card = profileOf(p.objects[made.id]!).abilities.find((a) => a.source.kind === 'library' && a.source.key === 'perception');
      if (card) p = overrideAbility(p, made.id, card.id, { range: sight });
    }
    onDone(p, made.id);
  };

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const fight = roles.includes('enemy') || roles.includes('ally');
  const talks = roles.includes('npc') || roles.includes('ally');

  return (
    <div className="dialog-backdrop" onPointerDown={onCancel}>
      <div className="dialog wide cc-wizard" role="dialog" aria-modal="true" aria-label="New character" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>New character</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>
        <ol className="cc-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        <div className="cc-wizard-body">
          {step === 0 && (
            <div className="pz-scales" role="group" aria-label="Role">
              {ROLES.map((r) => (
                <label key={r.id} className={`pz-scale${roles.includes(r.id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={roles.includes(r.id)} onChange={() => setRoles(toggle(roles, r.id))} />
                  <strong>{r.label}</strong>
                  <span className="pref-hint">{r.hint}</span>
                </label>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className="pz-scales" role="radiogroup" aria-label="Archetype">
              {ARCHETYPES.map((a) => (
                <label key={a.id} className={`pz-scale cc-arch${archetype === a.id ? ' on' : ''}`}>
                  <input type="radio" name="archetype" checked={archetype === a.id} onChange={() => pickArchetype(a.id)} />
                  <Figure placeholder={{ silhouette: a.placeholder.silhouette ?? 'humanoid', tint: a.placeholder.tint ?? '#888', label: '', scale: 1, prop: a.placeholder.prop ?? 'none' }} height={56} title={a.label} />
                  <strong>{a.label}</strong>
                  <span className="pref-hint">{a.hint}</span>
                </label>
              ))}
            </div>
          )}
          {step === 2 && (
            <div className="cc-library" aria-label="Abilities">
              {ABILITY_CATEGORIES.map((cat) => (
                <div key={cat.id} className="cc-lib-cat">
                  <span className="cc-lib-head">{cat.label}</span>
                  {ABILITY_LIBRARY.filter((a) => a.category === cat.id).map((a) => (
                    <label key={a.key} className={`cc-lib-btn${abilities.includes(a.key) ? ' on' : ''}`} title={a.defaults.description}>
                      <input type="checkbox" checked={abilities.includes(a.key)} onChange={() => setAbilities(toggle(abilities, a.key))} /> {a.name}
                      <span className={`cc-gb ${a.graybox}`}>{a.graybox === 'working' ? 'plays' : 'stub'}</span>
                    </label>
                  ))}
                </div>
              ))}
              <p className="pref-hint">“Plays” abilities work in the 3D graybox today; stubs are kept and exported for the engine side. Custom powers and your game’s skills can be added after.</p>
            </div>
          )}
          {step === 3 && (
            <div className="pz-writing">
              <label className="pz-field">
                <span className="pz-label">Capacity</span>
                <select className="inp" aria-label="Capacity" value={mode} onChange={(e) => setMode(e.target.value as InventoryMode)}>
                  {INVENTORY_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}: {m.hint}
                    </option>
                  ))}
                </select>
              </label>
              {mode !== 'unlimited' && mode !== 'weight' && <NumberField label="Slots" unit="" min={1} max={500} step={1} value={slots} onCommit={setSlots} />}
              <span className="pz-label">Starting items</span>
              {library.length ? (
                <div className="cc-wiz-items">
                  {library.map((it) => (
                    <label key={it.id} className="cc-check">
                      <input type="checkbox" checked={items.includes(it.id)} onChange={() => setItems(toggle(items, it.id))} /> {it.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="pref-hint">No items in the game yet. Add them in the Bible, then give them here or in the Character Creator.</p>
              )}
            </div>
          )}
          {step === 4 && (
            <div className="pz-writing">
              <NumberField label="Health" unit="pts" min={1} max={100000} step={1} value={health} onCommit={setHealth} />
              {(talks || roles.includes('player') || !roles.length) && <NumberField label="Interaction radius" unit="m" min={0} max={20} step={0.1} value={interaction} onCommit={setInteraction} />}
              {roles.includes('enemy') && abilities.includes('perception') && <NumberField label="Sight distance" unit="m" min={0} max={200} step={0.5} value={sight} onCommit={setSight} />}
              {fight && <p className="pref-hint">The full AI profile (perception, pursuit, tactics, the state machine) comes with phase 2; until then a placed enemy patrols and an ally follows as its level actor says.</p>}
              {roles.includes('extra') && <p className="pref-hint">Ambient extras keep to lightweight loops: walk, idle, talk, work, flee. Promote one to an NPC any time without losing where it is placed.</p>}
              {roles.includes('player') && <p className="pref-hint">Controller mappings are Play Mode’s (Levels › Play); respawn and failure follow the story’s game-over endings.</p>}
            </div>
          )}
          {step === 5 && (
            <div className="pz-writing">
              <label className="pz-field">
                <span className="pz-label">Name</span>
                <input className="inp" aria-label="Character name" autoFocus placeholder={arch.id === 'blank' ? 'Mara, Grub the Orc' : arch.label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && finish()} />
              </label>
              <label className="pz-field">
                <span className="pz-label">Species</span>
                <input className="inp" aria-label="Species" placeholder="Human, orc, eel" value={species} onChange={(e) => setSpecies(e.target.value)} />
              </label>
              <p className="pref-hint">It goes in the registry at once: a dialogue speaker in every scene, a Bible entry, and a character for level actors.</p>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onCancel}>
            Cancel
          </button>
          <span className="cc-grow" />
          <button type="button" className="tb-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="tb-btn primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="tb-btn primary" onClick={finish}>
              Save to the registry
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
