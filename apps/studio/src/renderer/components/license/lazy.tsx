import { lazy, Suspense } from 'react';

/** The license panel loads when it is opened, and only the desktop build has it. */
const Panel = __LICENSING__ ? lazy(() => import('./LicensePanel')) : null;

export const LicenseDialog = ({ onClose }: { onClose: () => void }) =>
  Panel ? (
    <Suspense fallback={null}>
      <Panel onClose={onClose} />
    </Suspense>
  ) : null;
