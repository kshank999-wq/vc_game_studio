import { lazy } from 'react';
import { preloadCollab } from './components/collab/lazy';

/**
 * The views that stand aside from the graph and scenes: the Bible, the shot
 * list, play-through, the levels and the engine handoff. Each loads on first
 * use, so the graph opens without them; the handoff alone carries every
 * engine's runtime source (and the levels' 3D graybox loads three.js only
 * when it is opened). Once the graph is up they are fetched in the background, so opening
 * one is still instant.
 */
const loaders = {
  bible: () => import('./components/bible/GameBible'),
  shots: () => import('./components/cinematic/ShotList'),
  play: () => import('./components/play/PlayView'),
  engine: () => import('./components/engine/EngineHandoff'),
  levels: () => import('./components/level/LevelDesigner'),
  notes: () => import('./components/notes/NoteSorter'),
  puzzles: () => import('./components/puzzle/PuzzleCreator'),
  collab: preloadCollab,
};

export const GameBible = lazy(() => loaders.bible().then((m) => ({ default: m.GameBible })));
export const ShotList = lazy(() => loaders.shots().then((m) => ({ default: m.ShotList })));
export const PlayView = lazy(() => loaders.play().then((m) => ({ default: m.PlayView })));
export const LevelDesigner = lazy(() => loaders.levels().then((m) => ({ default: m.LevelDesigner })));
export const PuzzleCreator = lazy(() => loaders.puzzles().then((m) => ({ default: m.PuzzleCreator })));
export const NoteSorter = lazy(() => loaders.notes().then((m) => ({ default: m.NoteSorter })));
export const EngineHandoff = lazy(() => loaders.engine().then((m) => ({ default: m.EngineHandoff })));

/** The handoff model, for export on save, without putting the engines in the first load. */
export const loadHandoff = () => import('./model/handoff');

/** The sample project (and the level model it uses), for File › New from the sample. */
export const loadSample = () => import('./model/sample');

/** Fetch every aside view when the browser is idle. Failures are left for the view's own load to report. */
export const preloadViews = (): (() => void) => {
  const run = () => {
    for (const load of Object.values(loaders)) load().catch(() => undefined);
    loadHandoff().catch(() => undefined);
    loadSample().catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const timer = setTimeout(run, 800);
  return () => clearTimeout(timer);
};
