import { liveDestinations, refOf, statusOf } from '../../model/notes/sorter';
import type { ExtractedNote, NoteStatus } from '../../model/notes/types';
import type { ObjectType, Project } from '../../model/types';
import { Symbol } from '../Symbol';

/** What each status is called (HANDOFF: one marker per status, the same on every screen). */
export const STATUS_LABEL: Record<NoteStatus, string> = {
  unsorted: 'Unsorted',
  sorted: 'Sorted, still a note',
  converted: 'Converted, not placed',
  placed: 'Placed in the game',
  setAside: 'Set aside',
};

/**
 * A note's status marker: a grey dot unsorted, a gold ring sorted, the game
 * object's own symbol once converted, green once placed, a dashed ring set aside.
 */
export const StatusMark = ({ status, type, size = 12 }: { status: NoteStatus; type?: ObjectType; size?: number }) => {
  if (status === 'converted' && type) return <Symbol type={type} size={size} />;
  return <span className={`ns-mark ns-mark-${status}`} style={{ width: size, height: size }} role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} />;
};

/** A note's marker as it stands in the project. */
export const NoteMark = ({ project, note, size }: { project: Project; note: ExtractedNote; size?: number }) => {
  const status = statusOf(project, note);
  const type = liveDestinations(project, note)[0]?.objectType;
  return <StatusMark status={status} type={type} size={size} />;
};

// ---------------------------------------------------------------- dragging

/** What is being dragged: a passage of a source, a card, or a card's object on its way into the game. */
export type Dragged =
  | { kind: 'passage'; sourceId: string; start: number; end: number }
  | { kind: 'note'; noteId: string }
  | { kind: 'object'; noteId: string; objectId: string };

const TYPE = 'application/x-vcgs-notes';

/** The last thing picked up, for drops (and for tests, where a drag's data can't be read back). */
let current: Dragged | null = null;

export const startDrag = (e: React.DragEvent, dragged: Dragged, label: string) => {
  current = dragged;
  try {
    e.dataTransfer.setData(TYPE, JSON.stringify(dragged));
    e.dataTransfer.setData('text/plain', label);
    e.dataTransfer.effectAllowed = 'move';
  } catch {
    // Some test environments have no data transfer; `current` carries it.
  }
};

export const dragged = (e: React.DragEvent): Dragged | null => {
  try {
    const raw = e.dataTransfer?.getData(TYPE);
    if (raw) return JSON.parse(raw) as Dragged;
  } catch {
    // Fall through to what was picked up.
  }
  return current;
};

export const endDrag = () => {
  current = null;
};

/** Is something of ours being dragged over? (The data itself can't be read until the drop.) */
export const isOurs = (e: React.DragEvent): boolean => !!current || (e.dataTransfer?.types ?? []).includes(TYPE);

/** A card: its words, where they came from, and its marker. */
export const NoteCard = ({
  project,
  note,
  selected,
  onSelect,
  onOpen,
  draggable = true,
  compact,
}: {
  project: Project;
  note: ExtractedNote;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  draggable?: boolean;
  compact?: boolean;
}) => (
  <div
    className={`ns-card${selected ? ' on' : ''}${compact ? ' compact' : ''}${note.setAside ? ' aside' : ''}`}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`Card: ${note.text}`}
    draggable={draggable}
    onDragStart={(e) => startDrag(e, { kind: 'note', noteId: note.id }, note.text)}
    onDragEnd={endDrag}
    onClick={onSelect}
    onDoubleClick={onOpen}
    onKeyDown={(e) => {
      if (e.key === 'Enter') (onOpen ?? onSelect)?.();
    }}
  >
    <span className="ns-card-text">{note.name ? <b>{note.name}: </b> : null}{note.text}</span>
    <span className="ns-card-foot">
      <span className="ns-ref">{refOf(project, note)}</span>
      <NoteMark project={project} note={note} />
    </span>
  </div>
);
