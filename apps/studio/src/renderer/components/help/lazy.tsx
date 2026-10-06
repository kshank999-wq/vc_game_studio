import { lazy, Suspense, type ComponentProps } from 'react';
import type { Guide as GuideView } from './Guide';

/** Getting started loads when it is opened, so the graph opens without it. */
const View = lazy(() => import('./Guide').then((m) => ({ default: m.Guide })));

export const Guide = (props: ComponentProps<typeof GuideView>) => (
  <Suspense fallback={null}>
    <View {...props} />
  </Suspense>
);

const SEEN = 'vcgs:guide-seen';

/** Whether this viewer has seen the tour (browser storage may be unavailable: then it counts as seen). */
export const guideSeen = (): boolean => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true;
  }
};

export const markGuideSeen = () => {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* nothing to remember it in */
  }
};
