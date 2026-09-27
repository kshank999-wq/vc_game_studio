import { runningTime, shotsOf } from '../../model/shots';
import { useNav } from '../../nav';
import { useState } from 'react';

import {
  FIELDS,
  HAS_ASSETS,
  PRODUCTION_TAGS,
  USE_FIELDS,
  addInteraction,
  describeInteraction,
  initialState,
  interactionsOf,
  removeInteraction,
  sceneUse,
  setField,
  setInitialState,
  setNotes,
  setSceneUse,
  setStates,
  setterNames,
  statesOf,
  toggleTag,
  updateInteraction,
  whereUsed,
  type Destination,
  type FieldSpec,
} from '../../model/details';
import { renameObject } from '../../model/project';
import { inScene } from '../../model/scene';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project, StoryObject } from '../../model/types';
import { Symbol } from '../Symbol';
import { EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import type { Effect, Rule } from '../../model/rules';

/** What can stand somewhere in a level (spec §7): shown with where it is. */
const LEVEL_TYPES = new Set<ObjectType>(['plotPoint', 'scene', 'environment', 'character', 'object', 'inventory', 'puzzle', 'cinematic', 'choice', 'dialogue', 'trigger', 'gate']);
import { setValue } from '../../model/details';

/** Which elements hold a rule, and what it and its effects are called. */
const RULES: Partial<Record<StoryObject['type'], { rule: string; effects?: string }>> = {
  gate: { rule: 'Opens when' },
  trigger: { rule: 'Fires when', effects: 'Then' },
  choice: { rule: 'Available when' },
  puzzle: { rule: 'Solved when', effects: 'When solved' },
};

interface Props {
  project: Project;
  id: string;
  /** Inside a scene, the scene-specific use comes first (spec §15). */
  sceneId?: string;
  onCommit: (project: Project) => void;
  onClose?: () => void;
  onOpenBible?: (id: string) => void;
  /** Show what this element generates for the engine. */
  onOpenCode?: (id: string) => void;
  onNavigate?: (to: Destination) => void;
  /** 'panel' floats beside a scene; 'bible' fills the Bible's detail pane. */
  variant: 'panel' | 'bible';
  /** Delete it from the project (the app says what goes with it first). */
  onDelete?: (id: string) => void;
}

/** A text field that saves on blur, keyed on its value so undo shows through. */
const Text = ({ spec, value, onSave }: { spec: FieldSpec; value: string; onSave: (value: string) => void }) => (
  <label className="dfld">
    <span>{spec.label}</span>
    {spec.options ? (
      <select className="inp" value={value} onChange={(e) => onSave(e.currentTarget.value)}>
        <option value="">—</option>
        {spec.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    ) : spec.multiline ? (
      <textarea key={value} className="inp" rows={2} defaultValue={value} placeholder={spec.placeholder} onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)} />
    ) : (
      <input
        key={value}
        className="inp"
        defaultValue={value}
        placeholder={spec.placeholder}
        onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    )}
  </label>
);

/** A list of states or values: chips in order, one of them where it starts. */
const StateList = ({ object, onCommit, project, label }: { object: StoryObject; project: Project; onCommit: (p: Project) => void; label: string }) => {
  const states = statesOf(object);
  const start = initialState(object);
  const [adding, setAdding] = useState(false);
  return (
    <div className="dfld">
      <span>{label}</span>
      <div className="state-list">
        {states.map((s, i) => (
          <span key={s} className="state-item">
            {i > 0 && <span className="state-arrow">→</span>}
            <button
              className={`state-chip${s === start ? ' start' : ''}`}
              title={s === start ? 'Where it starts' : 'Click to make this where it starts'}
              onClick={() => onCommit(setInitialState(project, object.id, s))}
            >
              {s}
            </button>
            <button className="state-x" aria-label={`Remove ${s}`} onClick={() => onCommit(setStates(project, object.id, states.filter((x) => x !== s)))}>
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="inp state-new"
            autoFocus
            placeholder="new state"
            onBlur={(e) => {
              setAdding(false);
              if (e.currentTarget.value.trim()) onCommit(setStates(project, object.id, [...states, e.currentTarget.value]));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
        ) : (
          <button className="chip-add small" onClick={() => setAdding(true)}>
            + State
          </button>
        )}
      </div>
    </div>
  );
};

const Interactions = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
  const states = statesOf(object);
  const flags = Object.values(project.objects).filter((o) => o.type === 'state');
  const triggers = Object.values(project.objects).filter((o) => o.type === 'trigger');
  return (
    <div className="dfld">
      <span>Interactions · effects</span>
      {interactionsOf(object).map((i) => {
        const save = (patch: Parameters<typeof updateInteraction>[3]) => onCommit(updateInteraction(project, object.id, i.id, patch));
        const flag = i.setsFlag ? project.objects[i.setsFlag] : undefined;
        return (
          <div key={i.id} className="interaction">
            <div className="interaction-row">
              <input key={i.verb} className="inp verb" aria-label="Verb" defaultValue={i.verb} onBlur={(e) => save({ verb: e.currentTarget.value.trim() || 'Use' })} />
              {states.length > 0 && (
                <>
                  <select className="inp" aria-label="Only when" value={i.when ?? ''} onChange={(e) => save({ when: e.currentTarget.value })}>
                    <option value="">any time</option>
                    {states.map((s) => (
                      <option key={s} value={s}>
                        when {s}
                      </option>
                    ))}
                  </select>
                  <select className="inp" aria-label="Becomes" value={i.becomes ?? ''} onChange={(e) => save({ becomes: e.currentTarget.value })}>
                    <option value="">stays</option>
                    {states.map((s) => (
                      <option key={s} value={s}>
                        → {s}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button className="icon-btn small" aria-label="Remove interaction" onClick={() => onCommit(removeInteraction(project, object.id, i.id))}>
                ×
              </button>
            </div>
            <div className="interaction-row">
              <select className="inp" aria-label="Sets state" value={i.setsFlag ?? ''} onChange={(e) => save({ setsFlag: e.currentTarget.value, flagValue: '' })}>
                <option value="">sets no state</option>
                {flags.map((f) => (
                  <option key={f.id} value={f.id}>
                    sets {f.name}
                  </option>
                ))}
              </select>
              {flag && (
                <select className="inp" aria-label="To" value={i.flagValue ?? ''} onChange={(e) => save({ flagValue: e.currentTarget.value })}>
                  <option value="">—</option>
                  {statesOf(flag).map((v) => (
                    <option key={v} value={v}>
                      = {v}
                    </option>
                  ))}
                </select>
              )}
              <select className="inp" aria-label="Fires" value={i.fires ?? ''} onChange={(e) => save({ fires: e.currentTarget.value })}>
                <option value="">fires nothing</option>
                {triggers.map((t) => (
                  <option key={t.id} value={t.id}>
                    fires {t.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="interaction-says">{describeInteraction(project, i)}</span>
            <details className="interaction-more" open={!!(i.requires || i.effects)}>
              <summary>Conditions and effects</summary>
              <RuleEditor project={project} rule={i.requires} label="Also needs" onChange={(r) => save({ requires: r })} />
              <EffectsEditor project={project} effects={i.effects} label="Also does" onChange={(e) => save({ effects: e })} />
            </details>
          </div>
        );
      })}
      <button className="chip-add small" onClick={() => onCommit(addInteraction(project, object.id))}>
        + Interaction
      </button>
    </div>
  );
};

/**
 * Everything about one element (step 6): its fields, states and
 * interactions, what it is in this scene, description, asset notes,
 * production tags, and where else it is used. Edits change the one object,
 * so every view that shows it changes too.
 */
export const ElementDetail = ({ project, id, sceneId, onCommit, onClose, onOpenBible, onOpenCode, onNavigate, variant, onDelete }: Props) => {
  const nav = useNav();
  const object = project.objects[id];
  if (!object) return null;
  const allUses = variant === 'bible';
  const uses = whereUsed(project, id);
  const shownUses = allUses ? uses : uses.slice(0, 4);
  const inThisScene = sceneId && inScene(project, sceneId, id) ? sceneId : undefined;
  const useFields = inThisScene ? USE_FIELDS[object.type] : undefined;
  const use = inThisScene ? sceneUse(project, inThisScene, id) : {};
  const tags = (object.data.production as string[] | undefined) ?? [];
  const setters = object.type === 'state' ? setterNames(project, id) : [];

  return (
    <aside className={`detail detail-${variant}`} aria-label={`${object.name} detail`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="detail-head">
        <span className={`detail-symbol${variant === 'bible' ? ' big' : ''}`}>
          <Symbol type={object.type} size={variant === 'bible' ? 28 : 14} color={object.type === 'character' ? (object.data.color as string | undefined) : undefined} />
        </span>
        <div className="detail-names">
          <input
            key={object.name}
            className="detail-name"
            aria-label="Name"
            defaultValue={object.name}
            onBlur={(e) => onCommit(renameObject(project, id, e.currentTarget.value))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span className="detail-kind">
            {TYPE_LABEL[object.type]}
            {object.data.code && <span className="mono"> · {object.data.code}</span>}
            {variant === 'bible' && <span> · edited {new Date(object.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          </span>
        </div>
        {onClose && (
          <button className="icon-btn small" aria-label="Close detail" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {useFields && (
        <section className="detail-section in-scene">
          <h3>In this scene</h3>
          <div className="dgrid">
            {useFields.map((f) => (
              <Text key={f.key} spec={f} value={use[f.key] ?? ''} onSave={(v) => onCommit(setSceneUse(project, inThisScene!, id, f.key, v))} />
            ))}
          </div>
        </section>
      )}

      {(object.type === 'object' || object.type === 'puzzle') && (
        <section className="detail-section">
          <StateList object={object} project={project} onCommit={onCommit} label="States" />
          <Interactions object={object} project={project} onCommit={onCommit} />
        </section>
      )}

      {object.type === 'state' && (
        <section className="detail-section">
          <StateList object={object} project={project} onCommit={onCommit} label="Values" />
          <div className="dfld">
            <span>Set by</span>
            {setters.length ? (
              <span className="detail-text">{setters.join(', ')}</span>
            ) : (
              <span className="detail-warn">Nothing sets this state. Add an interaction or trigger that sets it.</span>
            )}
          </div>
        </section>
      )}

      {(FIELDS[object.type] ?? []).length > 0 && (
        <section className="detail-section">
          <div className="dgrid">
            {(FIELDS[object.type] ?? []).map((f) => (
              <Text key={f.key} spec={f} value={String(object.data[f.key] ?? '')} onSave={(v) => onCommit(setField(project, id, f.key, v))} />
            ))}
          </div>
        </section>
      )}

      {object.type === 'cinematic' && nav.openShots && (
        <section className="detail-section">
          <div className="dfld">
            <span>Shot list</span>
            <div className="shot-summary">
              <span className="detail-text">
                {shotsOf(object).length
                  ? `${shotsOf(object).length} shot${shotsOf(object).length === 1 ? '' : 's'} · ${runningTime(shotsOf(object))}s`
                  : 'Not broken into shots yet'}
              </span>
              <button className="tb-btn small" onClick={() => nav.openShots!(id)}>
                {shotsOf(object).length ? 'Open the shot list' : 'Break it into shots…'}
              </button>
            </div>
          </div>
        </section>
      )}

      {nav.openLevels && LEVEL_TYPES.has(object.type) && (
        <section className="detail-section">
          <div className="dfld">
            <span>In the levels</span>
            {(() => {
              // Read straight from the project, so the Level Designer's code loads only when it is opened.
              const set = project.levels;
              const items = set?.items.filter((i) => i.links?.includes(id) || Object.values(i.params ?? {}).includes(id)) ?? [];
              const levels = set?.levels.filter((l) => l.links?.includes(id)) ?? [];
              if (!items.length && !levels.length) {
                return (
                  <div className="shot-summary">
                    <span className="detail-text muted">Not placed in a level yet</span>
                    <button className="tb-btn small" onClick={() => nav.openLevels!()}>
                      Open the levels
                    </button>
                  </div>
                );
              }
              return (
                <div className="level-uses">
                  {levels.map((l) => (
                    <button key={l.id} className="use" onClick={() => nav.openLevels!()}>
                      <span className="use-label">{l.name}</span>
                      <span className="use-detail">the whole level</span>
                    </button>
                  ))}
                  {items.map((i) => (
                    <button key={i.id} className="use" onClick={() => nav.openLevels!(i.id)}>
                      <span className="use-label">{i.name}</span>
                      <span className="use-detail">{set!.levels.find((l) => l.id === i.levelId)?.name ?? ''}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </section>
      )}

      {RULES[object.type] && (
        <section className="detail-section">
          <RuleEditor project={project} rule={object.data.rule as Rule | undefined} label={RULES[object.type]!.rule} onChange={(r) => onCommit(setValue(project, id, 'rule', r))} />
          {RULES[object.type]!.effects && (
            <EffectsEditor
              project={project}
              effects={object.data.effects as Effect[] | undefined}
              label={RULES[object.type]!.effects!}
              onChange={(e) => onCommit(setValue(project, id, 'effects', e))}
            />
          )}
        </section>
      )}

      <section className="detail-section">
        <Text spec={{ key: 'notes', label: 'Description', multiline: true, placeholder: 'Who or what this is, for anyone on the team.' }} value={object.notes} onSave={(v) => onCommit(setNotes(project, id, v))} />
        {HAS_ASSETS.includes(object.type) && (
          <>
            <Text spec={{ key: 'assetNotes', label: 'Asset notes', multiline: true, placeholder: 'Needs pull anim + grind SFX' }} value={String(object.data.assetNotes ?? '')} onSave={(v) => onCommit(setField(project, id, 'assetNotes', v))} />
            <div className="dfld">
              <span>Production</span>
              <div className="tag-list">
                {PRODUCTION_TAGS.map((tag) => (
                  <button key={tag} className={`tag${tags.includes(tag) ? ' on' : ''}`} aria-pressed={tags.includes(tag)} onClick={() => onCommit(toggleTag(project, id, tag))}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="detail-section">
        <h3>Where used · {uses.length}</h3>
        {uses.length === 0 && <span className="detail-text muted">Not used anywhere yet.</span>}
        {shownUses.map((u, i) => (
          <button key={i} className="use" onClick={() => onNavigate?.(u.to)} disabled={!onNavigate}>
            <Symbol type={u.symbol} size={12} />
            <span className="use-label">{u.label}</span>
            <span className="use-detail">{u.detail}</span>
          </button>
        ))}
        {!allUses && uses.length > shownUses.length && <span className="detail-text muted">+ {uses.length - shownUses.length} more in the Bible</span>}
      </section>

      {(onOpenBible || onOpenCode || onDelete) && (
        <div className="detail-actions">
          {onOpenBible && (
            <button className="tb-btn small" onClick={() => onOpenBible(id)}>
              Open in Bible
            </button>
          )}
          {onOpenCode && (
            <button className="tb-btn small" onClick={() => onOpenCode(id)}>
              &lt;/&gt; Code
            </button>
          )}
          {onDelete && object.type !== 'begin' && object.type !== 'end' && (
            <button className="tb-btn small danger-btn detail-delete" onClick={() => onDelete(id)}>
              Delete…
            </button>
          )}
        </div>
      )}
    </aside>
  );
};
