import { useState } from 'react';
import { assetOf, frameOf, num, paramOf, sizeOf } from '../../model/level/geometry';
import { GROUPS } from '../../model/level/library';
import {
  addFloor,
  alignItems,
  distributeItems,
  groupItems,
  isOverridden,
  levelsOf,
  linkItem,
  mirrorItems,
  placeAt,
  removeFloor,
  resetParam,
  resetSize,
  resizeItem,
  rotateItems,
  setParam,
  ungroupItems,
  unlinkItem,
  updateFloor,
  updateItem,
  updateLevel,
  updateSettings,
} from '../../model/level/level';
import { exportNameOf, levelExportName, NAMING_LABEL } from '../../model/level/naming';
import type { AssetDefinition, LevelAction, LevelEvent, LevelItem, LevelRule, NamingClass, ParamDef, PlayNote, PropertyGroup } from '../../model/level/types';
import { removePreset, resolveNote } from '../../model/level/play';
import type { LevelIssue } from '../../model/level/validate';
import { newId } from '../../model/project';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project } from '../../model/types';
import { EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import { Symbol } from '../Symbol';
import { BoolField, NumberField, RefField, Section, SelectField, TextField } from './fields';

interface Props {
  project: Project;
  levelId: string;
  floorId: string;
  global: readonly AssetDefinition[];
  selection: readonly string[];
  onCommit: (project: Project) => void;
  onSelect: (ids: string[]) => void;
  onFloor: (floorId: string) => void;
  onOpenStory: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveToLibrary: (name: string) => void;
  issues: readonly LevelIssue[];
}

const LINKABLE: ObjectType[] = ['plotPoint', 'scene', 'environment', 'character', 'object', 'inventory', 'puzzle', 'cinematic', 'choice', 'dialogue', 'trigger', 'gate', 'state'];

const EVENTS: { value: LevelEvent; label: string }[] = [
  { value: 'enter', label: 'On enter' },
  { value: 'exit', label: 'On exit' },
  { value: 'interact', label: 'On interact' },
  { value: 'pickup', label: 'On pickup' },
  { value: 'use', label: 'On use' },
  { value: 'destroy', label: 'On destroy' },
  { value: 'timer', label: 'On a timer' },
  { value: 'stateChange', label: 'When the story changes' },
  { value: 'custom', label: 'On a game event' },
];

const ACTIONS: { value: LevelAction['kind']; label: string; target: 'item' | 'scene' | 'cinematic' | 'level' }[] = [
  { value: 'open', label: 'Open', target: 'item' },
  { value: 'close', label: 'Close', target: 'item' },
  { value: 'enable', label: 'Enable', target: 'item' },
  { value: 'disable', label: 'Disable', target: 'item' },
  { value: 'spawn', label: 'Spawn at', target: 'item' },
  { value: 'despawn', label: 'Despawn', target: 'item' },
  { value: 'startScene', label: 'Start scene', target: 'scene' },
  { value: 'playCinematic', label: 'Play cinematic', target: 'cinematic' },
  { value: 'playAudio', label: 'Play audio', target: 'item' },
  { value: 'objective', label: 'Activate objective', target: 'item' },
  { value: 'goToLevel', label: 'Go to level', target: 'level' },
];

const ALIGN = [
  ['left', '⇤', 'Align left edges'],
  ['centre', '↔', 'Align centres (east–west)'],
  ['right', '⇥', 'Align right edges'],
  ['top', '⤒', 'Align top edges'],
  ['middle', '↕', 'Align middles (north–south)'],
  ['bottom', '⤓', 'Align bottom edges'],
] as const;

/**
 * The right-hand inspector (spec §6): the authoritative place to edit the
 * selection. Common fields first; advanced ones behind "More".
 */
export const LevelInspector = (props: Props) => {
  const { project, levelId, floorId, global, selection, onCommit } = props;
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(['engine', 'settings']));
  const [more, setMore] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [saveName, setSaveName] = useState('');
  const q = query.trim().toLowerCase();
  const toggle = (key: string, setter = setClosed) =>
    setter((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const units = set.settings.units;
  const matches = (label: string) => !q || label.toLowerCase().includes(q);

  if (!level) return <aside className="lvl-right" aria-label="Properties" />;

  const selected = selection.map((id) => set.items.find((i) => i.id === id)).filter((i): i is LevelItem => !!i);

  // ------------------------------------------------------------ several items

  if (selected.length > 1) {
    const ids = selected.map((i) => i.id);
    const grouped = selected.some((i) => i.groupId);
    return (
      <aside className="lvl-right" aria-label="Properties">
        <header className="lvl-right-head">
          <h2>{selected.length} selected</h2>
          <p className="muted">{[...new Set(selected.map((i) => assetOf(set, i, global).name))].join(', ')}</p>
        </header>
        <div className="lvl-sec-body">
          <span className="lvl-flabel">Align</span>
          <div className="lvl-btnrow">
            {ALIGN.map(([how, glyph, title]) => (
              <button key={how} className="icon-btn" title={title} aria-label={title} onClick={() => onCommit(alignItems(project, ids, how, global))}>
                {glyph}
              </button>
            ))}
          </div>
          <span className="lvl-flabel">Arrange</span>
          <div className="lvl-btnrow wrap">
            <button className="tb-btn small" onClick={() => onCommit(distributeItems(project, ids, 'x'))} disabled={selected.length < 3}>Distribute east–west</button>
            <button className="tb-btn small" onClick={() => onCommit(distributeItems(project, ids, 'y'))} disabled={selected.length < 3}>Distribute north–south</button>
            <button className="tb-btn small" onClick={() => onCommit(rotateItems(project, ids, 90, global))}>Rotate 90°</button>
            <button className="tb-btn small" onClick={() => onCommit(mirrorItems(project, ids, 'x'))}>Mirror east–west</button>
            <button className="tb-btn small" onClick={() => onCommit(mirrorItems(project, ids, 'y'))}>Mirror north–south</button>
            <button className="tb-btn small" onClick={() => onCommit(grouped ? ungroupItems(project, ids) : groupItems(project, ids))}>{grouped ? 'Ungroup' : 'Group'}</button>
            <button className="tb-btn small" onClick={props.onDuplicate}>Duplicate</button>
          </div>
          <SaveToLibrary name={saveName} setName={setSaveName} onSave={props.onSaveToLibrary} placeholder="e.g. Guard room" />
          <button className="tb-btn small danger-btn" onClick={props.onDelete}>Delete {selected.length} items</button>
        </div>
      </aside>
    );
  }

  // ------------------------------------------------------------ nothing selected: the level

  if (!selected.length) {
    const floors = [...level.floors].sort((a, b) => a.elevation - b.elevation);
    return (
      <aside className="lvl-right" aria-label="Properties">
        <header className="lvl-right-head">
          <span className="lvl-kind">Level</span>
          <h2>{level.name}</h2>
          <p className="mono muted">{levelExportName(set, level)}</p>
        </header>
        <Section title="Identity" open={!closed.has('identity')} onToggle={() => toggle('identity')}>
          <TextField label="Name" value={level.name} onCommit={(v) => v.trim() && onCommit(updateLevel(project, level.id, { name: v.trim() }))} />
          <TextField label="Notes" value={level.notes ?? ''} onCommit={(v) => onCommit(updateLevel(project, level.id, { notes: v }))} />
        </Section>
        <Section title="Floors" open={!closed.has('floors')} onToggle={() => toggle('floors')} count={floors.length}>
          {floors
            .slice()
            .reverse()
            .map((f) => (
              <div key={f.id} className={`lvl-floor${f.id === floorId ? ' on' : ''}`}>
                <button className="lvl-floor-go" onClick={() => props.onFloor(f.id)} aria-label={`Show ${f.name}`}>
                  {f.id === floorId ? '●' : '○'}
                </button>
                <TextField label="Floor" value={f.name} onCommit={(v) => v.trim() && onCommit(updateFloor(project, level.id, f.id, { name: v.trim() }))} />
                <NumberField label="Elevation" unit="length" units={units} value={f.elevation} step={0.5} onCommit={(v) => onCommit(updateFloor(project, level.id, f.id, { elevation: v }))} />
                <NumberField label="Height" unit="length" units={units} value={f.height} step={0.5} min={1} onCommit={(v) => onCommit(updateFloor(project, level.id, f.id, { height: v }))} />
                {floors.length > 1 && (
                  <button className="icon-btn small" title="Remove this floor and what is on it" aria-label={`Remove ${f.name}`} onClick={() => onCommit(removeFloor(project, level.id, f.id))}>
                    ×
                  </button>
                )}
              </div>
            ))}
          <button
            className="tb-btn small"
            onClick={() => {
              const made = addFloor(project, level.id);
              onCommit(made.project);
              props.onFloor(made.id);
            }}
          >
            + Floor above
          </button>
        </Section>
        <Section title="Narrative" open={!closed.has('narrative')} onToggle={() => toggle('narrative')} count={level.links?.length}>
          <Links
            project={project}
            links={level.links ?? []}
            onOpen={props.onOpenStory}
            onAdd={(id) => onCommit(updateLevel(project, level.id, { links: [...(level.links ?? []), id] }))}
            onRemove={(id) => onCommit(updateLevel(project, level.id, { links: (level.links ?? []).filter((l) => l !== id) }))}
            hint="The plot points and scenes this level is for."
          />
        </Section>
        <Section title="Play Mode" open={!closed.has('play')} onToggle={() => toggle('play')} count={(set.presets?.length ?? 0) + (set.notes ?? []).filter((n) => n.levelId === level.id && !n.resolved).length}>
          <SelectField label="Perspective" value={set.settings.perspective ?? 'first'} options={[{ value: 'first', label: 'First person' }, { value: 'third', label: 'Third person' }, { value: 'top', label: 'Top-down' }]} onCommit={(v) => onCommit(updateSettings(project, { perspective: v as 'first' | 'third' | 'top' }))} />
          <span className="lvl-flabel">Test presets</span>
          {(set.presets ?? []).length === 0 && <p className="lvl-hint">Pause while playing and save the story’s state to test from it again.</p>}
          {(set.presets ?? []).map((pr) => (
            <div key={pr.id} className="lvl-link">
              <span className="lvl-link-go">
                {pr.name}
                <span className="muted">{Object.keys(pr.items).length} items · {Object.keys(pr.solved).length} solved</span>
              </span>
              <button className="icon-btn small" aria-label={`Remove preset ${pr.name}`} onClick={() => onCommit(removePreset(project, pr.id))}>
                ×
              </button>
            </div>
          ))}
          <Notes project={project} notes={(set.notes ?? []).filter((n) => n.levelId === level.id && !n.resolved)} onCommit={onCommit} showItem items={set.items} />
        </Section>
        <Section title="Units, grid and names" open={!closed.has('settings')} onToggle={() => toggle('settings')}>
          <SelectField label="Units" value={set.settings.units} options={[{ value: 'm', label: 'Metres' }, { value: 'ft', label: 'Feet' }]} onCommit={(v) => onCommit(updateSettings(project, { units: v as 'm' | 'ft' }))} />
          <NumberField label="Grid" unit="length" units={units} value={set.settings.grid} step={0.25} min={0.05} onCommit={(v) => onCommit(updateSettings(project, { grid: v }))} />
          <BoolField label="Snap to the grid" value={set.settings.snap} onCommit={(v) => onCommit(updateSettings(project, { snap: v }))} />
          <TextField label="Export name pattern" value={set.settings.template} hint="{TYPE}, {Context}, {Name} and {###} (the serial)" onCommit={(v) => onCommit(updateSettings(project, { template: v || '{TYPE}_{Context}_{Name}_{###}' }))} />
          <div className="lvl-prefixes">
            {(Object.keys(NAMING_LABEL) as NamingClass[]).map((cls) => (
              <TextField key={cls} label={NAMING_LABEL[cls]} value={set.settings.prefixes[cls]} onCommit={(v) => onCommit(updateSettings(project, { prefixes: { ...set.settings.prefixes, [cls]: v.trim().toUpperCase() || set.settings.prefixes[cls] } }))} />
            ))}
          </div>
        </Section>
      </aside>
    );
  }

  // ------------------------------------------------------------ one item

  const item = selected[0]!;
  const def = assetOf(set, item, global);
  const f = frameOf(set, item, global);
  const size = sizeOf(set, item, global);
  const itemIssues = props.issues.filter((i) => i.id === item.id);
  const byGroup = (g: PropertyGroup) => def.params.filter((p) => p.group === g);
  const commitParam = (p: ParamDef, v: string | number | boolean) => onCommit(setParam(project, item.id, p.key, v, global));
  const field = (p: ParamDef) => {
    if (!matches(p.label)) return null;
    const value = paramOf(set, item, p.key, global) ?? p.default;
    const base = { label: p.label, hint: p.hint, overridden: isOverridden(item, p.key), onReset: () => onCommit(resetParam(project, item.id, p.key, global)) };
    if (p.type === 'boolean') return <BoolField key={p.key} {...base} value={value === true} onCommit={(v) => commitParam(p, v)} />;
    if (p.type === 'select') return <SelectField key={p.key} {...base} value={String(value)} options={p.options ?? []} onCommit={(v) => commitParam(p, v)} />;
    if (p.type === 'ref') return <RefField key={p.key} {...base} project={project} value={String(value ?? '')} types={p.refTypes ?? []} onCommit={(v) => commitParam(p, v)} />;
    if (p.type === 'number') return <NumberField key={p.key} {...base} value={num(value, 0)} unit={p.unit} units={units} step={p.step} min={p.min} max={p.max} onCommit={(v) => commitParam(p, v)} />;
    return <TextField key={p.key} {...base} value={String(value ?? '')} onCommit={(v) => commitParam(p, v)} />;
  };
  const group = (g: PropertyGroup, extra?: React.ReactNode, count?: number) => {
    const params = byGroup(g);
    const common = params.filter((p) => !p.advanced).map(field).filter(Boolean);
    const advanced = params.filter((p) => p.advanced);
    const shownAdvanced = more.has(g) || !!q ? advanced.map(field).filter(Boolean) : [];
    if (!params.length && !extra) return null;
    if (q && !common.length && !shownAdvanced.length && !extra) return null;
    const label = GROUPS.find((x) => x.id === g)!.label;
    return (
      <Section key={g} title={label} open={!closed.has(g) || !!q} onToggle={() => toggle(g)} count={count}>
        {extra}
        {common}
        {shownAdvanced}
        {advanced.length > 0 && !q && (
          <button className="lvl-more" onClick={() => toggle(g, setMore)}>
            {more.has(g) ? 'Fewer' : `More (${advanced.length})`}
          </button>
        )}
      </Section>
    );
  };
  const host = item.host && set.items.find((i) => i.id === item.host!.id);
  const levelItems = set.items.filter((i) => i.levelId === levelId && i.id !== item.id);

  return (
    <aside className="lvl-right" aria-label="Properties">
      <header className="lvl-right-head">
        <span className="lvl-kind">{def.name}</span>
        <h2>{item.name}</h2>
        <p className="mono muted">{exportNameOf(set, item, global)}</p>
        <div className="lvl-btnrow">
          <button className="tb-btn small" onClick={props.onDuplicate}>Duplicate</button>
          <button className="tb-btn small danger-btn" onClick={props.onDelete}>Delete</button>
        </div>
        {itemIssues.filter((i) => !i.message.startsWith('Play note')).map((i) => (
          <p key={i.message} className={`lvl-issue ${i.severity}`}>
            {i.message} <span className="muted">{i.export}</span>
          </p>
        ))}
        <Notes project={project} notes={(set.notes ?? []).filter((n) => n.itemId === item.id && !n.resolved)} onCommit={onCommit} />
      </header>
      <input className="inp small lvl-search" placeholder="Find a property" aria-label="Find a property" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="lvl-secs">
        {(!q || matches('name export guid tags')) && (
          <Section title="Identity" open={!closed.has('identity') || !!q} onToggle={() => toggle('identity')}>
            <TextField label="Name" value={item.name} onCommit={(v) => v.trim() && onCommit(updateItem(project, item.id, { name: v.trim() }, global))} />
            <TextField label="Export name" value={item.exportName ?? ''} placeholder={exportNameOf(set, { ...item, exportName: undefined }, global)} overridden={!!item.exportName} onReset={() => onCommit(updateItem(project, item.id, { exportName: undefined }, global))} onCommit={(v) => onCommit(updateItem(project, item.id, { exportName: v.trim() || undefined }, global))} />
            <TextField label="Tags" value={(item.tags ?? []).join(', ')} placeholder="comma, separated" onCommit={(v) => onCommit(updateItem(project, item.id, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, global))} />
            <div className="lvl-kv"><span>Type</span><span>{def.name} · {def.category}</span></div>
            <div className="lvl-kv"><span>From</span><span>{def.source === 'starter' ? 'Starter library' : def.source === 'global' ? 'My library' : 'Project library'} · v{def.version}{item.assetVersion !== def.version ? ` (placed from v${item.assetVersion})` : ''}</span></div>
            <div className="lvl-kv"><span>GUID</span><span className="mono lvl-guid" title="Never changes: references and the engine manifest use it">{item.id}</span></div>
          </Section>
        )}
        {(!q || matches('position rotation floor elevation x y z')) && (
          <Section title="Transform" open={!closed.has('transform') || !!q} onToggle={() => toggle('transform')}>
            {host ? (
              <>
                <div className="lvl-kv"><span>In</span><span>{host.name} · {['north', 'east', 'south', 'west'][item.host!.wall]} wall</span></div>
                <NumberField label="Along the wall" unit="percent" value={Math.round(item.host!.along * 1000) / 10} min={0} max={100} step={1} onCommit={(v) => onCommit(updateItem(project, item.id, { host: { ...item.host!, along: v / 100 } }, global))} />
                <NumberField label="Above the floor" unit="length" units={units} value={item.z} step={0.05} min={0} onCommit={(v) => onCommit(updateItem(project, item.id, { z: v }, global))} />
              </>
            ) : (
              <div className="lvl-grid3">
                <NumberField label="X" unit="length" units={units} value={f.x} step={set.settings.grid} onCommit={(v) => onCommit(placeAt(project, item.id, { x: v }))} />
                <NumberField label="Y" unit="length" units={units} value={f.y} step={set.settings.grid} onCommit={(v) => onCommit(placeAt(project, item.id, { y: v }))} />
                <NumberField label="Z" unit="length" units={units} value={item.z} step={0.1} onCommit={(v) => onCommit(placeAt(project, item.id, { z: v }))} />
                <NumberField label="Rotation" unit="deg" value={item.rotation} step={15} onCommit={(v) => onCommit(placeAt(project, item.id, { rotation: v }))} />
              </div>
            )}
            <SelectField label="Floor" value={item.floorId} options={level.floors.map((fl) => ({ value: fl.id, label: fl.name }))} onCommit={(v) => onCommit(updateItem(project, item.id, { floorId: v, host: undefined }, global))} disabled={!!item.host} />
            <div className="lvl-btnrow">
              <BoolField label="Locked" value={!!item.locked} onCommit={(v) => onCommit(updateItem(project, item.id, { locked: v || undefined }, global))} />
              <BoolField label="Hidden" value={!!item.hidden} onCommit={(v) => onCommit(updateItem(project, item.id, { hidden: v || undefined }, global))} />
            </div>
          </Section>
        )}
        {group(
          'dimensions',
          def.kind !== 'marker' && (!q || matches('width depth height')) ? (
            <div className="lvl-grid3">
              {(item.host ? (['w', 'h'] as const) : (['w', 'd', 'h'] as const)).map((axis) => (
                <NumberField
                  key={axis}
                  label={{ w: 'Width', d: 'Depth', h: 'Height' }[axis]}
                  unit="length"
                  units={units}
                  value={size[axis]}
                  step={set.settings.grid}
                  min={0.01}
                  overridden={item.size?.[axis] !== undefined}
                  onReset={() => onCommit(resetSize(project, item.id, axis, global))}
                  onCommit={(v) => onCommit(resizeItem(project, item.id, { [axis]: v }, global))}
                />
              ))}
            </div>
          ) : null,
        )}
        {group('appearance')}
        {group('physics')}
        {group('interaction')}
        {group('gameplay')}
        {group(
          'logic',
          !q || matches('active rules when') ? (
            <>
              <RuleEditor project={project} rule={item.activeWhen} label="Present only when" onChange={(rule) => onCommit(updateItem(project, item.id, { activeWhen: rule }, global))} />
              <Rules project={project} item={item} items={levelItems} levels={set.levels.map((l) => ({ id: l.id, name: l.name }))} onChange={(rules) => onCommit(updateItem(project, item.id, { rules: rules.length ? rules : undefined }, global))} />
            </>
          ) : null,
          item.rules?.length,
        )}
        {group(
          'narrative',
          !q || matches('links story scene') ? (
            <Links project={project} links={item.links ?? []} onOpen={props.onOpenStory} onAdd={(id) => onCommit(linkItem(project, item.id, id))} onRemove={(id) => onCommit(unlinkItem(project, item.id, id))} hint="Scenes, plot points and Bible entries this is part of." />
          ) : null,
          item.links?.length,
        )}
        {group('spawn')}
        {group('presentation')}
        {group(
          'engine',
          !q || matches('engine godot unity unreal') ? (
            <div className="lvl-engines">
              {(['godot', 'unity', 'unreal'] as const).map((e) => (
                <div key={e} className="lvl-kv">
                  <span>{e === 'godot' ? 'Godot' : e === 'unity' ? 'Unity' : 'Unreal'}</span>
                  <span>{def.engine[e]}</span>
                </div>
              ))}
              <div className="lvl-kv">
                <span>Last export</span>
                <span className="muted">{set.manifest?.find((m) => m.guid === item.id)?.revision ?? 'Not exported yet'}</span>
              </div>
            </div>
          ) : null,
        )}
        {!q && <SaveToLibrary name={saveName} setName={setSaveName} onSave={props.onSaveToLibrary} placeholder={`${item.name} (custom)`} />}
      </div>
    </aside>
  );
};

const Notes = ({ project, notes, onCommit, showItem, items }: { project: Project; notes: PlayNote[]; onCommit: (p: Project) => void; showItem?: boolean; items?: LevelItem[] }) =>
  notes.length ? (
    <div className="lvl-notes">
      {notes.map((n) => (
        <div key={n.id} className="lvl-issue warning lvl-note">
          <strong>
            Play note{showItem ? ` · ${items?.find((i) => i.id === n.itemId)?.name ?? 'the level'}` : ''}
          </strong>
          <span>{n.text}</span>
          <button className="tb-btn small" onClick={() => onCommit(resolveNote(project, n.id))}>
            Resolve
          </button>
        </div>
      ))}
    </div>
  ) : null;

const SaveToLibrary = ({ name, setName, onSave, placeholder }: { name: string; setName: (v: string) => void; onSave: (name: string) => void; placeholder: string }) => (
  <form
    className="lvl-save"
    onSubmit={(e) => {
      e.preventDefault();
      onSave(name.trim() || placeholder);
      setName('');
    }}
  >
    <span className="lvl-flabel">Save to the project library</span>
    <div className="lvl-btnrow">
      <input className="inp small" aria-label="Library asset name" placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="tb-btn small" type="submit">Save</button>
    </div>
  </form>
);

const Links = ({ project, links, onOpen, onAdd, onRemove, hint }: { project: Project; links: readonly string[]; onOpen: (id: string) => void; onAdd: (id: string) => void; onRemove: (id: string) => void; hint: string }) => (
  <div className="lvl-links">
    <p className="lvl-hint">{hint}</p>
    {links.map((id) => {
      const o = project.objects[id];
      return (
        <div key={id} className={`lvl-link${o ? '' : ' broken'}`}>
          <button className="lvl-link-go" disabled={!o} onClick={() => onOpen(id)} title={o ? `Open ${o.name}` : undefined}>
            {o && <Symbol type={o.type} size={12} />}
            {o ? `${o.data.code ? `${String(o.data.code)} ` : ''}${o.name}` : 'Deleted'}
            {o && <span className="muted">{TYPE_LABEL[o.type]}</span>}
          </button>
          <button className="icon-btn small" aria-label={`Unlink ${o?.name ?? 'it'}`} title="Unlink" onClick={() => onRemove(id)}>
            ×
          </button>
        </div>
      );
    })}
    <select className="inp small" aria-label="Link to the story" value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
      <option value="">+ Link to the story…</option>
      {LINKABLE.map((t) => {
        const objects = Object.values(project.objects).filter((o) => o.type === t && !links.includes(o.id));
        if (!objects.length) return null;
        return (
          <optgroup key={t} label={TYPE_LABEL[t]}>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {`${o.data.code ? `${String(o.data.code)} ` : ''}${o.name}`}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  </div>
);

const Rules = ({ project, item, items, levels, onChange }: { project: Project; item: LevelItem; items: LevelItem[]; levels: { id: string; name: string }[]; onChange: (rules: LevelRule[]) => void }) => {
  const rules = item.rules ?? [];
  const update = (id: string, patch: Partial<LevelRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const targets = (kind: 'item' | 'scene' | 'cinematic' | 'level') =>
    kind === 'item'
      ? items.map((i) => ({ value: i.id, label: i.name }))
      : kind === 'level'
        ? levels.map((l) => ({ value: l.id, label: l.name }))
        : Object.values(project.objects).filter((o) => o.type === kind).map((o) => ({ value: o.id, label: `${o.data.code ? `${String(o.data.code)} ` : ''}${o.name}` }));
  return (
    <div className="lvl-rules">
      {rules.map((r, n) => (
        <div key={r.id} className="lvl-rule">
          <div className="lvl-btnrow">
            <span className="lvl-flabel">Rule {n + 1}</span>
            <select className="inp small" aria-label="When it runs" value={r.on} onChange={(e) => update(r.id, { on: e.target.value as LevelEvent })}>
              {EVENTS.map((ev) => (
                <option key={ev.value} value={ev.value}>
                  {ev.label}
                </option>
              ))}
            </select>
            {(r.on === 'timer' || r.on === 'custom') && (
              <input className="inp small" aria-label={r.on === 'timer' ? 'Seconds' : 'Event name'} placeholder={r.on === 'timer' ? 'seconds' : 'event name'} defaultValue={r.detail ?? ''} onBlur={(e) => update(r.id, { detail: e.target.value })} />
            )}
            <button className="icon-btn small" aria-label={`Remove rule ${n + 1}`} onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
              ×
            </button>
          </div>
          <RuleEditor project={project} rule={r.when} label="Only if" onChange={(when) => update(r.id, { when })} />
          <EffectsEditor project={project} effects={r.effects} label="Changes the story" onChange={(effects) => update(r.id, { effects })} />
          <div className="lvl-actions">
            <span className="lvl-flabel">Does in the level</span>
            {(r.actions ?? []).map((a, i) => {
              const kind = ACTIONS.find((x) => x.value === a.kind)!;
              return (
                <div key={i} className="lvl-btnrow">
                  <select className="inp small" aria-label="Action" value={a.kind} onChange={(e) => update(r.id, { actions: (r.actions ?? []).map((x, j) => (j === i ? ({ kind: e.target.value, target: '' } as LevelAction) : x)) })}>
                    {ACTIONS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <select className="inp small" aria-label="Target" value={a.target} onChange={(e) => update(r.id, { actions: (r.actions ?? []).map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) })}>
                    <option value="">— choose —</option>
                    {targets(kind.target).map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn small" aria-label="Remove action" onClick={() => update(r.id, { actions: (r.actions ?? []).filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              );
            })}
            <button className="chip-add small" onClick={() => update(r.id, { actions: [...(r.actions ?? []), { kind: 'open', target: '' }] })}>
              + Action
            </button>
          </div>
        </div>
      ))}
      <button className="tb-btn small" onClick={() => onChange([...rules, { id: newId('rule'), on: item.assetId.startsWith('logic.trigger') || item.assetId.startsWith('pres.') ? 'enter' : 'interact' }])}>
        + Rule
      </button>
    </div>
  );
};
