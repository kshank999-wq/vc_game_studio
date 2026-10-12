import { bandRange } from '../../model/level-lane';
import { spanRange, type LaneRow } from '../../model/layout';
import type { Lane, LevelBand, Project } from '../../model/types';
import { EyeIcon, LockIcon, UnlockIcon } from '../Symbol';

/** Full-width bands for the spine and character arcs: they run the whole story, at every pan. */
export const TrackBand = ({ row, top, height, empty }: { row: LaneRow; top: number; height: number; empty: boolean }) => {
  const { lane } = row;
  return (
    <div className={`track track-${lane.kind}`} style={{ top, height, '--lane': lane.color } as React.CSSProperties}>
      {empty && lane.kind === 'character' && height > 40 && (
        <span className="track-hint" style={{ color: lane.color }}>
          {lane.name}’s arc runs the whole story. Drop arc events here; each ties to the moment above it.
        </span>
      )}
    </div>
  );
};

export type LaneField = 'name' | 'subtitle';

export interface LaneControls {
  editing: LaneField | null;
  menuOpen: boolean;
  onEdit: (field: LaneField) => void;
  onEditDone: (field: LaneField, value: string | null) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMenu: () => void;
  onDelete: () => void;
}

const Field = ({ value, field, placeholder, className, controls }: {
  value: string;
  field: LaneField;
  placeholder: string;
  className: string;
  controls: LaneControls;
}) =>
  controls.editing === field ? (
    <input
      className="header-input"
      aria-label={field === 'name' ? 'Lane name' : 'Lane description'}
      defaultValue={value}
      placeholder={placeholder}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => controls.onEditDone(field, e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') controls.onEditDone(field, null);
      }}
    />
  ) : (
    <span className={`${className}${value ? '' : ' placeholder'}`} title="Double-click to edit" onDoubleClick={() => controls.onEdit(field)}>
      {value || placeholder}
    </span>
  );

const LaneIcons = ({ lane, controls }: { lane: Lane; controls: LaneControls }) => (
  <span className="header-icons">
    <button aria-label={`Hide ${lane.name}`} title="Hide lane" onClick={controls.onToggleVisible}>
      <EyeIcon />
    </button>
    <button
      aria-label={lane.locked ? `Unlock ${lane.name}` : `Lock ${lane.name}`}
      aria-pressed={lane.locked}
      title={lane.locked ? 'Unlock lane' : 'Lock lane'}
      className={lane.locked ? 'on' : ''}
      onClick={controls.onToggleLock}
    >
      {lane.locked ? <LockIcon /> : <UnlockIcon />}
    </button>
    <button aria-label={`More for ${lane.name}`} aria-expanded={controls.menuOpen} onClick={controls.onMenu}>
      ⋯
    </button>
  </span>
);

const LaneMenu = ({ controls }: { controls: LaneControls }) =>
  controls.menuOpen ? (
    <div className="lane-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <button role="menuitem" onClick={() => controls.onEdit('name')}>
        Rename
      </button>
      <button role="menuitem" onClick={controls.onToggleVisible}>
        Hide
      </button>
      <button role="menuitem" className="danger" onClick={controls.onDelete}>
        Delete lane
      </button>
    </div>
  ) : null;

/** The sticky header on the left of the spine and of each character lane. */
export const TrackHeader = ({ lane, top, height, controls, onAddLevel }: { lane: Lane; top: number; height: number; controls: LaneControls; onAddLevel?: () => void }) => {
  const roomy = height >= 56;
  const inset = lane.kind === 'spine' ? 2 : 1;
  if (lane.kind === 'level') {
    return (
      <div
        className="track-header header-level"
        style={{ top: top + inset, height: Math.max(0, height - inset * 2), '--lane': lane.color } as React.CSSProperties}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <b>LEVELS</b>
        {height >= 28 && (
          <button className="header-add" title="Add a level after the last one, between the next two plot points" onClick={onAddLevel}>
            + Level
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className={`track-header header-${lane.kind}`}
      style={{ top: top + inset, height: Math.max(0, height - inset * 2), '--lane': lane.color } as React.CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {lane.kind === 'spine' ? (
        <>
          <b>SPINE</b>
          {roomy && <span className="header-sub">Main plot · locked lane</span>}
          {roomy && (
            <span className="header-icons" title="The spine is locked in place">
              <LockIcon />
            </span>
          )}
        </>
      ) : (
        <>
          <b className="header-arc">
            ARC · <Field value={lane.name} field="name" placeholder="Character" className="header-arc-name" controls={controls} />
          </b>
          {roomy && <Field value={lane.subtitle} field="subtitle" placeholder="from → to" className="header-sub" controls={controls} />}
          {roomy && <LaneIcons lane={lane} controls={controls} />}
          <LaneMenu controls={controls} />
        </>
      )}
    </div>
  );
};

/**
 * A subplot is a short band of its own, below the spine, between the node it
 * branches off and the node it rejoins. Its ends are handles; beats dropped
 * into it make it longer.
 */
export const SubplotBand = ({ project, row, empty, controls, onHandleDown }: {
  project: Project;
  row: LaneRow;
  empty: boolean;
  controls: LaneControls;
  onHandleDown: (e: React.PointerEvent, laneId: string, edge: 'start' | 'end') => void;
}) => {
  const range = spanRange(project, row.lane);
  if (!range) return null;
  const { lane } = row;
  const handle = (edge: 'start' | 'end', x: number) => (
    <div
      className={`span-handle${lane.locked ? ' locked' : ''}`}
      role="slider"
      aria-label={`${lane.name}: where it ${edge === 'start' ? 'branches off' : 'rejoins the spine'}`}
      aria-valuenow={Math.round(x)}
      title={lane.locked ? 'Lane is locked' : edge === 'start' ? 'Drag to the spine node it branches off' : 'Drag to the spine node it rejoins'}
      style={{ left: x - 4, top: row.top + 10, height: row.height - 20 }}
      onPointerDown={(e) => (lane.locked ? e.stopPropagation() : onHandleDown(e, lane.id, edge))}
    />
  );
  return (
    <>
      <div
        className={`subplot-band${empty ? ' empty' : ''}${lane.locked ? ' locked' : ''}`}
        style={{ left: range.from, width: range.to - range.from, top: row.top, height: row.height }}
      >
        <div className="subplot-tab" onPointerDown={(e) => e.stopPropagation()}>
          <b>SUBPLOT</b>
          <Field value={lane.name} field="name" placeholder="Name this subplot…" className="subplot-name" controls={controls} />
          <LaneIcons lane={lane} controls={controls} />
          <LaneMenu controls={controls} />
        </div>
        {empty && <span className="band-hint">Drop beats here · it grows to fit</span>}
      </div>
      {handle('start', range.from)}
      {handle('end', range.to)}
    </>
  );
};

/**
 * A level on the Level lane: a band from one spine plot point to another.
 * Its ends are handles to stretch it; double-click opens its map.
 */
export const LevelBands = ({ project, row, editing, onEditDone, onEdit, onHandleDown, onOpen, onDelete }: {
  project: Project;
  row: LaneRow;
  editing: string | null;
  onEdit: (bandId: string) => void;
  onEditDone: (bandId: string, name: string | null) => void;
  onHandleDown: (e: React.PointerEvent, bandId: string, edge: 'start' | 'end') => void;
  onOpen: (band: LevelBand) => void;
  onDelete: (band: LevelBand) => void;
}) => {
  const bands = row.lane.levels ?? [];
  return (
    <>
      {bands.length === 0 && (
        <span className="level-hint" style={{ top: row.top + row.height / 2 }}>
          Add a level with + Level, then stretch it between plot points. Scenes and cinematics on the spine under it happen in that level.
        </span>
      )}
      {bands.map((band) => {
        const range = bandRange(project, band);
        if (!range) return null;
        const handle = (edge: 'start' | 'end', x: number) => (
          <div
            key={edge}
            className="span-handle level-handle"
            role="slider"
            aria-label={`${band.name}: where it ${edge === 'start' ? 'starts' : 'ends'}`}
            aria-valuenow={Math.round(x)}
            title={edge === 'start' ? 'Drag to the plot point this level starts at' : 'Drag to the plot point this level ends at'}
            style={{ left: x - 4, top: row.top + 8, height: row.height - 16 }}
            onPointerDown={(e) => onHandleDown(e, band.id, edge)}
          />
        );
        return (
          <div key={band.id}>
            <div
              className="level-band"
              data-level={band.id}
              style={{ left: range.from, width: range.to - range.from, top: row.top + 4, height: row.height - 8 }}
              title="Double-click to open this level’s map"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={() => onOpen(band)}
            >
              <b>LEVEL</b>
              {editing === band.id ? (
                <input
                  className="header-input"
                  aria-label="Level name"
                  defaultValue={band.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={(e) => onEditDone(band.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') onEditDone(band.id, null);
                  }}
                />
              ) : (
                <span
                  className="level-name"
                  title="Double-click to rename"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEdit(band.id);
                  }}
                >
                  {band.name}
                </span>
              )}
              <span className="level-actions">
                <button aria-label={`Open the map for ${band.name}`} title="Open its map in the Level Designer" onClick={() => onOpen(band)}>
                  Map ↗
                </button>
                <button aria-label={`Take ${band.name} off the lane`} title="Take it off the Level lane (its map stays in the Level Designer)" onClick={() => onDelete(band)}>
                  ×
                </button>
              </span>
            </div>
            {handle('start', range.from)}
            {handle('end', range.to)}
          </div>
        );
      })}
    </>
  );
};
