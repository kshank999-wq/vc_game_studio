import { renameObject } from '../../model/project';
import { TYPE_LABEL } from '../../model/semantics';
import { speakers, updateLine } from '../../model/scene';
import {
  addBranch,
  addEvent,
  eventKindFor,
  eventLine,
  eventTitle,
  rejoinTargets,
  removeBranch,
  removeEvent,
  sceneTimeline,
  updateBranch,
  updateEvent,
} from '../../model/timeline';
import type { Project, TimelineEvent } from '../../model/types';
import { Symbol } from '../Symbol';
import { KIND_SYMBOL } from './parts';

interface Props {
  project: Project;
  sceneId: string;
  event: TimelineEvent | undefined;
  /** An element picked in the panel that isn't on the timeline yet. */
  element: string | null;
  numbers: Map<string, number>;
  onCommit: (project: Project) => void;
  onSelect: (id: string | null) => void;
  onSay: (message: string) => void;
}

const KIND_NAME = {
  cinematic: 'Cinematic',
  dialogue: 'Dialogue',
  action: 'Action',
  interaction: 'Interaction',
  trigger: 'Trigger',
  choice: 'Choice',
  freePlay: 'Free play',
} as const;

/** A labelled field that saves when it loses focus. Keyed on its value so undo shows through. */
const Field = ({ label, value, onSave, placeholder, script, multiline, type = 'text' }: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  script?: boolean;
  multiline?: boolean;
  type?: 'text' | 'number';
}) => (
  <label className="fld">
    <span>{label}</span>
    {multiline ? (
      <textarea
        key={value}
        className={`inp${script ? ' script-font' : ''}`}
        defaultValue={value}
        placeholder={placeholder}
        rows={2}
        onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
      />
    ) : (
      <input
        key={value}
        className={`inp${script ? ' script-font' : ''}`}
        type={type}
        min={type === 'number' ? 0 : undefined}
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    )}
  </label>
);

/** The inspector under the timeline: everything about the selected event, edited in place. */
export const TimelineInspector = ({ project, sceneId, event, element, numbers, onCommit, onSelect, onSay }: Props) => {
  if (!event) {
    const object = element ? project.objects[element] : undefined;
    const kind = object ? eventKindFor(object.type) : null;
    return (
      <section className="inspector" aria-label="Selected event">
        {object ? (
          <>
            <div className="insp-head">
              <Symbol type={object.type} size={16} />
              <span className="insp-title">{object.name}</span>
              <span className="mono insp-id">{object.data.code}</span>
            </div>
            <p className="insp-empty">
              {kind ? `${object.name} isn’t on the timeline yet.` : `${TYPE_LABEL[object.type]}s aren’t events; they take part in them.`}
            </p>
            {kind && (
              <button
                className="tb-btn"
                onClick={() => {
                  const added = addEvent(project, sceneId, kind, { refId: object.id });
                  if (added) {
                    onCommit(added.project);
                    onSelect(added.id);
                  }
                }}
              >
                + Add to the timeline as {KIND_NAME[kind].toLowerCase()}
              </button>
            )}
          </>
        ) : (
          <p className="insp-empty">Select an event on the timeline, or an element in the scene, to see and edit it here.</p>
        )}
      </section>
    );
  }

  const tracks = sceneTimeline(project, sceneId);
  const track = tracks.find((t) => t.id === event.track);
  const position = (track?.events.findIndex((e) => e.id === event.id) ?? 0) + 1;
  const where = track?.branch ? `branch “${track.branch.label}”` : 'main track';
  const save = (patch: Parameters<typeof updateEvent>[3]) => onCommit(updateEvent(project, sceneId, event.id, patch));
  const line = eventLine(project, event);
  const object = event.refId && event.kind !== 'dialogue' ? project.objects[event.refId] : undefined;
  const title = event.kind === 'dialogue' ? `Dialogue #${numbers.get(event.id) ?? ''}` : eventTitle(project, event);

  return (
    <section className="inspector" aria-label="Selected event">
      <div className="insp-head">
        <Symbol type={object?.type ?? KIND_SYMBOL[event.kind]} size={16} />
        <span className="insp-title">{title}</span>
        <span className="mono insp-id">{object?.data.code ?? KIND_NAME[event.kind]}</span>
        <button
          className="tb-btn small danger-btn insp-remove"
          onClick={() => {
            onCommit(removeEvent(project, sceneId, event.id));
            onSelect(null);
            if (event.kind === 'dialogue') onSay('Line deleted from the script. Ctrl+Z brings it back.');
          }}
        >
          {event.kind === 'dialogue' ? 'Delete line' : 'Remove from timeline'}
        </button>
      </div>

      <div className="insp-grid">
        {event.kind === 'dialogue' && line && (
          <label className="fld">
            <span>Speaker</span>
            <select
              className="inp"
              value={line.speakerId ?? ''}
              onChange={(e) => onCommit(updateLine(project, line.id, { speakerId: e.currentTarget.value || null }))}
            >
              <option value="">No speaker</option>
              {speakers(project, sceneId).map(({ character, present }) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                  {present ? '' : ' (not in scene)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {object && (
          <Field label={TYPE_LABEL[object.type]} value={object.name} onSave={(v) => onCommit(renameObject(project, object.id, v))} />
        )}
        {!object && event.kind !== 'dialogue' && (
          <Field label="Label" value={event.label} onSave={(v) => save({ label: v })} />
        )}
        <div className="fld">
          <span>Order</span>
          <span className="inp static">
            {position} of {track?.events.length ?? 0} · {where}
          </span>
        </div>
      </div>

      {event.kind === 'dialogue' && line && (
        <>
          <Field label="Line" value={line.text} script multiline onSave={(v) => onCommit(updateLine(project, line.id, { text: v }))} />
          <div className="insp-grid">
            <Field label="Direction" value={line.direction} placeholder="(wading forward)" script onSave={(v) => onCommit(updateLine(project, line.id, { direction: v.replace(/^\(|\)$/g, '').trim() }))} />
            <Field label="Condition" value={event.condition ?? ''} placeholder="Always · linear" onSave={(v) => save({ condition: v.trim() || undefined })} />
          </div>
          <div className="fld">
            <span>VO / audio</span>
            <div className="chips" role="radiogroup" aria-label="Voice-over">
              {(
                [
                  ['todo', 'To record'],
                  ['recorded', 'Recorded'],
                  ['none', 'No VO'],
                ] as const
              ).map(([vo, label]) => (
                <button
                  key={vo}
                  role="radio"
                  aria-checked={line.vo === vo}
                  className={`vo-chip${line.vo === vo ? ` on vo-${vo}` : ''}`}
                  onClick={() => onCommit(updateLine(project, line.id, { vo }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Notes" value={line.notes} multiline placeholder="Delivery, context for the actor…" onSave={(v) => onCommit(updateLine(project, line.id, { notes: v }))} />
        </>
      )}

      {event.kind === 'cinematic' && (
        <div className="insp-grid">
          <Field label="Running time (seconds)" type="number" value={String(event.seconds ?? 6)} onSave={(v) => save({ seconds: Math.max(0, Number(v) || 0) })} />
          <Field label="Shots" type="number" value={String(event.shots ?? 1)} onSave={(v) => save({ shots: Math.max(1, Math.round(Number(v) || 1)) })} />
        </div>
      )}

      {event.kind === 'freePlay' && (
        <Field label="Ends when" value={event.endsWhen ?? ''} placeholder="lever = up" onSave={(v) => save({ endsWhen: v.trim() })} />
      )}

      {(event.kind === 'action' || event.kind === 'interaction' || event.kind === 'trigger' || event.kind === 'cinematic') && (
        <div className="insp-grid">
          {event.kind !== 'cinematic' && <Field label="What happens" value={event.detail} placeholder="scripted" onSave={(v) => save({ detail: v })} />}
          <Field label="Condition" value={event.condition ?? ''} placeholder="Always" onSave={(v) => save({ condition: v.trim() || undefined })} />
        </div>
      )}

      {event.kind === 'choice' && (
        <div className="branches">
          <Field label="Option that carries on along the main track" value={event.mainLabel ?? ''} placeholder="Turn the key" onSave={(v) => save({ mainLabel: v })} />
          <div className="fld">
            <span>Other options · each its own branch</span>
            {tracks
              .filter((t) => t.branch?.choiceEventId === event.id)
              .map((t) => (
                <div key={t.id} className="branch-row">
                  <input
                    key={t.branch!.label}
                    className="inp"
                    aria-label="Option"
                    defaultValue={t.branch!.label}
                    onBlur={(e) => onCommit(updateBranch(project, t.id, { label: e.currentTarget.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <select
                    className="inp"
                    aria-label="Where it goes"
                    value={t.branch!.rejoinEventId ?? ''}
                    onChange={(e) => onCommit(updateBranch(project, t.id, { rejoinEventId: e.currentTarget.value || null }))}
                  >
                    <option value="">Leaves the scene</option>
                    {rejoinTargets(project, sceneId, event.id).map((target) => (
                      <option key={target.id} value={target.id}>
                        Reconnects to {eventTitle(project, target)}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn small" aria-label={`Remove option ${t.branch!.label}`} title="Remove this option (its events move to the main track)" onClick={() => onCommit(removeBranch(project, sceneId, t.id))}>
                    ×
                  </button>
                </div>
              ))}
            <button
              className="tb-btn small"
              onClick={() => {
                const added = addBranch(project, sceneId, event.id);
                if (added) onCommit(added.project);
              }}
            >
              + Add an option
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
