import { useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, setPreferences, usePreferences } from '../../preferences';
import { ACTIONS, controlsOf, keyLabel, padLabel, readPad, type Action } from './input';

/**
 * Rebinding Play Mode's controls (spec §9.2): each action's keys and
 * controller buttons, look speed, inverted look and the stick dead zone.
 * Kept on this computer, like the other preferences.
 */
export const PlayControls = () => {
  const prefs = usePreferences();
  const controls = controlsOf(prefs.playControls);
  const [listening, setListening] = useState<{ action: Action; device: 'key' | 'pad' } | null>(null);

  const save = (patch: Partial<typeof prefs.playControls>) => setPreferences({ playControls: { ...prefs.playControls, ...patch } });

  useEffect(() => {
    if (!listening) return;
    if (listening.device === 'key') {
      const down = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') {
          const others = Object.fromEntries(Object.entries(controls.keys).map(([a, codes]) => [a, a === listening.action ? [...new Set([...codes, e.code])] : codes.filter((c) => c !== e.code)]));
          save({ keys: others });
        }
        setListening(null);
      };
      window.addEventListener('keydown', down, true);
      return () => window.removeEventListener('keydown', down, true);
    }
    // A controller button: watch for one to go down, for a few seconds.
    const started = performance.now();
    let raf = 0;
    const poll = () => {
      const pad = readPad(controls);
      const i = pad.buttons.findIndex(Boolean);
      if (i >= 0) {
        const others = Object.fromEntries(Object.entries(controls.pad).map(([a, b]) => [a, a === listening.action ? [...new Set([...b, i])] : b.filter((x) => x !== i)]));
        save({ pad: others });
        setListening(null);
        return;
      }
      if (performance.now() - started > 6000) {
        setListening(null);
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return (
    <div className="play-controls">
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Keys</th>
            <th>Controller</th>
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a.id}>
              <td>{a.label}</td>
              <td>
                {controls.keys[a.id].map((code) => (
                  <button key={code} className="play-bind" title="Remove" aria-label={`Remove ${keyLabel(code)} from ${a.label}`} onClick={() => save({ keys: { ...controls.keys, [a.id]: controls.keys[a.id].filter((c) => c !== code) } })}>
                    {keyLabel(code)} ×
                  </button>
                ))}
                <button className={`play-bind add${listening?.action === a.id && listening.device === 'key' ? ' listening' : ''}`} aria-label={`Add a key for ${a.label}`} onClick={() => setListening({ action: a.id, device: 'key' })}>
                  {listening?.action === a.id && listening.device === 'key' ? 'Press a key…' : '+'}
                </button>
              </td>
              <td>
                {controls.pad[a.id].map((b) => (
                  <button key={b} className="play-bind" title="Remove" aria-label={`Remove ${padLabel(b)} from ${a.label}`} onClick={() => save({ pad: { ...controls.pad, [a.id]: controls.pad[a.id].filter((x) => x !== b) } })}>
                    {padLabel(b)} ×
                  </button>
                ))}
                <button className={`play-bind add${listening?.action === a.id && listening.device === 'pad' ? ' listening' : ''}`} aria-label={`Add a controller button for ${a.label}`} onClick={() => setListening({ action: a.id, device: 'pad' })}>
                  {listening?.action === a.id && listening.device === 'pad' ? 'Press a button…' : '+'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">The mouse and the controller’s right stick look around; the left stick moves.</p>
      <label className="play-row">
        <span>Look speed</span>
        <input type="range" min={0.2} max={3} step={0.1} value={controls.lookSpeed} aria-label="Look speed" onChange={(e) => save({ lookSpeed: Number(e.target.value) })} />
        <span className="mono">{controls.lookSpeed.toFixed(1)}×</span>
      </label>
      <label className="play-row">
        <span>Invert looking up and down</span>
        <input type="checkbox" checked={controls.invertY} aria-label="Invert looking up and down" onChange={(e) => save({ invertY: e.target.checked })} />
      </label>
      <label className="play-row">
        <span>Stick dead zone</span>
        <input type="range" min={0} max={0.5} step={0.02} value={controls.deadzone} aria-label="Stick dead zone" onChange={(e) => save({ deadzone: Number(e.target.value) })} />
        <span className="mono">{Math.round(controls.deadzone * 100)}%</span>
      </label>
      <button className="tb-btn small" onClick={() => setPreferences({ playControls: { ...DEFAULT_PREFERENCES.playControls } })}>
        Restore the defaults
      </button>
    </div>
  );
};
