import { useState } from 'react';
import { holdingSpots } from '../../model/level/holding';
import { captureIssues, captureOn, clearCapture, describeCapture, setCapture, setUpCapture, type CaptureRule } from '../../model/capture';
import { addLevelBand } from '../../model/level-lane';
import { MISSION_SLOTS, missionBoard, setMission, type MissionCard } from '../../model/missions';
import { codeFormatFor, makeObject, nextCode } from '../../model/project';
import { varTypeOf } from '../../model/details';
import type { ObjectType, Project, StoryObject } from '../../model/types';
import { Num, Text } from '../defense/fields';
import { Intro, StepTabs } from '../modules/parts';

type Tab = 'cards' | 'capture';
const TABS: { id: Tab; label: string }[] = [
  { id: 'cards', label: 'Mission cards' },
  { id: 'capture', label: 'Captured' },
];

const sorted = (p: Project, ...types: ObjectType[]) =>
  Object.values(p.objects)
    .filter((o) => types.includes(o.type))
    .sort((a, b) => a.name.localeCompare(b.name));

const Pick = ({ label, value, options, onPick, none = '— none —', onNew }: { label: string; value: string | undefined; options: StoryObject[]; onPick: (id: string | undefined) => void; none?: string; onNew?: () => void }) => (
  <label className="dfn-text">
    <span>{label}</span>
    <span className="adv-pick">
      <select className="inp small" aria-label={label} value={value && options.some((o) => o.id === value) ? value : ''} onChange={(e) => onPick(e.target.value || undefined)}>
        <option value="">{none}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.data.code ? `${o.data.code} ` : ''}
            {o.name}
          </option>
        ))}
      </select>
      {onNew ? (
        <button type="button" className="tb-btn" onClick={onNew}>
          + New
        </button>
      ) : null}
    </span>
  </label>
);

const Ticks = ({ label, options, value, onChange }: { label: string; options: StoryObject[]; value: readonly string[]; onChange: (ids: string[]) => void }) => (
  <fieldset className="adv-ticks">
    <legend>{label}</legend>
    {options.length ? (
      options.map((o) => (
        <label key={o.id} className="dfn-check">
          <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> {o.name}
          <span className="muted"> · {o.type === 'skill' ? 'power' : o.type === 'inventory' ? 'item' : o.type}</span>
        </label>
      ))
    ) : (
      <p className="dfn-hint">None in the story yet.</p>
    )}
  </fieldset>
);

/** Something new in the Bible, named for where it is made: its id and the project with it. */
const make = (p: Project, type: ObjectType, name: string) => {
  const format = codeFormatFor(type);
  const o = makeObject(type, name, new Date().toISOString(), format ? { code: nextCode(p, format) } : {});
  return { project: { ...p, objects: { ...p.objects, [o.id]: o } }, id: o.id };
};

/**
 * Missions (adventure games): a card for each level of the Level lane, the
 * level's checklist, and what happens when the hero is captured.
 */
export const MissionsView = ({ project, onCommit, onOpenLevels, onOpenScene, onOpenPuzzles }: { project: Project; onCommit: (p: Project) => void; onOpenLevels: (mapId?: string) => void; onOpenScene: (id: string) => void; onOpenPuzzles: (id?: string) => void }) => {
  const [tab, setTab] = useState<Tab>('cards');
  const board = missionBoard(project);
  const [picked, setPicked] = useState<string | null>(null);
  const at = board.find((b) => b.band.id === picked) ?? board[0];
  const issues = [
    ...board.filter((b) => b.gaps.length).map((b) => ({ severity: 'warning', message: `${b.band.name}: ${b.gaps.length} to fill in` })),
    ...captureIssues(project).map((message) => ({ severity: 'warning', message: `Captured: ${message}` })),
  ];
  return (
    <div className="dfn-studio adv-missions">
      <StepTabs label="Missions" tabs={TABS} tab={tab} onTab={setTab} issues={issues} />
      <div className="dfn-main">
        {tab === 'cards' ? (
          <div className="dfn-pane">
            <Intro title="Mission cards">One card for each level: the mission that opens the next level, the puzzle in the way, who gives the clue, what the hero gains, and where they can be captured. Fill it in before you build the level; then build what it names.</Intro>
            <div className="adv-editor">
              <aside className="adv-side">
                <ol className="adv-levels">
                  {board.map(({ band, gaps }, i) => (
                    <li key={band.id}>
                      <button className={`dfn-tab${band.id === at?.band.id ? ' on' : ''}`} onClick={() => setPicked(band.id)}>
                        <span className="dfn-tab-num">{i + 1}</span> {band.name}
                        <span className={`adv-left${gaps.length ? '' : ' done'}`}>{gaps.length ? `${gaps.length} to do` : '✓'}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  className="tb-btn"
                  onClick={() => {
                    const made = addLevelBand(project);
                    if (made) {
                      onCommit(made.project);
                      setPicked(made.id);
                    }
                  }}
                >
                  + Level
                </button>
              </aside>
              {at ? <Card key={at.band.id} project={project} bandId={at.band.id} name={at.band.name} card={at.card} gaps={at.gaps} warnings={at.warnings} mapId={at.band.mapId} onCommit={onCommit} onOpenLevels={onOpenLevels} onOpenPuzzles={onOpenPuzzles} /> : <p className="dfn-hint">No levels yet: add one, and it goes on the Level lane above the spine with a map of its own.</p>}
            </div>
          </div>
        ) : (
          <CapturePane project={project} onCommit={onCommit} onOpenScene={onOpenScene} />
        )}
      </div>
    </div>
  );
};

const Card = ({ project, bandId, name, card, gaps, warnings, mapId, onCommit, onOpenLevels, onOpenPuzzles }: { project: Project; bandId: string; name: string; card: MissionCard; gaps: string[]; warnings: string[]; mapId?: string; onCommit: (p: Project) => void; onOpenLevels: (mapId?: string) => void; onOpenPuzzles: (id?: string) => void }) => {
  const set = (patch: Partial<MissionCard>) => onCommit(setMission(project, bandId, patch));
  const create = (type: ObjectType, label: string, slot: 'questId' | 'puzzleId' | 'clueFromId') => {
    const made = make(project, type, `${name}: ${label}`);
    onCommit(setMission(made.project, bandId, { [slot]: made.id }));
  };
  return (
    <section className="adv-card" aria-label={`${name}’s mission card`}>
      <h3>{name}</h3>
      <ul className="adv-checklist" aria-label="Checklist">
        {MISSION_SLOTS.map((s) => (
          <li key={s.slot} className={gaps.includes(s.slot) ? 'todo' : 'done'} title={s.hint}>
            {gaps.includes(s.slot) ? '○' : '✓'} {s.label}
          </li>
        ))}
      </ul>
      <div className="dfn-grid">
        <Pick label="Mission (the quest that opens the next level)" value={card.questId} options={sorted(project, 'quest')} onPick={(id) => set({ questId: id })} onNew={() => create('quest', 'mission', 'questId')} />
        <Pick label="Puzzle in the way" value={card.puzzleId} options={sorted(project, 'puzzle')} onPick={(id) => set({ puzzleId: id })} onNew={() => create('puzzle', 'puzzle', 'puzzleId')} />
        <Pick label="Who gives the clue" value={card.clueFromId} options={sorted(project, 'character')} onPick={(id) => set({ clueFromId: id })} onNew={() => create('character', 'clue-giver', 'clueFromId')} />
        <Text label="The clue" value={card.clue ?? ''} placeholder="What they tell the hero, in a line" onCommit={(v) => set({ clue: v })} />
        <Text label="Where the hero can be captured" value={card.capture ?? ''} placeholder="The guard post by the gate · or “none”" onCommit={(v) => set({ capture: v })} />
      </div>
      {card.questId && project.objects[card.questId] ? (
        <label className="dfn-check">
          <input type="checkbox" checked={!card.open} onChange={(e) => set({ open: e.target.checked ? undefined : true })} /> The mission holds the hero here: they can’t go on to the next level until it is done (they go back to the start of the level instead)
        </label>
      ) : null}
      <Ticks label="What the hero gains here" options={sorted(project, 'inventory', 'skill')} value={card.gains ?? []} onChange={(ids) => set({ gains: ids })} />
      <Text label="Notes" area value={card.notes ?? ''} placeholder="Anything else the level needs" onCommit={(v) => set({ notes: v })} />
      {warnings.map((w) => (
        <p key={w} className="dfn-verdict lost">
          {w}
        </p>
      ))}
      <div className="dfn-controls">
        <button className="tb-btn primary" onClick={() => onOpenLevels(mapId)}>
          Build the level
        </button>
        {card.puzzleId && project.objects[card.puzzleId] ? (
          <button className="tb-btn" onClick={() => onOpenPuzzles(card.puzzleId)}>
            Open the puzzle
          </button>
        ) : null}
      </div>
    </section>
  );
};

/** Where a catch takes the hero in each map: what is linked to the holding cell, or the room the studio picks. */
const HeldIn = ({ project }: { project: Project }) => {
  const spots = holdingSpots(project);
  if (!spots.length) return <p className="dfn-hint">Once the game has levels, a catch takes the hero to a room in the level: one named like a cell or jail, else the room farthest from the player start. Link a room to the holding cell to choose it yourself.</p>;
  const linked = spots.some((s) => s.spot && !s.spot.auto);
  return (
    <div className="adv-held">
      <h4>Where a catch takes the hero</h4>
      <ul>
        {spots.map((s) => (
          <li key={s.levelId}>
            <b>{s.level}</b>: {s.spot ? `${s.spot.item.name}${s.spot.auto ? ' (picked automatically)' : s.spot.item.levelId === s.levelId ? ' (linked)' : ' (linked, in another map)'}` : 'nowhere yet: add a room'}
          </li>
        ))}
      </ul>
      <p className="dfn-hint">
        {linked
          ? 'Something in the levels is linked to the holding cell, so every catch goes there. Unlink it to let each level pick its own room again.'
          : 'Picked in each level: a room named like a cell, jail or prison, else the room farthest from the player start. Link a room to the holding cell to choose it yourself. The engines get the same spots.'}{' '}
        The locker is whatever is linked to it.
      </p>
    </div>
  );
};

const CapturePane = ({ project, onCommit, onOpenScene }: { project: Project; onCommit: (p: Project) => void; onOpenScene: (id: string) => void }) => {
  const r = project.capture;
  const set = (patch: Partial<CaptureRule>) => onCommit(setCapture(project, patch));
  const numbers = sorted(project, 'state').filter((o) => varTypeOf(o) === 'number');
  const items = sorted(project, 'inventory');
  const ends = Object.values(project.objects).filter((o) => o.type === 'end' || o.data.outcome);
  const issues = captureIssues(project);
  if (!r)
    return (
      <div className="dfn-pane narrow">
        <Intro title="Captured">Losing a fight doesn’t have to end the game. The hero can be taken to a holding cell instead: what they carry is taken and locked away, they find a way out, get their things back, and the story picks up where they were caught. Each capture is counted, so an ending can depend on it.</Intro>
        <button className="tb-btn primary" onClick={() => onCommit(setUpCapture(project))}>
          Set up capture
        </button>
        <p className="dfn-hint">This adds a Holding cell (a scene off the spine, with a free play to find the way out), an Evidence locker in it, and two number states: Times captured, and Health (starting at 100).</p>
      </div>
    );
  return (
    <div className="dfn-pane">
      <Intro title="Captured">What captures the hero: losing an encounter set to Captured (“If the player loses”), or any loss that leaves their health below 1. In Play Mode, health running out, or a captor catching them.</Intro>
      <p className={`dfn-verdict${issues.length ? ' lost' : ' won'}`}>{captureOn(project) && !issues.length ? describeCapture(project) : issues[0]}</p>
      {issues.length > 1 ? (
        <ul className="dfn-issues-list">
          {issues.slice(1).map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      <div className="dfn-grid">
        <Pick label="The holding cell" value={r.cellId} options={sorted(project, 'scene')} onPick={(id) => set({ cellId: id })} />
        <label className="dfn-text">
          <span>What is taken</span>
          <select className="inp small" aria-label="What is taken" value={r.take} onChange={(e) => set({ take: e.target.value as CaptureRule['take'] })}>
            <option value="all">Everything carried</option>
            <option value="listed">Only what is listed</option>
            <option value="none">Nothing</option>
          </select>
        </label>
        <Pick label="Where it is kept (using it gives it back)" value={r.lockerId} options={sorted(project, 'object')} onPick={(id) => set({ lockerId: id })} none="— no locker: given back on the way out —" />
        <Pick label="Counts captures" value={r.countId} options={numbers} onPick={(id) => set({ countId: id })} />
        <Pick label="Health" value={r.healthId} options={numbers} onPick={(id) => set({ healthId: id })} none="— none: only Captured losses capture —" />
        {r.healthId ? <Num label="Health once captured" value={r.healthAfter ?? 50} min={1} onCommit={(v) => set({ healthAfter: v })} /> : null}
        <label className="dfn-text">
          <span>Once out, the story goes on</span>
          <select className="inp small" aria-label="Once out, the story goes on" value={r.backTo ?? ''} onChange={(e) => set({ backTo: e.target.value || undefined })}>
            <option value="">Where they were caught, past the fight</option>
            {sorted(project, 'scene', 'plotPoint')
              .filter((o) => o.id !== r.cellId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  At {o.data.code ? `${o.data.code} ` : ''}
                  {o.name}
                </option>
              ))}
          </select>
        </label>
        <Num label="Captured this many times ends it" suffix="0 for never" value={r.limit ?? 0} min={0} onCommit={(v) => set({ limit: v })} />
        {(r.limit ?? 0) > 0 ? <Pick label="…at this ending" value={r.limitId} options={ends} onPick={(id) => set({ limitId: id })} /> : null}
      </div>
      {r.take === 'listed' ? <Ticks label="Taken" options={items} value={r.items ?? []} onChange={(ids) => set({ items: ids })} /> : null}
      {r.take === 'all' ? <Ticks label="Never taken (the hero keeps these)" options={items} value={r.keep ?? []} onChange={(ids) => set({ keep: ids })} /> : null}
      <Ticks label="Captors: they catch the hero in Play Mode, rather than fight" options={sorted(project, 'character')} value={r.captors ?? []} onChange={(ids) => set({ captors: ids })} />
      <HeldIn project={project} />
      <div className="dfn-controls">
        {r.cellId && project.objects[r.cellId] ? (
          <button className="tb-btn primary" onClick={() => onOpenScene(r.cellId!)}>
            Open the holding cell
          </button>
        ) : null}
        <button className="tb-btn" onClick={() => onCommit(clearCapture(project))}>
          Turn capture off
        </button>
      </div>
    </div>
  );
};
