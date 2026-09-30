import { CommentsHistory } from '../collab/CommentsHistory';
import { openCount } from '../../model/collab';
import { useState } from 'react';
import { areaOf, assetOf, corners, frameOf, num, OUTLINED_KINDS, outlineOf, paramOf, perimeterOf, sizeOf } from '../../model/level/geometry';
import { GROUPS } from '../../model/level/library';
import {
  addFloor,
  alignItems,
  distributeItems,
  groupItems,
  isOverridden,
  levelsOf,
  linkItem,
  makeRectangular,
  mirrorItems,
  outlineCorners,
  placeAt,
  removeFloor,
  resetParam,
  resetSize,
  resizeItem,
  rotateItems,
  setOutline,
  setParam,
  setPivot,
  ungroupItems,
  unlinkItem,
  updateFloor,
  updateItem,
  updateLevel,
  updateSettings,
  mapGrid,
} from '../../model/level/level';
import { exportNameOf, levelExportName, NAMING_LABEL } from '../../model/level/naming';
import type { AssetDefinition, LevelAction, LevelEvent, LevelItem, LevelRule, NamingClass, ParamDef, PlayNote, PropertyGroup } from '../../model/level/types';
import { removePreset, resolveNote } from '../../model/level/play';
import { eventsAt } from '../../model/level/places';
import { eventTitle } from '../../model/timeline';
import { canSaveToAsset, migrateAll, migrateItem, migrationFor, outdatedItems, saveToAsset, type Change } from '../../model/level/migrate';
import type { LevelIssue } from '../../model/level/validate';
import { newId } from '../../model/project';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project } from '../../model/types';
import { EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import { Symbol } from '../Symbol';
import { BoolField, NumberField, RefField, Section, SelectField, TextField } from './fields';
import { anchorOf, boundsOf as mapBounds, BOUNDARIES, childOfItem, childrenOf, descendantsOf, kindLabel, kindOf, MAP_KINDS, moveMap, STATUSES, statusOf, updateMap } from '../../model/level/hierarchy';
import { formatLength } from './units';

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
  /** Open a map (a child, the parent, one in the navigator). */
  onOpenMap?: (levelId: string) => void;
  /** Open an item as its own map (spec V2 §5, §8), making it if need be. */
  onOpenChild?: (itemId: string) => void;
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
  { value: 'refuel', label: 'Refill the light of', target: 'item' },
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
          <span className="lvl-kind">{kindLabel(kindOf(level))}</span>
          <h2>{level.name}</h2>
          <p className="mono muted">{levelExportName(set, level)}</p>
        </header>
        <Section title="Identity" open={!closed.has('identity')} onToggle={() => toggle('identity')}>
          <TextField label="Name" value={level.name} onCommit={(v) => v.trim() && onCommit(updateLevel(project, level.id, { name: v.trim() }))} />
          <TextField label="Notes" value={level.notes ?? ''} onCommit={(v) => onCommit(updateLevel(project, level.id, { notes: v }))} />
        </Section>
        <MapSection project={project} levelId={level.id} global={global} open={!closed.has('map')} onToggle={() => toggle('map')} onCommit={onCommit} onOpenMap={props.onOpenMap} />
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
        <Section title="Comments and history" open={!closed.has('collab')} onToggle={() => toggle('collab')} count={openCount(project, { kind: 'level', id: level.id }) || undefined}>
          <CommentsHistory project={project} target={{ kind: 'level', id: level.id }} onCommit={onCommit} what={level.name} />
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
          {canSaveToAsset(project, item, global) && (
            <button className="tb-btn small" title={`Make this item’s changes the new defaults of ${def.name}, for everything placed from it`} onClick={() => onCommit(saveToAsset(project, item.id, global))}>
              Save changes to {def.name}
            </button>
          )}
        </div>
        <LibraryUpdate key={item.id} project={project} item={item} global={global} name={def.name} onCommit={onCommit} />
        {itemIssues.filter((i) => !i.message.startsWith('Play note') && !i.message.includes('; the library is at v')).map((i) => (
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
            {def.kind !== 'hosted' && <ChildMapRow project={project} itemId={item.id} onOpenChild={props.onOpenChild} />}
          </Section>
        )}
        {(!q || matches('position rotation floor elevation x y z')) && (
          <Section title="Transform" open={!closed.has('transform') || !!q} onToggle={() => toggle('transform')}>
            {host ? (
              <>
                <div className="lvl-kv"><span>In</span><span>{host.name} · {outlineOf(set, host, global) ? `wall ${item.host!.wall + 1}` : `${['north', 'east', 'south', 'west'][item.host!.wall]} wall`}</span></div>
                <NumberField label="Along the wall" unit="percent" value={Math.round(item.host!.along * 1000) / 10} min={0} max={100} step={1} onCommit={(v) => onCommit(updateItem(project, item.id, { host: { ...item.host!, along: v / 100 } }, global))} />
                <NumberField label="Above the floor" unit="length" units={units} value={item.z} step={0.05} min={0} onCommit={(v) => onCommit(updateItem(project, item.id, { z: v }, global))} />
              </>
            ) : (
              <div className="lvl-grid3">
                <NumberField label="X" unit="length" units={units} value={f.x} step={mapGrid(set, item.levelId)} onCommit={(v) => onCommit(placeAt(project, item.id, { x: v }))} />
                <NumberField label="Y" unit="length" units={units} value={f.y} step={mapGrid(set, item.levelId)} onCommit={(v) => onCommit(placeAt(project, item.id, { y: v }))} />
                <NumberField label="Z" unit="length" units={units} value={item.z} step={0.1} onCommit={(v) => onCommit(placeAt(project, item.id, { z: v }))} />
                <NumberField label="Rotation" unit="deg" value={item.rotation} step={15} onCommit={(v) => onCommit(placeAt(project, item.id, { rotation: v }))} />
              </div>
            )}
            {!host && (
              <SelectField
                label="Pivot"
                hint="The point it turns about and grows from. Drag it in 3D with Pivot."
                value={pivotName(item.pivot)}
                options={[...PIVOTS.map((p) => p.label), ...(pivotName(item.pivot) === 'Custom' ? ['Custom'] : [])]}
                onCommit={(v) => {
                  const p = PIVOTS.find((x) => x.label === v);
                  if (p) onCommit(setPivot(project, item.id, p.at));
                }}
              />
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
          def.kind !== 'marker' && (!q || matches('width depth height shape outline corners')) ? (
            <>
            {OUTLINED_KINDS.has(def.kind) && !item.host && (
              <>
                <div className="lvl-kv lvl-shape">
                  <span>Shape</span>
                  <span>{outlineOf(set, item, global) ? `${corners(f).length} corners · ${Math.round(areaOf(f) * 10) / 10} m² · ${Math.round(perimeterOf(corners(f)) * 10) / 10} m around` : 'Rectangle'}</span>
                </div>
                <div className="lvl-btnrow">
                  {outlineOf(set, item, global) ? (
                    <button className="tb-btn small" disabled={item.locked} onClick={() => onCommit(makeRectangular(project, item.id, global))} title="Back to a rectangle of the same bounds">
                      Make rectangular
                    </button>
                  ) : (
                    <button className="tb-btn small" disabled={item.locked} onClick={() => onCommit(setOutline(project, item.id, outlineCorners(project, item.id, global), global))} title="Drag its corners on the map, and add corners in its walls">
                      Edit corners
                    </button>
                  )}
                </div>
              </>
            )}
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
            </>
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
            <>
              <Links project={project} links={item.links ?? []} onOpen={props.onOpenStory} onAdd={(id) => onCommit(linkItem(project, item.id, id))} onRemove={(id) => onCommit(unlinkItem(project, item.id, id))} hint="Scenes, plot points and Bible entries this is part of." />
              <TimelineUses project={project} itemId={item.id} onOpen={props.onOpenStory} />
            </>
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
        {(!q || matches('comments tasks history changes')) && (
          <Section title="Comments and history" open={!closed.has('collab') || !!q} onToggle={() => toggle('collab')} count={openCount(project, { kind: 'levelItem', id: item.id }) || undefined}>
            <CommentsHistory project={project} target={{ kind: 'levelItem', id: item.id }} onCommit={onCommit} what={item.name} />
          </Section>
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

const shown = (v: unknown) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

/**
 * An item placed from an earlier version of its library asset (spec §4.3):
 * what the new version changes for it, a choice to keep each inherited value
 * it had, then Update. Nothing changes until then.
 */
const LibraryUpdate = ({ project, item, global, name, onCommit }: { project: Project; item: LevelItem; global: readonly AssetDefinition[]; name: string; onCommit: (p: Project) => void }) => {
  const m = migrationFor(project, item, global);
  const [keep, setKeep] = useState<string[]>([]);
  if (!m) return null;
  const others = outdatedItems(project, global).filter((x) => x.assetId === m.assetId).length;
  const line = (c: Change) => {
    switch (c.kind) {
      case 'inherited':
        return (
          <label key={c.key} className="lvl-change">
            <input type="checkbox" checked={keep.includes(c.key)} onChange={(e) => setKeep(e.target.checked ? [...keep, c.key] : keep.filter((k) => k !== c.key))} />
            <span>
              {c.label}: {c.key === 'outline' ? 'a new shape' : `${shown(c.from)} → ${shown(c.to)}`} <span className="muted">keep the old</span>
            </span>
          </label>
        );
      case 'redundant':
        return <p key={c.key} className="lvl-change">{c.label}: its own {shown(c.from)} is now the library’s, so it inherits it.</p>;
      case 'invalid':
        return <p key={c.key} className="lvl-change">{c.label}: {shown(c.from)} no longer fits; back to {shown(c.to)}.</p>;
      default:
        return <p key={c.key} className="lvl-change">{c.label}: gone from the library; its {shown(c.from)} is dropped.</p>;
    }
  };
  return (
    <div className="lvl-update" role="group" aria-label="Library update">
      <p>
        <b>{name}</b> has changed since this was placed (v{m.from} → v{m.to}).{' '}
        {m.known ? (m.changes.length ? 'Updating it:' : 'Nothing it has changes.') : 'What changed wasn’t recorded; updating takes the library’s current values.'}
      </p>
      {m.changes.map(line)}
      <div className="lvl-btnrow">
        <button className="tb-btn small primary" onClick={() => { onCommit(migrateItem(project, item.id, keep, global)); setKeep([]); }}>
          Update to v{m.to}
        </button>
        {others > 1 && (
          <button className="tb-btn small" title="Every item from an older version takes the library’s current values" onClick={() => onCommit(migrateAll(project, m.assetId, global))}>
            Update all {others}
          </button>
        )}
      </div>
    </div>
  );
};

/** Scene timeline events that happen here (spec §7.3), each opening its scene. */
const TimelineUses = ({ project, itemId, onOpen }: { project: Project; itemId: string; onOpen: (sceneId: string) => void }) => {
  const uses = eventsAt(project, itemId);
  if (!uses.length) return null;
  return (
    <div className="lvl-uses" aria-label="On scene timelines">
      <span className="lvl-sub">On scene timelines</span>
      {uses.map((u) => {
        const scene = project.objects[u.sceneId]!;
        return (
          <button key={`${u.event.id}:${u.role}`} className="use" onClick={() => onOpen(u.sceneId)} title={u.how === 'link' ? 'Found through its link to what the event stands for' : 'Placed here on the timeline'}>
            {String(scene.data.code ?? scene.name)} · {u.role === 'to' ? 'moves here: ' : ''}{eventTitle(project, u.event)}
          </button>
        );
      })}
    </div>
  );
};

const PIVOTS: { label: string; at: { x: number; y: number } }[] = [
  { label: 'Centre', at: { x: 0, y: 0 } },
  { label: 'North-west corner', at: { x: -0.5, y: -0.5 } },
  { label: 'North edge', at: { x: 0, y: -0.5 } },
  { label: 'North-east corner', at: { x: 0.5, y: -0.5 } },
  { label: 'East edge', at: { x: 0.5, y: 0 } },
  { label: 'South-east corner', at: { x: 0.5, y: 0.5 } },
  { label: 'South edge', at: { x: 0, y: 0.5 } },
  { label: 'South-west corner', at: { x: -0.5, y: 0.5 } },
  { label: 'West edge', at: { x: -0.5, y: 0 } },
];

const pivotName = (pivot: { x: number; y: number } | undefined): string =>
  PIVOTS.find((p) => p.at.x === (pivot?.x ?? 0) && p.at.y === (pivot?.y ?? 0))?.label ?? 'Custom';

/**
 * The map itself (spec V2 §3, §11–§13): what it is at its scale, what it is
 * part of, its extent, grid and origin, how the game reaches it, how far along
 * it is, and the maps inside it.
 */
const MapSection = ({ project, levelId, global, open, onToggle, onCommit, onOpenMap }: { project: Project; levelId: string; global: readonly AssetDefinition[]; open: boolean; onToggle: () => void; onCommit: (p: Project) => void; onOpenMap?: (id: string) => void }) => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const units = set.settings.units;
  const parent = level.parentId ? set.levels.find((l) => l.id === level.parentId) : undefined;
  const anchor = anchorOf(set, level);
  const bounds = mapBounds(set, level, global);
  const kids = childrenOf(set, level.id);
  const inside = new Set([level.id, ...descendantsOf(set, level.id).map((d) => d.id)]);
  const set1 = (patch: Parameters<typeof updateMap>[2]) => onCommit(updateMap(project, level.id, patch));
  return (
    <Section title="Map" open={open} onToggle={onToggle} count={kids.length || undefined}>
      <SelectField label="Kind" value={kindOf(level)} options={MAP_KINDS.map((k) => ({ value: k.id, label: k.label }))} onCommit={(v) => set1({ kind: v as typeof level.kind })} />
      <SelectField
        label="Part of"
        value={level.parentId ?? ''}
        options={[{ value: '', label: 'Nothing (a top map)' }, ...set.levels.filter((l) => !inside.has(l.id)).map((l) => ({ value: l.id, label: `${l.name} (${kindLabel(kindOf(l))})` }))]}
        onCommit={(v) => onCommit(moveMap(project, level.id, v || undefined))}
      />
      {parent && (
        <p className="lvl-hint">
          {anchor ? (
            <>
              Details <strong>{anchor.name}</strong> on {parent.name}.{' '}
            </>
          ) : (
            <>Inside {parent.name}, not tied to an item there. </>
          )}
          <button className="tb-btn small" onClick={() => onOpenMap?.(parent.id)}>
            ↑ Back to {parent.name}
          </button>
        </p>
      )}
      <NumberField label="Width" unit="length" units={units} value={bounds?.w ?? 0} min={0} step={level.grid ?? 1} hint={level.width ? undefined : anchor ? `from ${anchor.name}` : 'no edge: set one to draw it'} onCommit={(v) => set1({ width: v > 0 ? v : undefined, ...(v > 0 && !level.depth ? { depth: bounds?.d || v } : {}) })} />
      <NumberField label="Depth" unit="length" units={units} value={bounds?.d ?? 0} min={0} step={level.grid ?? 1} onCommit={(v) => set1({ depth: v > 0 ? v : undefined, ...(v > 0 && !level.width ? { width: bounds?.w || v } : {}) })} />
      {bounds && <p className="lvl-hint">{formatLength(bounds.w, units)} × {formatLength(bounds.d, units)}</p>}
      <NumberField label="Map grid" unit="length" units={units} value={level.grid ?? set.settings.grid} min={0.01} step={level.grid ?? 0.25} hint={level.grid ? undefined : 'the project’s'} onCommit={(v) => set1({ grid: v > 0 ? v : undefined })} />
      <NumberField label="Origin east" unit="length" units={units} value={level.origin?.x ?? 0} step={level.grid ?? 1} hint="where its 0, 0 is, from its centre" onCommit={(v) => set1({ origin: { x: v, y: level.origin?.y ?? 0 } })} />
      <NumberField label="Origin south" unit="length" units={units} value={level.origin?.y ?? 0} step={level.grid ?? 1} onCommit={(v) => set1({ origin: { x: level.origin?.x ?? 0, y: v } })} />
      <SelectField label="Reached" value={level.boundary ?? 'continuous'} options={BOUNDARIES.map((b) => ({ value: b.id, label: b.label }))} onCommit={(v) => set1({ boundary: v as typeof level.boundary })} />
      <p className="lvl-hint">{BOUNDARIES.find((b) => b.id === (level.boundary ?? 'continuous'))?.hint}</p>
      <SelectField
        label="Status"
        value={level.status ?? ''}
        options={[{ value: '', label: `Worked out: ${STATUSES.find((st) => st.id === statusOf(set, { ...level, status: undefined }, global))?.label}` }, ...STATUSES.map((st) => ({ value: st.id, label: st.label }))]}
        onCommit={(v) => set1({ status: (v || undefined) as typeof level.status })}
      />
      <TextField label="Environment" value={level.environment ?? ''} placeholder="e.g. Night, fog, rain" onCommit={(v) => set1({ environment: v.trim() || undefined })} />
      <TextField label="Navigation" value={level.navigation ?? ''} placeholder="e.g. Navmesh, agent 0.4 m" onCommit={(v) => set1({ navigation: v.trim() || undefined })} />
      <BoolField label="Favourite" value={!!level.favorite} onCommit={(v) => set1({ favorite: v || undefined })} />
      <BoolField label="Locked" value={!!level.locked} onCommit={(v) => set1({ locked: v || undefined })} />
      {kids.length > 0 && <span className="lvl-flabel">Maps inside</span>}
      {kids.map((k) => (
        <div key={k.id} className="lvl-link">
          <button className="lvl-link-go" onClick={() => onOpenMap?.(k.id)}>
            {k.name}
            <span className="muted">{kindLabel(kindOf(k))}</span>
          </button>
        </div>
      ))}
    </Section>
  );
};

/** For an item: the map it opens into, or the way to make one. */
export const ChildMapRow = ({ project, itemId, onOpenChild }: { project: Project; itemId: string; onOpenChild?: (id: string) => void }) => {
  const set = levelsOf(project);
  const child = childOfItem(set, itemId);
  return (
    <div className="lvl-btnrow wrap">
      <button className="tb-btn small" onClick={() => onOpenChild?.(itemId)} title={child ? `Open ${child.name}` : 'Make a map of it, the next scale down, and open it'}>
        {child ? `Open ${child.name} ▸` : 'Open as a map ▸'}
      </button>
      {child && <span className="muted">{kindLabel(kindOf(child))} · its own map</span>}
    </div>
  );
};

