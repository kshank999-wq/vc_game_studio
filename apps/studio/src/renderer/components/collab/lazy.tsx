import { lazy, Suspense, type ComponentProps } from 'react';
import type { CommentsHistory as History } from './CommentsHistory';
import type { CommentsPanel as Panel } from './CommentsPanel';

/**
 * Comments and history load on first use, so the graph opens without them
 * (the edit history itself is recorded by the model, always loaded).
 */
const loadHistory = () => import('./CommentsHistory');
const loadPanel = () => import('./CommentsPanel');

const HistoryView = lazy(() => loadHistory().then((m) => ({ default: m.CommentsHistory })));
const PanelView = lazy(() => loadPanel().then((m) => ({ default: m.CommentsPanel })));

export const CommentsHistory = (props: ComponentProps<typeof History>) => (
  <Suspense fallback={null}>
    <HistoryView {...props} />
  </Suspense>
);

export const CommentsPanel = (props: ComponentProps<typeof Panel>) => (
  <Suspense fallback={null}>
    <PanelView {...props} />
  </Suspense>
);

export const preloadCollab = () => Promise.all([loadHistory(), loadPanel()]);
