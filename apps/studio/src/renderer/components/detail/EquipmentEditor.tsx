import { setValue } from '../../model/details';
import { equipmentOf, type Equipment } from '../../model/equipment';
import type { Project, StoryObject } from '../../model/types';

/** Slots a game is likely to have; any other name works too. */
const SLOTS = ['Hand', 'Off hand', 'Head', 'Body', 'Light', 'Tool'];

/**
 * An inventory item as equipment (spec §8): its slot, its stats (names and
 * numbers, for the game to read), what ammunition a use spends, and how many
 * uses it has before it breaks.
 */
export const EquipmentEditor = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
  const e = equipmentOf(object);
  const set = (patch: Partial<Equipment> | null) => onCommit(setValue(project, object.id, 'equip', patch === null ? undefined : { ...(e ?? { slot: 'Hand', stats: [], ammoPerUse: 1, durability: 0 }), ...patch }));
  const items = Object.values(project.objects).filter((o) => o.type === 'inventory' && o.id !== object.id).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="equipment-editor">
      <label className="check">
        <input type="checkbox" checked={!!e} onChange={(ev) => set(ev.currentTarget.checked ? {} : null)} /> Can be equipped
        <span className="pref-hint">{e ? 'a weapon, a tool, something worn' : 'as a weapon, tool or something worn'}</span>
      </label>
      {e && (
        <>
          <label className="dfld">
            <span>Slot</span>
            <input className="inp small" list="equipment-slots" aria-label="Slot" defaultValue={e.slot} key={e.slot} onBlur={(ev) => set({ slot: ev.currentTarget.value.trim() || 'Hand' })} />
            <datalist id="equipment-slots">
              {SLOTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="dfld">
            <span>Stats</span>
            {e.stats.map((st, i) => (
              <div key={i} className="equipment-stat">
                <input className="inp small" aria-label={`Stat ${i + 1} name`} defaultValue={st.name} onBlur={(ev) => set({ stats: e.stats.map((x, j) => (j === i ? { ...x, name: ev.currentTarget.value } : x)).filter((x) => x.name.trim()) })} />
                <input className="inp small equipment-number" type="number" aria-label={`Stat ${i + 1} value`} value={st.value} onChange={(ev) => set({ stats: e.stats.map((x, j) => (j === i ? { ...x, value: Number(ev.currentTarget.value) || 0 } : x)) })} />
                <button className="icon-btn small" aria-label={`Remove ${st.name}`} onClick={() => set({ stats: e.stats.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <button className="chip-add small" onClick={() => set({ stats: [...e.stats, { name: e.stats.length ? 'Stat' : 'Damage', value: 1 }] })}>
              + Stat
            </button>
          </div>
          <div className="dfld">
            <span>Each use spends</span>
            <div className="skill-cost">
              <input className="inp small equipment-number" type="number" min={1} aria-label="Ammunition per use" value={e.ammoPerUse} disabled={!e.ammo} onChange={(ev) => set({ ammoPerUse: Math.max(1, Number(ev.currentTarget.value) || 1) })} />
              <span className="muted">×</span>
              <select className="inp small" aria-label="Ammunition" value={e.ammo ?? ''} onChange={(ev) => set({ ammo: ev.currentTarget.value || undefined })}>
                <option value="">Nothing</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="dfld">
            <span>Uses before it breaks</span>
            <input className="inp small equipment-number" type="number" min={0} aria-label="Durability" value={e.durability} onChange={(ev) => set({ durability: Math.max(0, Number(ev.currentTarget.value) || 0) })} />
            <span className="pref-hint">{e.durability ? `it breaks after ${e.durability} ${e.durability === 1 ? 'use' : 'uses'}, and is gone` : '0: it never breaks'}</span>
          </label>
        </>
      )}
    </div>
  );
};
