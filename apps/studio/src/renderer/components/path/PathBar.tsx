import { useMemo, useState } from 'react';
import { moduleOf, pathOf, tickStep, type PathStep } from '../../model/modules';
import type { Project } from '../../model/types';

/**
 * The path (game modules): the module's steps in order, rough to fine, each
 * ticked when the project shows it done (or by hand), the next one picked
 * out. A step takes the designer where its work is done. Folds to one line.
 */
export const PathBar = ({ project, onGo, onCommit }: { project: Project; onGo: (step: PathStep) => void; onCommit: (p: Project) => void }) => {
  const [open, setOpen] = useState(true);
  const mod = moduleOf(project);
  // A defense game's play step runs the whole game: only again when the project changes.
  const steps = useMemo(() => pathOf(project), [project]);
  const next = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <nav className={`path-bar${open ? '' : ' folded'}`} aria-label={`${mod.name} path`}>
      <button className="path-fold" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Fold the path' : 'Show the path'}>
        <span className="path-kind">{mod.name}</span>
        <span className="path-count">
          {doneCount}/{steps.length}
        </span>
      </button>
      {open ? (
        <>
          <ol className="path-steps">
            {steps.map(({ step, done, manual }, i) => (
              <li key={step.id}>
                <button className={`path-step${done ? ' done' : ''}${next?.step.id === step.id ? ' next' : ''}`} onClick={() => onGo(step)} title={step.hint} aria-label={`Step ${i + 1}: ${step.title}${done ? ' (done)' : ''}`}>
                  <span className="path-num">{done ? '✓' : i + 1}</span>
                  {step.title}
                </button>
                {manual ? (
                  <button className="path-untick" title="Not done after all" aria-label={`Untick ${step.title}`} onClick={() => onCommit(tickStep(project, step.id, false))}>
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {next ? (
            <div className="path-next">
              <span className="path-hint">{next.step.hint}</span>
              {!next.step.done ? (
                <button className="link-btn" onClick={() => onCommit(tickStep(project, next.step.id, true))}>
                  Mark done
                </button>
              ) : null}
            </div>
          ) : (
            <div className="path-next">
              <span className="path-hint">Every step is done. Keep refining, play it again, and hand it off when it changes.</span>
            </div>
          )}
        </>
      ) : (
        <span className="path-hint folded-hint">{next ? `Next: ${next.step.title}` : 'All steps done'}</span>
      )}
    </nav>
  );
};
