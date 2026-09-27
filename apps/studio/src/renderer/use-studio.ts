import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { desktop } from './desktop';
import { canWriteBack, rememberRecent, saveProjectFile, type ProjectFile } from './files';
import { commit, redo, startHistory, undo, type History } from './model/history';
import { createProject } from './model/project';
import { canSave, loadProject, saveProject } from './model/storage';
import type { Project } from './model/types';
import { getPreferences, usePreferences } from './preferences';
import { getShared, isPanel, listen, post, setSharedProject, subscribeShared, type Command } from './windows';

type Action =
  | { type: 'commit'; project: Project }
  | { type: 'replace'; project: Project }
  | { type: 'reset'; project: Project }
  | { type: 'undo' }
  | { type: 'redo' };

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
    case 'reset':
      return startHistory(action.project);
    case 'undo':
      return keepHandoff(undo(history), history);
    case 'redo':
      return keepHandoff(redo(history), history);
  }
};

/**
 * saved: in its file. edited: changed since. draft: never saved to a file
 * (kept in this browser only). off: the preview edition, which never saves.
 */
export type SaveState = 'saved' | 'edited' | 'saving' | 'failed' | 'draft' | 'off';

const FILE_KEY = 'vcgs.file.v1';

const lastFile = (): ProjectFile | null => {
  try {
    const f = JSON.parse(globalThis.localStorage?.getItem(FILE_KEY) ?? 'null') as ProjectFile | null;
    return f && typeof f.name === 'string' && typeof f.path === 'string' && desktop() ? { name: f.name, path: f.path } : null;
  } catch {
    return null;
  }
};

const rememberFile = (file: ProjectFile | null) => {
  try {
    if (file?.path) globalThis.localStorage?.setItem(FILE_KEY, JSON.stringify({ name: file.name, path: file.path }));
    else globalThis.localStorage?.removeItem(FILE_KEY);
  } catch {
    // Not remembered; the next session starts without a file.
  }
};

/** How many objects a new project starts with: fewer than this is nothing to lose. */
const BLANK = Object.keys(createProject().objects).length;
export const isBlank = (project: Project): boolean => Object.keys(project.objects).length <= BLANK && project.lines.length === 0;

/** The open project, its undo history, its file, and the local working copy (off in the preview edition). */
const useMainStudio = () => {
  const [history, dispatch] = useReducer(reduce, undefined, () =>
    startHistory((getPreferences().reopenLast && loadProject()) || createProject()),
  );
  const [file, setFile] = useState<ProjectFile | null>(() => (getPreferences().reopenLast ? lastFile() : null));
  /** The project as it is in its file (or as it was when this session began). */
  const [saved, setSaved] = useState<Project>(history.present);
  const [busy, setBusy] = useState<'saving' | 'failed' | null>(null);
  const preferences = usePreferences();
  const first = useRef(true);
  const present = history.present;
  const dirty = present !== saved;

  // The working copy, so nothing is lost if the window closes.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!canSave()) return;
    const timer = setTimeout(() => saveProject(present), 400);
    return () => clearTimeout(timer);
  }, [present]);

  useEffect(() => {
    desktop()?.setDirty?.(canSave() && dirty);
  }, [dirty]);

  // In a browser, warn before leaving with changes that are not in a file.
  useEffect(() => {
    if (!canSave() || !dirty || desktop()) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const writeTo = useCallback(async (project: Project, target: ProjectFile | null, as: boolean): Promise<boolean> => {
    if (!canSave()) return false;
    setBusy('saving');
    try {
      const written = await saveProjectFile(project, target, as);
      if (!written) {
        setBusy(null);
        return false;
      }
      setFile(written);
      rememberFile(written);
      rememberRecent(written);
      setSaved(project);
      setBusy(null);
      return true;
    } catch {
      setBusy('failed');
      return false;
    }
  }, []);

  // Autosave into the open file, a moment after edits settle.
  useEffect(() => {
    if (!preferences.autosave || !dirty || !canWriteBack(file) || !canSave()) return;
    const timer = setTimeout(() => void writeTo(present, file, false), 1500);
    return () => clearTimeout(timer);
  }, [present, dirty, file, preferences.autosave, writeTo]);

  const saveState: SaveState = !canSave() ? 'off' : busy ?? (!file ? 'draft' : dirty ? 'edited' : 'saved');
  const unsaved = canSave() && (file ? dirty : !isBlank(present));

  // Other windows: send them the project whenever it changes, and take their edits.
  const shared = { project: present, canUndo: history.past.length > 0, canRedo: history.future.length > 0, saveState, fileName: file?.name, unsaved };
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  useEffect(() => {
    post({ t: 'state', ...shared });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, shared.canUndo, shared.canRedo, saveState, file, unsaved]);
  useEffect(() => {
    const stop = listen((m) => {
      if (m.t === 'hello') post({ t: 'state', ...sharedRef.current });
      else if (m.t === 'commit') dispatch({ type: 'commit', project: m.project });
      else if (m.t === 'replace') dispatch({ type: 'replace', project: m.project });
      else if (m.t === 'undo') dispatch({ type: 'undo' });
      else if (m.t === 'redo') dispatch({ type: 'redo' });
    });
    const closed = () => post({ t: 'closed' });
    window.addEventListener('pagehide', closed);
    return () => {
      stop();
      window.removeEventListener('pagehide', closed);
    };
  }, []);

  return {
    isPanel: false as boolean,
    /** A panel window asks the main window to run a file command. */
    forward: (_name: Command, _arg?: string) => {},
    project: present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveState,
    file,
    /** Changes not in a file yet (for a draft, anything worth keeping: it lives only in this browser). */
    unsaved,
    commit: useCallback((project: Project) => dispatch({ type: 'commit', project }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    /** Change the project without an undo step (the engine handoff's settings and record). */
    replace: useCallback((project: Project) => dispatch({ type: 'replace', project }), []),
    /** Start over on another project: a new one, or one just opened from a file. */
    load: useCallback((project: Project, from: ProjectFile | null) => {
      dispatch({ type: 'reset', project });
      setSaved(project);
      setFile(from);
      rememberFile(from);
      if (from) rememberRecent(from);
      setBusy(null);
    }, []),
    save: useCallback(() => writeTo(present, file, false), [present, file, writeTo]),
    saveAs: useCallback(() => writeTo(present, file, true), [present, file, writeTo]),
  };
};

/**
 * A window beside the main one: it shows the main window's project and sends
 * every edit, undo and file command there (see windows.ts).
 */
const usePanelStudio = (): ReturnType<typeof useMainStudio> => {
  const shared = useSyncExternalStore(subscribeShared, getShared, getShared)!;
  const noFile = useCallback(async () => false, []);
  return {
    isPanel: true,
    forward: (name: Command, arg?: string) => post({ t: 'command', name, arg }),
    project: shared.project,
    canUndo: shared.canUndo,
    canRedo: shared.canRedo,
    saveState: shared.saveState as SaveState,
    file: shared.fileName ? { name: shared.fileName } : null,
    unsaved: shared.unsaved,
    commit: useCallback((project: Project) => {
      setSharedProject(project);
      post({ t: 'commit', project });
    }, []),
    undo: useCallback(() => post({ t: 'undo' }), []),
    redo: useCallback(() => post({ t: 'redo' }), []),
    replace: useCallback((project: Project) => {
      setSharedProject(project);
      post({ t: 'replace', project });
    }, []),
    load: useCallback(() => {}, []),
    save: noFile,
    saveAs: noFile,
  };
};

/** The main window owns the project; any other window works on its copy. */
export const useStudio = isPanel ? usePanelStudio : useMainStudio;
