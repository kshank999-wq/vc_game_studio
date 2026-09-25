import type { Lane } from '../model/types';
import { Symbol } from './Symbol';

interface Props {
  lanes: Lane[];
  zoom: number;
  onAddLane: (kind: 'subplot' | 'character') => void;
  onToggleLane: (laneId: string) => void;
  onZoomToSpine: () => void;
  onZoom: (factor: number) => void;
}

/** The lane menu under the canvas (HANDOFF iteration 2). */
export const BottomBar = ({ lanes, zoom, onAddLane, onToggleLane, onZoomToSpine, onZoom }: Props) => {
  const others = lanes.filter((l) => l.kind !== 'spine').sort((a, b) => a.order - b.order);
  return (
    <div className="bottombar">
      <button className="tb-btn add-subplot" onClick={() => onAddLane('subplot')}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 8h14" stroke="var(--c-subplot)" strokeWidth="3" strokeDasharray="3 2" />
        </svg>
        + Add subplot lane
      </button>
      <button className="tb-btn add-character" onClick={() => onAddLane('character')}>
        <Symbol type="character" />+ Add character lane
      </button>
      {others.length > 0 && (
        <>
          <div className="divider" />
          <span className="bottombar-label">Lanes</span>
          <div className="lane-chips">
            {others.map((lane) => (
              <button
                key={lane.id}
                className={`lane-chip${lane.visible ? '' : ' hidden'}`}
                style={{ '--lane': lane.color } as React.CSSProperties}
                aria-pressed={lane.visible}
                title={lane.visible ? 'Hide this lane' : 'Show this lane'}
                onClick={() => onToggleLane(lane.id)}
              >
                {lane.name}
                {!lane.visible && ' · hidden'}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="grow" />
      <button className="tb-btn" onClick={onZoomToSpine}>
        Zoom to spine
      </button>
      <button className="icon-btn" aria-label="Zoom out" onClick={() => onZoom(1 / 1.2)}>
        −
      </button>
      <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      <button className="icon-btn" aria-label="Zoom in" onClick={() => onZoom(1.2)}>
        +
      </button>
    </div>
  );
};
