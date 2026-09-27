import type { ReactNode } from 'react';
import { desktop } from '../../desktop';
import { isPreview, PURCHASE_URL } from '../../edition';
import { DEFAULT_PREFERENCES, resetPreferences, setPreferences, usePreferences, type Preferences } from '../../preferences';
import { shortcutLabel } from './MenuBar';

const Modal = ({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => (
  <div className="dialog-backdrop" onPointerDown={onClose}>
    <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-btn small" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Toggle = ({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) => (
  <label className="pref-row">
    <span className="pref-text">
      <span>{label}</span>
      {hint && <span className="pref-hint">{hint}</span>}
    </span>
    <input type="checkbox" className="pref-switch" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
  </label>
);

const Choice = <K extends keyof Preferences>({ label, hint, value, options, onChange }: {
  label: string;
  hint?: string;
  value: Preferences[K];
  options: { value: Preferences[K]; label: string }[];
  onChange: (value: Preferences[K]) => void;
}) => (
  <label className="pref-row">
    <span className="pref-text">
      <span>{label}</span>
      {hint && <span className="pref-hint">{hint}</span>}
    </span>
    <select className="inp pref-select" value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.currentTarget.value)!.value)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

/** Preferences for this computer: saving, the canvas, the script, and the interface size. */
export const PreferencesDialog = ({ onClose }: { onClose: () => void }) => {
  const p = usePreferences();
  const set = (patch: Partial<Preferences>) => setPreferences(patch);
  return (
    <Modal title="Preferences" onClose={onClose}>
      <div className="prefs">
        <h3>Saving</h3>
        <Toggle
          label="Save to the project file as I work"
          hint={isPreview() ? 'The preview edition does not save.' : 'A moment after each change, once the project has a file.'}
          on={p.autosave}
          onChange={(autosave) => set({ autosave })}
        />
        <Toggle label="Reopen the last project on start" hint="Off starts each session on a new, blank project." on={p.reopenLast} onChange={(reopenLast) => set({ reopenLast })} />

        <h3>Canvas</h3>
        <Choice<'wheel'>
          label="Mouse wheel"
          hint="A trackpad always pans with two fingers and zooms with a pinch."
          value={p.wheel}
          options={[
            { value: 'zoom', label: 'Zooms' },
            { value: 'pan', label: 'Scrolls (Ctrl + wheel zooms)' },
          ]}
          onChange={(wheel) => set({ wheel })}
        />
        <Toggle label="Show the minimap" on={p.showMinimap} onChange={(showMinimap) => set({ showMinimap })} />
        <Toggle label="Show the dot grid" on={p.showGrid} onChange={(showGrid) => set({ showGrid })} />
        <Toggle label="Preview a scene when the pointer rests on it" on={p.scenePreviews} onChange={(scenePreviews) => set({ scenePreviews })} />

        <h3>Script</h3>
        <Choice<'scriptSize'>
          label="Script text size"
          value={p.scriptSize}
          options={[12, 13, 14, 16, 18].map((n) => ({ value: n, label: `${n} px${n === DEFAULT_PREFERENCES.scriptSize ? ' (default)' : ''}` }))}
          onChange={(scriptSize) => set({ scriptSize })}
        />
        <Choice<'defaultVo'>
          label="New dialogue lines start as"
          value={p.defaultVo}
          options={[
            { value: 'todo', label: 'VO to record' },
            { value: 'none', label: 'No VO' },
            { value: 'recorded', label: 'VO recorded' },
          ]}
          onChange={(defaultVo) => set({ defaultVo })}
        />

        <h3>Interface</h3>
        {desktop()?.setZoom ? (
          <Choice<'uiScale'>
            label="Interface size"
            value={p.uiScale}
            options={[80, 90, 100, 110, 125, 150].map((n) => ({ value: n, label: `${n}%` }))}
            onChange={(uiScale) => set({ uiScale })}
          />
        ) : (
          <div className="pref-row">
            <span className="pref-text">
              <span>Interface size</span>
              <span className="pref-hint">In a browser, use the browser’s own zoom.</span>
            </span>
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button className="tb-btn" onClick={resetPreferences}>
          Restore defaults
        </button>
        <div className="grow" />
        <button className="tb-btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
};

export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'Files',
    keys: [
      ['Mod+N', 'New project'],
      ['Mod+O', 'Open…'],
      ['Mod+S', 'Save'],
      ['Mod+Shift+S', 'Save As…'],
      ['Mod+,', 'Preferences'],
    ],
  },
  {
    group: 'Editing',
    keys: [
      ['Mod+Z', 'Undo'],
      ['Mod+Shift+Z', 'Redo (also Ctrl+Y)'],
      ['F2 or Enter', 'Rename the selection'],
      ['Delete', 'Delete the selection'],
      ['Esc', 'Deselect, or cancel placing'],
    ],
  },
  {
    group: 'Story graph and mind map',
    keys: [
      ['Wheel', 'Zoom around the pointer (or scroll, in Preferences)'],
      ['Drag empty space, or middle-drag', 'Pan'],
      ['Shift + wheel', 'Pan sideways'],
      ['+ / −', 'Zoom in / out'],
      ['Mod+0', 'Zoom to fit'],
      ['Double-click', 'Rename a node, or open a scene'],
    ],
  },
  {
    group: 'Script',
    keys: [
      ['Enter', 'Next line (the other side of the exchange)'],
      ['Shift+Enter', 'New paragraph in the same line'],
      ['Tab', 'On an empty line: dialogue ↔ action'],
    ],
  },
  {
    group: 'Levels',
    keys: [
      ['2', '2D map'],
      ['3', '3D graybox'],
      ['V', 'Select and move'],
      ['D', 'Draw a space'],
      ['R', 'Rotate 90° (Shift+R: back)'],
      ['Mod+D', 'Duplicate'],
      ['Mod+G', 'Group (Mod+Shift+G: ungroup)'],
      ['F', 'Frame the selection'],
      ['Arrows', 'Nudge by the grid (Shift: four steps)'],
      ['F5', 'Play the level (Shift+F5: from the selection)'],
    ],
  },
  {
    group: 'Level Play Mode',
    keys: [
      ['W A S D', 'Move (arrows too; the mouse or Q and ← → turn)'],
      ['Space', 'Jump (Shift: run)'],
      ['E', 'Use what is in reach (also F); skip a cinematic'],
      ['Tab', 'Pause and inspect (also P and Esc)'],
      ['V', 'First person, third person, top-down'],
      ['F3', 'Debug overlay: names, volumes, the event log'],
      ['N', 'Note an issue'],
    ],
  },
  {
    group: 'Views',
    keys: [
      ['Mod+B', 'Game Bible'],
      ['Mod+L', 'Levels'],
      ['Mod+E', 'Engine handoff'],
      ['F5', 'Play-through (Shift+F5: from the selected scene)'],
      ['Mod+K', 'Search the project (also Mod+F)'],
      ['Shift+2', 'Zoom to the selection'],
      ['?', 'This list'],
    ],
  },
];

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => (
  <Modal title="Keyboard shortcuts" onClose={onClose} wide>
    <div className="shortcuts">
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <dl>
            {g.keys.map(([keys, what]) => (
              <div key={keys} className="shortcut-row">
                <dt>
                  <kbd>{shortcutLabel(keys)}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  </Modal>
);

export const AboutDialog = ({ onClose }: { onClose: () => void }) => (
  <Modal title="About VC Game Studio" onClose={onClose}>
    <div className="about">
      <div className="about-brand">VC GAME STUDIO</div>
      <p>
        Version {__APP_VERSION__} · {isPreview() ? 'Preview edition (no saving)' : 'Full edition'} · {desktop() ? 'Desktop' : 'Browser'}
      </p>
      <p>Plan a game’s story on one spine, write its scenes, and hand it to the engine.</p>
      <p>
        <a href={PURCHASE_URL} target="_blank" rel="noreferrer">
          {isPreview() ? 'Buy or subscribe to keep your work' : 'vc-writer.com'}
        </a>
      </p>
    </div>
    <div className="dialog-actions">
      <div className="grow" />
      <button className="tb-btn primary" onClick={onClose}>
        Close
      </button>
    </div>
  </Modal>
);

/** Saving belongs to the full edition. */
export const PreviewSaveDialog = ({ onClose }: { onClose: () => void }) => (
  <Modal title="Saving is in the full edition" onClose={onClose}>
    <p className="dialog-text">The preview has everything else: build the story, write the scenes, try the engine handoff. To keep your work in project files, get VC Game Studio.</p>
    <div className="dialog-actions">
      <button className="tb-btn" onClick={onClose}>
        Keep exploring
      </button>
      <div className="grow" />
      <a className="tb-btn primary" href={PURCHASE_URL} target="_blank" rel="noreferrer" onClick={onClose}>
        Buy or subscribe
      </a>
    </div>
  </Modal>
);
