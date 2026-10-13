import { useState } from 'react';
import { itemsLibrary, patchRole, type CharacterProfile } from '../../model/character/profile';
import { SERVICES, type NpcProfile, type Topic } from '../../model/character/roles';
import { newId } from '../../model/project';
import type { Rule } from '../../model/rules';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  id: string;
  profile: CharacterProfile;
  onCommit: (p: Project) => void;
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Dialogue & knowledge (spec §6.3): what an interactive NPC is for (talks,
 * sells, gives quests, answers questions), when it can be talked to, its
 * prompt and responses, and the topics it knows, each tied to the script
 * lines it says by line id, so renaming the character or rewriting the
 * line never breaks the link. Its lines and scenes come from the script:
 * the character is the speaker the script's cue list already offers.
 */
export const DialoguePanel = ({ project, id, profile, onCommit }: Props) => {
  const npc = profile.npc;
  const set = (patch: Partial<NpcProfile>) => onCommit(patchRole(project, id, 'npc', patch));
  const setTopic = (tid: string, patch: Partial<Topic>) => set({ topics: npc.topics.map((t) => (t.id === tid ? { ...t, ...patch } : t)) });
  const [open, setOpen] = useState<string | null>(null);
  const spoken = project.lines.filter((l) => l.speakerId === id && l.kind === 'dialogue');
  const scenes = [...new Set(spoken.map((l) => l.sceneId))].map((s) => project.objects[s]).filter(Boolean);
  const flags = Object.values(project.objects).filter((o) => o.type === 'state' || o.type === 'quest');
  const places = Object.values(project.objects).filter((o) => o.type === 'scene' || o.type === 'dialogue');
  const items = itemsLibrary(project);
  const lineLabel = (lid: string) => {
    const l = project.lines.find((x) => x.id === lid);
    if (!l) return 'A line no longer in the script';
    return `${project.objects[l.sceneId]?.data.code ?? ''} “${clip(l.text)}”`;
  };
  const isNpc = profile.roles.includes('npc');

  return (
    <div className="cc-dialogue">
      {!isNpc && <p className="cc-note">These settings are kept, but used only while it has the Interactive NPC role.</p>}
      <section className="pz-sec" aria-label="In the script">
        <span className="pz-label">In the script</span>
        <p className="pz-says">
          {spoken.length ? `${spoken.length} line${spoken.length === 1 ? '' : 's'} in ${scenes.map((s) => s!.name).join(', ')}.` : 'No lines yet.'} It is in every scene’s speaker list; lines point at its id, so a rename renames every cue.
        </p>
      </section>

      <div className="cc-columns">
        <section className="pz-sec" aria-label="Interaction">
          <span className="pz-label">What it does</span>
          <div className="cc-states" role="group" aria-label="Services">
            {SERVICES.map((s) => (
              <label key={s.id} className={`cc-state-chip${npc.services.includes(s.id) ? ' on' : ''}`} title={s.hint}>
                <input type="checkbox" checked={npc.services.includes(s.id)} onChange={() => set({ services: npc.services.includes(s.id) ? npc.services.filter((x) => x !== s.id) : [...npc.services, s.id] })} /> {s.label}
              </label>
            ))}
          </div>
          <Field label="Interaction prompt" value={npc.prompt} placeholder="Talk to Mara" onCommit={(v) => set({ prompt: v.trim() })} />
          <Field label="Greeting" value={npc.greeting} placeholder="Back again?" onCommit={(v) => set({ greeting: v.trim() })} />
          <Field label="When it can’t talk" value={npc.busy} placeholder="Not now. The water’s rising." onCommit={(v) => set({ busy: v.trim() })} />
          <RuleEditor project={project} rule={npc.available} label="It can be talked to when" onChange={(r) => set({ available: r })} />
        </section>
        <section className="pz-sec" aria-label="Links">
          <span className="pz-label">Quest flags it reads or sets</span>
          <Picker
            label="Add a quest flag"
            empty="No states or quests in the story yet"
            options={flags.filter((f) => !npc.questFlags.includes(f.id)).map((f) => ({ id: f.id, label: `${f.type === 'quest' ? 'Quest' : 'State'}: ${f.name}` }))}
            chosen={npc.questFlags.map((f) => ({ id: f, label: project.objects[f]?.name ?? 'Missing' }))}
            onAdd={(f) => set({ questFlags: [...npc.questFlags, f] })}
            onRemove={(f) => set({ questFlags: npc.questFlags.filter((x) => x !== f) })}
          />
          <span className="pz-label">Dialogue entrances</span>
          <Picker
            label="Add an entrance"
            empty="No scenes or dialogue nodes yet"
            options={places.filter((f) => !npc.entrances.includes(f.id)).map((f) => ({ id: f.id, label: `${f.data.code ?? ''} ${f.name}`.trim() }))}
            chosen={npc.entrances.map((f) => ({ id: f, label: `${project.objects[f]?.data.code ?? ''} ${project.objects[f]?.name ?? 'Missing'}`.trim() }))}
            onAdd={(f) => set({ entrances: [...npc.entrances, f] })}
            onRemove={(f) => set({ entrances: npc.entrances.filter((x) => x !== f) })}
          />
          {npc.services.includes('vendor') && (
            <>
              <span className="pz-label">Sells</span>
              <label className="pz-field">
                <span className="pz-label">Currency</span>
                <select className="inp small" aria-label="Currency" value={npc.currency ?? ''} onChange={(e) => set({ currency: e.target.value || undefined })}>
                  <option value="">Barter</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="cc-items">
                {npc.stock.map((s) => (
                  <li key={s.item} className="cc-itemrow cc-stock">
                    <span className="cc-item-name">{project.objects[s.item]?.name ?? 'Missing item'}</span>
                    <NumberField label={`${project.objects[s.item]?.name ?? 'Item'} price`} bare unit="" min={0} max={1e6} step={1} value={s.price} onCommit={(v) => set({ stock: npc.stock.map((x) => (x.item === s.item ? { ...x, price: v } : x)) })} />
                    <NumberField label={`${project.objects[s.item]?.name ?? 'Item'} in stock`} bare unit="" min={0} max={1e6} step={1} value={s.qty} onCommit={(v) => set({ stock: npc.stock.map((x) => (x.item === s.item ? { ...x, qty: v } : x)) })} />
                    <button className="icon-btn small" aria-label={`Stop selling ${project.objects[s.item]?.name ?? 'it'}`} onClick={() => set({ stock: npc.stock.filter((x) => x.item !== s.item) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <select className="inp small" aria-label="Sell an item" value="" onChange={(e) => e.target.value && set({ stock: [...npc.stock, { item: e.target.value, price: 1, qty: 0 }] })}>
                <option value="">+ Sell an item… (price, stock; 0 is endless)</option>
                {items
                  .filter((it) => !npc.stock.some((s) => s.item === it.id))
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
              </select>
            </>
          )}
        </section>
      </div>

      <section className="pz-sec" aria-label="Topics">
        <div className="cc-sec-head">
          <span className="pz-label">Topics it knows</span>
          <button
            className="tb-btn small"
            onClick={() => {
              const t: Topic = { id: newId('topic'), name: 'New topic', knowledge: '', lines: [] };
              set({ topics: [...npc.topics, t] });
              setOpen(t.id);
            }}
          >
            + Topic
          </button>
        </div>
        {!npc.topics.length && <p className="lvl-hint">No topics yet: what does it know, and when will it say so?</p>}
        {npc.topics.map((t) => (
          <div key={t.id} className={`cc-topic${open === t.id ? ' open' : ''}`}>
            <button className="cc-topic-head" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <strong>{t.name || 'Untitled'}</strong>
              <span className="muted">
                {t.lines.length} line{t.lines.length === 1 ? '' : 's'}
                {t.when ? ' · conditional' : ''}
                {t.effects?.length ? ' · has effects' : ''}
              </span>
            </button>
            {open === t.id && (
              <div className="cc-topic-body">
                <Field label="Topic" value={t.name} onCommit={(v) => setTopic(t.id, { name: v.trim() })} />
                <Field label="What it knows" multiline rows={2} value={t.knowledge} placeholder="The vault floods at high tide" onCommit={(v) => setTopic(t.id, { knowledge: v.trim() })} />
                <RuleEditor project={project} rule={t.when as Rule | undefined} label="It talks about it when" onChange={(r) => setTopic(t.id, { when: r })} />
                <span className="pz-label">Lines it says on it</span>
                <Picker
                  label="Add a line"
                  empty="It has no lines in the script yet"
                  options={spoken.filter((l) => !t.lines.includes(l.id)).map((l) => ({ id: l.id, label: lineLabel(l.id) }))}
                  chosen={t.lines.map((l) => ({ id: l, label: lineLabel(l) }))}
                  onAdd={(l) => setTopic(t.id, { lines: [...t.lines, l] })}
                  onRemove={(l) => setTopic(t.id, { lines: t.lines.filter((x) => x !== l) })}
                />
                <EffectsEditor project={project} effects={t.effects} label="Talking about it" onChange={(e) => setTopic(t.id, { effects: e })} />
                <button className="tb-btn small" onClick={() => set({ topics: npc.topics.filter((x) => x.id !== t.id) })}>
                  Remove the topic
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
};

const Picker = ({ label, empty, options, chosen, onAdd, onRemove }: { label: string; empty: string; options: { id: string; label: string }[]; chosen: { id: string; label: string }[]; onAdd: (id: string) => void; onRemove: (id: string) => void }) => (
  <div className="cc-picker">
    {chosen.length > 0 && (
      <ul className="cc-chips">
        {chosen.map((c) => (
          <li key={c.id}>
            {c.label}
            <button className="cc-chip-x" aria-label={`Remove ${c.label}`} onClick={() => onRemove(c.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    )}
    <select className="inp small" aria-label={label} value="" disabled={!options.length} onChange={(e) => e.target.value && onAdd(e.target.value)}>
      <option value="">{options.length ? `+ ${label}…` : empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);
