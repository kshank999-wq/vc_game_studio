import { bandRange } from '../../model/level-lane';
import type { LaneRow } from '../../model/layout';
import type { Lane, LevelBand, Project } from '../../model/types';
import { EyeIcon, LockIcon, UnlockIcon } from '../Symbol';

/** Full-width bands for every lane: they run the whole story, at every pan. */
export const TrackBand = ({ row, top, height, empty }: { row: LaneRow; top: number; height: number; empty: boolean }) => {
  const { lane } = row;
  return (
    <div className={`track track-${lane.kind}`} style={{ top, height, '--lane': lane.color } as React.CSSProperties}>
      {empty && lane.kind === 'character' && height > 40 && (
        <span className="track-hint" style={{ color: lane.color }}>
          {lane.name}’s arc runs the whole story. Drop arc events here; each ties to the moment above it.
        </span>
      )}
      {empty && lane.kind === 'subplot' && height > 40 && (
        <span className="track-hint" style={{ color: lane.color }}>
          {lane.role === 'player' ? 'The player’s progression' : lane.name} runs the whole story. Drop plot points, scenes and choices anywhere along it.
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
  /** Start dragging the lane up or down the stack. */
  onGrip: (e: React.PointerEvent) => void;
  /** Move the lane one place up (-1) or down (1); null where it can't go. */
  onMoveBy: ((by: -1 | 1) => void) | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/** The handle that drags a lane above or below the others. */
const Grip = ({ lane, controls }: { lane: Lane; controls: LaneControls }) => (
  <span
    className="lane-grip"
    role="button"
    aria-label={`Drag ${lane.kind === 'spine' ? 'the spine' : lane.name} up or down`}
    title="Drag to move this lane up or down"
    onPointerDown={controls.onGrip}
  >
    ⠿
  </span>
);

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
      <button role="menuitem" disabled={!controls.canMoveUp} onClick={() => controls.onMoveBy?.(-1)}>
        Move up
      </button>
      <button role="menuitem" disabled={!controls.canMoveDown} onClick={() => controls.onMoveBy?.(1)}>
        Move down
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
        <span className="header-row">
          <Grip lane={lane} controls={controls} />
          <b>LEVELS</b>
        </span>
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
          <span className="header-row">
            <Grip lane={lane} controls={controls} />
            <b>SPINE</b>
          </span>
          {roomy && <span className="header-sub">Main plot · locked lane</span>}
          {roomy && (
            <span className="header-icons" title="The spine is locked in place">
              <LockIcon />
            </span>
          )}
        </>
      ) : lane.kind === 'subplot' ? (
        <>
          {/* The kind on top, the name on a line of its own so it isn't cut short. */}
          <span className="header-row">
            <Grip lane={lane} controls={controls} />
            <b>{lane.role === 'player' ? 'PLAYER' : 'SUBPLOT'}</b>
          </span>
          <Field value={lane.name} field="name" placeholder="Name this subplot…" className="header-lane-name" controls={controls} />
          {height >= 96 && <Field value={lane.subtitle} field="subtitle" placeholder="What it’s about" className="header-sub" controls={controls} />}
          {height >= 66 && <LaneIcons lane={lane} controls={controls} />}
          <LaneMenu controls={controls} />
        </>
      ) : (
        <>
          <span className="header-row">
            <Grip lane={lane} controls={controls} />
            <b className="header-arc">
              ARC · <Field value={lane.name} field="name" placeholder="Character" className="header-arc-name" controls={controls} />
            </b>
          </span>
          {roomy && <Field value={lane.subtitle} field="subtitle" placeholder="from → to" className="header-sub" controls={controls} />}
          {roomy && <LaneIcons lane={lane} controls={controls} />}
          <LaneMenu controls={controls} />
        </>
      )}
    </div>
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
