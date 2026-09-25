import type { Lane, ObjectType, StoryObject } from '../../model/types';
import { LockIcon } from '../Symbol';

const KICKER: Partial<Record<ObjectType, string>> = {
  plotPoint: 'Plot point',
  scene: 'Scene',
  cinematic: 'Cinematic',
  dialogue: 'Dialogue',
};

const POLARITY_MARK = { up: '+', down: '−', turn: '◆' } as const;

export type PortState = 'none' | 'valid' | 'invalid';

export interface NodeProps {
  object: StoryObject;
  /** The track the node is on, or 'branch' for the open space above the spine. */
  place: Lane['kind'] | 'branch';
  laneColor?: string;
  box: { x: number; y: number; w: number; h: number };
  selected: boolean;
  ghost: boolean;
  editing: boolean;
  issue?: string;
  /** A line about what the node holds, in place of its default subtitle. */
  detail?: string;
  /** Lit while a connector is dragged over the node. */
  target: PortState;
  onPointerDown: (e: React.PointerEvent) => void;
  onPortDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}

const NameField = ({ object, editing, onRename, onCancelRename, className }: Pick<NodeProps, 'object' | 'editing' | 'onRename' | 'onCancelRename'> & { className: string }) =>
  editing ? (
    <input
      className={`node-input ${className}`}
      aria-label="Name"
      defaultValue={object.name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onRename(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onCancelRename();
      }}
    />
  ) : (
    <span className={className}>{object.name}</span>
  );

const Port = ({ onPortDown, color }: { onPortDown: NodeProps['onPortDown']; color?: string }) => (
  <span
    className="port-ring"
    role="button"
    aria-label="Drag to connect"
    title="Drag to another node to connect"
    style={color ? { borderColor: color } : undefined}
    onPointerDown={onPortDown}
  />
);

const Badge = ({ issue }: { issue?: string }) =>
  issue ? (
    <span className="issue-badge" title={issue} aria-label={issue}>
      !
    </span>
  ) : null;

export const NodeView = (props: NodeProps) => {
  const { object, box, place } = props;
  const state = `${props.selected ? ' selected' : ''}${props.ghost ? ' ghost' : ''}${props.target !== 'none' ? ` target-${props.target}` : ''}`;
  const style = { left: box.x, top: box.y, width: box.w, height: box.h };
  const common = {
    'data-node': object.id,
    'data-type': object.type,
    onPointerDown: props.onPointerDown,
    onContextMenu: props.onContextMenu,
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      props.onDoubleClick();
    },
  };

  if (object.type === 'begin' || object.type === 'end') {
    const defaultName = object.type === 'begin' ? 'Beginning' : 'Ending';
    return (
      <div className={`node pill${state}`} style={style} title={`${object.name} — protected`} {...common}>
        {object.type === 'begin' && <span className="start-tag">START</span>}
        {(object.name !== defaultName || props.editing) && <NameField {...props} className="pill-name" />}
        <LockIcon size={9} color="var(--ground)" />
        {object.type === 'begin' ? 'BEGIN' : 'END'}
        {object.type === 'begin' && <Port onPortDown={props.onPortDown} />}
      </div>
    );
  }

  if (object.type === 'choice') {
    return (
      <div className={`node choice${state}`} style={style} title={object.name} {...common}>
        {object.data.code}
        {props.editing && <NameField {...props} className="choice-name" />}
        {!props.editing && object.name !== 'Choice' && <span className="choice-name">{object.name}</span>}
        <Port onPortDown={props.onPortDown} />
        <Badge issue={props.issue} />
      </div>
    );
  }

  if (object.type === 'arcEvent') {
    const polarity = object.data.polarity ?? 'up';
    return (
      <div
        className={`node arc-event arc-${polarity}${state}`}
        style={{ ...style, '--lane': props.laneColor } as React.CSSProperties}
        title={`${object.name} — right-click for growth, setback or turning point`}
        {...common}
      >
        <span className="arc-mark">{polarity === 'turn' ? <i /> : POLARITY_MARK[polarity]}</span>
        <NameField {...props} className="arc-name" />
        <Port onPortDown={props.onPortDown} color={props.laneColor} />
        <Badge issue={props.issue} />
      </div>
    );
  }

  const subplot = place === 'subplot';
  const outcome = object.data.outcome;
  const kicker = outcome === 'gameOver'
    ? 'Game over'
    : outcome === 'ending'
      ? 'Ending · alt'
      : subplot
        ? `Subplot · ${object.data.code ?? ''}`
        : object.type === 'scene'
          ? `${place === 'branch' ? 'Alt' : 'Scene'} · ${object.data.code ?? ''}`
          : KICKER[object.type] ?? '';
  const renamed = object.type === 'plotPoint' && object.name !== `Plot Point ${object.data.code?.replace(/\D/g, '')}`;
  const sub =
    props.detail ??
    object.data.summary ??
    (object.type === 'plotPoint' && !subplot ? (renamed ? object.data.code : 'Name it…') : object.type === 'cinematic' || object.type === 'dialogue' ? object.data.code : '');
  return (
    <div
      className={`node card card-${object.type}${subplot ? ' card-subplot' : ''}${outcome ? ' card-outcome' : ''}${state}`}
      style={style}
      {...common}
    >
      <span className="card-kicker">
        <i />
        {kicker}
      </span>
      <NameField {...props} className="card-name" />
      {!subplot && sub ? <span className={`card-sub${sub === 'Name it…' ? ' placeholder' : ''}`}>{sub}</span> : null}
      {!outcome && <Port onPortDown={props.onPortDown} />}
      <Badge issue={props.issue} />
    </div>
  );
};
