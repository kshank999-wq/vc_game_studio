import { CommentsHistory } from '../collab/lazy';
import { runningTime, shotsOf } from '../../model/shots';
import { useNav } from '../../nav';
import { lazy, Suspense, useState } from 'react';

/** A skill's ranks, cost and what it needs first: loaded when a skill is shown. */
const SkillProgression = lazy(() => import('./SkillProgression').then((m) => ({ default: m.SkillProgression })));
/** An item as a weapon, tool or something worn: loaded when an item is shown. */
const EquipmentEditor = lazy(() => import('./EquipmentEditor').then((m) => ({ default: m.EquipmentEditor })));
/** An item's recipe: loaded when an item is shown. */
const RecipeEditor = lazy(() => import('./RecipeEditor').then((m) => ({ default: m.RecipeEditor })));

import {
  FIELDS,
  HAS_ASSETS,
  PRODUCTION_TAGS,
  USE_FIELDS,
  addInteraction,
  STATE_NAMES,
  VERBS,
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
  setVarType,
  setCustom,
  customOf,
  setInitialValue,
  setterNames,
  VAR_SCOPES,
  varTypeOf,
  type VarType,
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
import { describeRule, type Effect, type Rule } from '../../model/rules';
import { nodesOf, treeDrives } from '../../model/puzzle/tree';

/** What can stand somewhere in a level (spec §7): shown with where it is. */
const LEVEL_TYPES = new Set<ObjectType>(['plotPoint', 'scene', 'environment', 'character', 'object', 'inventory', 'puzzle', 'cinematic', 'choice', 'dialogue', 'trigger', 'gate']);
import { setValue } from '../../model/details';

/** Which elements hold a rule, and what it and its effects are called. */
const RULES: Partial<Record<StoryObject['type'], { rule: string; effects?: string; starts?: string; loses?: string }>> = {
  gate: { rule: 'Opens when' },
  trigger: { rule: 'Fires when', effects: 'Then' },
  choice: { rule: 'Available when' },
  puzzle: { rule: 'Solved when', effects: 'When solved' },
  // Quests and encounters play in the preview (docs/PLAY-THROUGH.md).
  quest: { starts: 'Starts when (empty: from the beginning)', rule: 'Complete when', effects: 'Reward' },
  encounter: { rule: 'Can be won when', effects: 'On a win', loses: 'On a loss' },
  lore: { rule: 'Discovered when (empty: known from the beginning)' },
  mechanic: { rule: 'Available when (empty: from the beginning)' },
  skill: { rule: 'Can be learned when (empty: any time)', effects: 'Learning it (each rank)' },
};

/** The rule that an effect can stand in for: "Only by an effect" turns it off (data.byEffect). */
const BY_EFFECT: Partial<Record<StoryObject['type'], { rule: 'starts' | 'rule'; says: string }>> = {
  quest: { rule: 'starts', says: 'Starts only when an effect starts it' },
  lore: { rule: 'rule', says: 'Discovered only when an effect reveals it' },
  mechanic: { rule: 'rule', says: 'Available only when an effect makes it available' },
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
export const StateList = ({ object, onCommit, project, label }: { object: StoryObject; project: Project; onCommit: (p: Project) => void; label: string }) => {
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
            list="vcgs-state-names"
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
        <datalist id="vcgs-state-names">
          {STATE_NAMES.filter((n) => !states.includes(n)).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    </div>
  );
};

/** The writer's own fields on an element (custom properties): a name and a value each, sent to the engines with the rest. */
const CustomFields = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
  const fields = customOf(object);
  const save = (next: typeof fields) => onCommit(setCustom(project, object.id, next));
  return (
    <section className="detail-section">
      <div className="dfld">
        <span>Your own fields</span>
        {fields.map((f, i) => (
          <div key={`${object.id}:${i}:${f.key}`} className="setup-row custom-field">
            <input
              className="inp small"
              aria-label="Field name"
              placeholder="Name"
              defaultValue={f.key}
              onBlur={(e) => e.currentTarget.value !== f.key && save(fields.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value.trim() } : x)))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <input
              className="inp"
              aria-label={`${f.key || 'Field'} value`}
              placeholder="Value"
              defaultValue={f.value}
              onBlur={(e) => e.currentTarget.value !== f.value && save(fields.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button className="state-x" aria-label={`Remove ${f.key || 'field'}`} onClick={() => save(fields.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <div>
          <button className="chip-add small" onClick={() => save([...fields, { key: '', value: '' }])}>
            + Field
          </button>
        </div>
      </div>
    </section>
  );
};

const VAR_TYPES: { value: VarType; label: string }[] = [
  { value: 'states', label: 'One of a list of values' },
  { value: 'number', label: 'A number (health, trust, coins)' },
  { value: 'text', label: 'Text (a name the player typed)' },
];

/** What a state holds and where it lives (spec §7, runtime state). */
const VariableKind = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => (
  <div className="setup-row">
    <label className="dfld">
      <span>Holds</span>
      <select className="pref-select" aria-label="Holds" value={varTypeOf(object)} onChange={(e) => onCommit(setVarType(project, object.id, e.target.value as VarType))}>
        {VAR_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
    <label className="dfld">
      <span>Scope</span>
      <select className="pref-select" aria-label="Scope" value={String(object.data.scope ?? 'Whole game')} onChange={(e) => onCommit(setField(project, object.id, 'scope', e.target.value === 'Whole game' ? '' : e.target.value))}>
        {VAR_SCOPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  </div>
);

export const Interactions = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
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
              <input key={i.verb} className="inp verb" aria-label="Verb" list="vcgs-verbs" defaultValue={i.verb} onBlur={(e) => save({ verb: e.currentTarget.value.trim() || 'Use' })} />
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
      <datalist id="vcgs-verbs">
        {VERBS.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
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

      {object.type === 'inventory' && (
        <section className="detail-section">
          <Suspense fallback={null}>
            <EquipmentEditor object={object} project={project} onCommit={onCommit} />
          </Suspense>
        </section>
      )}

      {object.type === 'inventory' && (
        <section className="detail-section">
          <Suspense fallback={null}>
            <RecipeEditor object={object} project={project} onCommit={onCommit} />
          </Suspense>
        </section>
      )}

      {object.type === 'skill' && (
        <section className="detail-section">
          <Suspense fallback={null}>
            <SkillProgression object={object} project={project} onCommit={onCommit} />
          </Suspense>
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
          <VariableKind object={object} project={project} onCommit={onCommit} />
          {varTypeOf(object) === 'states' ? (
            <StateList object={object} project={project} onCommit={onCommit} label="Values" />
          ) : (
            <label className="dfld">
              <span>Starts at</span>
              <input
                key={`${object.id}:${varTypeOf(object)}`}
                className="inp"
                type={varTypeOf(object) === 'number' ? 'number' : 'text'}
                aria-label="Starts at"
                placeholder={varTypeOf(object) === 'number' ? '0' : 'empty'}
                defaultValue={initialState(object) ?? ''}
                onBlur={(e) => e.currentTarget.value !== (initialState(object) ?? '') && onCommit(setInitialValue(project, id, e.currentTarget.value))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </label>
          )}
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

      {object.type !== 'begin' && object.type !== 'end' && <CustomFields object={object} project={project} onCommit={onCommit} />}

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
          {BY_EFFECT[object.type] && (
            <label className="check by-effect">
              <input type="checkbox" checked={!!object.data.byEffect} onChange={(e) => onCommit(setValue(project, id, 'byEffect', e.currentTarget.checked || undefined))} />
              Only by an effect
              <span className="pref-hint">{object.data.byEffect ? BY_EFFECT[object.type]!.says : 'or its rule below'}</span>
            </label>
          )}
          {RULES[object.type]!.starts && !(object.data.byEffect && BY_EFFECT[object.type]?.rule === 'starts') && (
            <RuleEditor project={project} rule={object.data.starts as Rule | undefined} label={RULES[object.type]!.starts!} onChange={(r) => onCommit(setValue(project, id, 'starts', r))} />
          )}
          {object.type === 'puzzle' && treeDrives(object) ? (
            // Its steps in the Puzzle Creator write this rule (puzzle spec §5): edit them there.
            <div className="rule">
              <div className="rule-head">
                <span className="rule-label">{RULES[object.type]!.rule}</span>
                <span className="rule-says">{describeRule(project, object.data.rule as Rule | undefined)}</span>
              </div>
              <p className="pref-hint">
                Set by its {nodesOf(object).length} steps in the Puzzle Creator.{' '}
                {nav.openPuzzles && (
                  <button className="chip-add small" onClick={() => nav.openPuzzles?.(id)}>
                    Open in the Puzzle Creator ↗
                  </button>
                )}
              </p>
            </div>
          ) : (
            !(object.data.byEffect && BY_EFFECT[object.type]?.rule === 'rule') && (
              <>
                <RuleEditor project={project} rule={object.data.rule as Rule | undefined} label={RULES[object.type]!.rule} onChange={(r) => onCommit(setValue(project, id, 'rule', r))} />
                {object.type === 'puzzle' && nav.openPuzzles && (
                  <button className="chip-add small" onClick={() => nav.openPuzzles?.(id)}>
                    Build its steps in the Puzzle Creator ↗
                  </button>
                )}
              </>
            )
          )}
          {RULES[object.type]!.effects && (
            <EffectsEditor
              project={project}
              effects={object.data.effects as Effect[] | undefined}
              label={RULES[object.type]!.effects!}
              onChange={(e) => onCommit(setValue(project, id, 'effects', e))}
            />
          )}
          {RULES[object.type]!.loses && (
            <EffectsEditor
              project={project}
              effects={object.data.loseEffects as Effect[] | undefined}
              label={RULES[object.type]!.loses!}
              onChange={(e) => onCommit(setValue(project, id, 'loseEffects', e))}
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

      <section className="detail-section">
        <h3>Comments and history</h3>
        <CommentsHistory project={project} target={{ kind: 'object', id }} onCommit={onCommit} what={object.name} />
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
