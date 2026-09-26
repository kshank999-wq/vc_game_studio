import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { commit, redo, startHistory, undo, type History } from './model/history';
import { createProject } from './model/project';
import { canSave, loadProject, saveProject } from './model/storage';
import type { Project } from './model/types';

type Action = { type: 'commit'; project: Project } | { type: 'replace'; project: Project } | { type: 'undo' } | { type: 'redo' };

/**
 * The engine handoff's settings and export record are not story edits: undo
 * and redo leave them as they are, and changing them is not an undo step.
 */
const keepHandoff = (next: History, from: History): History =>
  next === from ? next : { ...next, present: { ...next.present, handoff: from.present.handoff } };

const reduce = (history: History, action: Action): History => {
  switch (action.type) {
    case 'commit':
      return commit(history, action.project);
    case 'replace':
      return action.project === history.present ? history : { ...history, present: action.project };
    case 'undo':
      return keepHandoff(undo(history), history);
    case 'redo':
      return keepHandoff(redo(history), history);
  }
};

export type SaveState = 'saved' | 'saving' | 'failed' | 'off';

/** The open project, its undo history, and autosave (off in the preview edition). */
export const useStudio = () => {
  const [history, dispatch] = useReducer(reduce, undefined, () => startHistory(loadProject() ?? createProject()));
  const [saveState, setSaveState] = useState<SaveState>(canSave() ? 'saved' : 'off');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!canSave()) return;
    setSaveState('saving');
    const timer = setTimeout(() => setSaveState(saveProject(history.present) ? 'saved' : 'failed'), 400);
    return () => clearTimeout(timer);
  }, [history.present]);

  return {
    project: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveState,
    commit: useCallback((project: Project) => dispatch({ type: 'commit', project }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    /** Change the project without an undo step (the engine handoff's settings and record). */
    replace: useCallback((project: Project) => dispatch({ type: 'replace', project }), []),
  };
};
