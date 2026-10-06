import { lazy, Suspense, type ComponentProps } from 'react';
import type { KindsDialog as View } from './KindsDialog';

/** Your own kinds of element load when the dialog is opened. */
const Dialog = lazy(() => import('./KindsDialog').then((m) => ({ default: m.KindsDialog })));

export const KindsDialog = (props: ComponentProps<typeof View>) => (
  <Suspense fallback={null}>
    <Dialog {...props} />
  </Suspense>
);
