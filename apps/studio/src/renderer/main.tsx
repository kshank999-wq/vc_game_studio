import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Crashed } from './components/Crashed';
import { getShared, isPanel, subscribeShared } from './windows';
import './tokens.css';
import './styles.css';

/** A window beside the main one waits for the main window's project before it shows anything. */
const Root = () => {
  const shared = useSyncExternalStore(subscribeShared, getShared, getShared);
  if (isPanel && !shared)
    return (
      <div className="window-waiting" role="status">
        <span>Connecting to the main window…</span>
        <span>Open this window from the studio’s Window menu.</span>
      </div>
    );
  return <App />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crashed>
      <Root />
    </Crashed>
  </StrictMode>,
);
