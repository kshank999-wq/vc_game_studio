import { useRef, useState } from 'react';
import { applyChanges, changesFrom, describeChange, parseChanges, type EngineChange } from '../../model/handoff/changes';
import type { Project } from '../../model/types';

/**
 * Bring back changes from the engine (spec §19 round-trip import): the
 * vcgs-changes.json the engine's exporter wrote, read against the project,
 * as a list to tick. What is ticked comes into the levels as one step.
 */
export const BringBack = ({ project, engineName, exporter, onCommit, onSay }: { project: Project; engineName: string; exporter: string; onCommit: (p: Project) => void; onSay: (message: string) => void }) => {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ changes: EngineChange[]; from: string; emptied: string[] } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const key = (c: EngineChange) => `${c.kind}:${c.id}`;

  const read = async (files: FileList | null) => {
    const file = files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    const parsed = parseChanges(await file.text());
    if (typeof parsed === 'string') {
      onSay(parsed);
      return;
    }
    const changes = changesFrom(project, parsed);
    if (!changes.length) {
      onSay(`Nothing to bring back: ${parsed.engine === 'engine' ? 'the engine' : parsed.engine}’s levels match the studio’s.`);
      return;
    }
    // A level that came back with none of its items at all is more likely a scene the exporter couldn't read than one emptied on purpose: its deletions start unticked.
    const emptied = parsed.levels.filter((l) => !l.items.length && changes.some((c) => c.kind === 'deleted' && c.levelId === l.guid)).map((l) => l.guid);
    setSkip(new Set(changes.filter((c) => c.kind === 'deleted' && emptied.includes(c.levelId)).map(key)));
    setFound({ changes, from: parsed.engine, emptied });
  };

  const take = () => {
    if (!found) return;
    const chosen = found.changes.filter((c) => !skip.has(key(c)));
    if (chosen.length) {
      onCommit(applyChanges(project, chosen));
      onSay(`Brought back ${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'} from ${engineName}.`);
    }
    setFound(null);
  };

  return (
    <>
      <button className="tb-btn handoff-file" onClick={() => input.current?.click()} title={`Read the vcgs-changes.json ${exporter} wrote, and take what was moved, renamed, deleted or added there into the levels`}>
        Bring back changes from {engineName}…
      </button>
      <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Changes file" onChange={(e) => void read(e.target.files)} />
      {found && (
        <div className="dialog-backdrop" onPointerDown={() => setFound(null)}>
          <div className="dialog handoff-review" role="dialog" aria-modal="true" aria-label="Bring back changes" onPointerDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2>Bring back changes from {engineName}</h2>
              <button className="icon-btn small" aria-label="Close" onClick={() => setFound(null)}>
                ×
              </button>
            </div>
            <p className="dialog-text">
              {found.changes.length} {found.changes.length === 1 ? 'thing differs' : 'things differ'} in {engineName}. Untick what to leave as it is in the studio; the rest comes in as one step you can undo. Only where things are, what they’re called and whether they’re there comes back: code and art stay {engineName}’s.
            </p>
            {found.emptied.length > 0 && (
              <p className="handoff-note warn">
                {found.emptied.length === 1 ? 'One level' : `${found.emptied.length} levels`} came back with none of {found.emptied.length === 1 ? 'its' : 'their'} items, so {found.emptied.length === 1 ? 'its' : 'their'} deletions are left unticked: check the exporter could open {found.emptied.length === 1 ? 'that scene' : 'those scenes'} before you take them.
              </p>
            )}
            <ul className="bring-back">
              {found.changes.map((c) => (
                <li key={key(c)}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!skip.has(key(c))}
                      onChange={(e) =>
                        setSkip((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.delete(key(c));
                          else next.add(key(c));
                          return next;
                        })
                      }
                    />
                    <span className={`bring-kind ${c.kind}`}>{c.kind}</span> {describeChange(c)}
                  </label>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button className="tb-btn" onClick={() => setFound(null)}>
                Cancel
              </button>
              <button className="tb-btn primary" disabled={skip.size === found.changes.length} onClick={take}>
                Bring back {found.changes.length - skip.size}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
