import { useRef, useState } from 'react';
import { sceneHeading } from '../../model/scene';
import { beatsOf, beatSummary, moveBeat, type Beat } from '../../model/script-export';
import type { Project } from '../../model/types';

const KIND_LABEL: Record<Beat['kind'], string> = { action: 'Action', dialogue: 'Dialogue', transition: 'Transition' };

/**
 * The scene's beats, one card each — a line of action, a speech, a
 * transition — in the order the scene runs. Drag a card (or use its arrows,
 * or Alt+↑/↓) to put the dialogue in the right order; the script, the
 * timeline and the recording script follow.
 */
export const BeatBoard = ({ project, sceneId, onCommit, onOpen }: { project: Project; sceneId: string; onCommit: (p: Project) => void; onOpen: (lineId: string) => void }) => {
  const beats = beatsOf(project, sceneId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const move = (id: string, to: number) => {
    onCommit(moveBeat(project, sceneId, id, to));
    // Keep the moved card in hand for the next key.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-beat="${id}"]`)?.focus());
  };
  const heading = sceneHeading(project, sceneId) || project.objects[sceneId]?.name.toUpperCase();
  if (!beats.length)
    return (
      <div className="beat-board empty">
        <p className="muted">Nothing written yet. Write the scene in Script, then come back to put its beats in order.</p>
      </div>
    );
  let say = 0;
  return (
    <div className="beat-board">
      <div className="beat-heading mono">{heading}</div>
      <p className="pref-hint">Drag a beat to where it belongs, or use its arrows (Alt+↑/↓). Double-click to write it in the script.</p>
      <ol
        ref={list}
        className="beat-list"
        aria-label="Beats"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
        }}
      >
        {beats.map((beat, i) => {
          const { cue, text } = beatSummary(project, beat);
          // Numbered as the scene's recording script numbers them: each line with something to say.
          const numbers = beat.kind === 'dialogue' ? beat.lines.filter((l) => l.text.trim()).map(() => ++say) : [];
          return (
            <li
              key={beat.id}
              data-beat={beat.id}
              tabIndex={0}
              draggable
              className={`beat beat-${beat.kind}${dragging === beat.id ? ' dragging' : ''}${over === i && dragging && dragging !== beat.id ? ' drop-before' : ''}${over === beats.length && i === beats.length - 1 && dragging ? ' drop-after' : ''}`}
              aria-label={`Beat ${i + 1}: ${cue}. ${text}`}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', beat.id);
                setDragging(beat.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver(e.clientY > r.top + r.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragging ?? e.dataTransfer.getData('text/plain');
                const from = beats.findIndex((b) => b.id === id);
                if (from >= 0 && over !== null) move(id, over > from ? over - 1 : over);
                setDragging(null);
                setOver(null);
              }}
              onDoubleClick={() => onOpen(beat.id)}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp' && i > 0) (e.preventDefault(), move(beat.id, i - 1));
                else if (e.altKey && e.key === 'ArrowDown' && i < beats.length - 1) (e.preventDefault(), move(beat.id, i + 1));
                else if (e.key === 'Enter') onOpen(beat.id);
              }}
            >
              <span className="beat-grip" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="beat-no mono" title="Its place in the scene">
                {i + 1}
              </span>
              <div className="beat-body">
                <div className="beat-top">
                  <span className={`beat-kind k-${beat.kind}`}>{KIND_LABEL[beat.kind]}</span>
                  {beat.kind === 'dialogue' && <span className="beat-cue mono">{cue}</span>}
                  {numbers.length > 0 && (
                    <span className="beat-take mono" title="Its number in the recording script for this scene">
                      line {numbers.join(', ')}
                    </span>
                  )}
                </div>
                <div className="beat-text">{text || <span className="muted">(empty)</span>}</div>
              </div>
              <span className="beat-moves">
                <button type="button" className="icon-btn small" aria-label={`Move beat ${i + 1} up`} disabled={i === 0} onClick={() => move(beat.id, i - 1)}>
                  ↑
                </button>
                <button type="button" className="icon-btn small" aria-label={`Move beat ${i + 1} down`} disabled={i === beats.length - 1} onClick={() => move(beat.id, i + 1)}>
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
