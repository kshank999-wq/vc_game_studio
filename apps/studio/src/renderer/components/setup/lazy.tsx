import { lazy, Suspense, type ComponentProps } from 'react';
import type { SetupWizard as Wizard } from './SetupWizard';

/** The Game Setup Wizard loads when it is opened, so the graph opens without it. */
const WizardView = lazy(() => import('./SetupWizard').then((m) => ({ default: m.SetupWizard })));

export const SetupWizard = (props: ComponentProps<typeof Wizard>) => (
  <Suspense fallback={null}>
    <WizardView {...props} />
  </Suspense>
);
