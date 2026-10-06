import { useState } from 'react';
import {
  blankSetup,
  COMMON_RESOURCES,
  containerName,
  defaultsFor,
  ENDINGS,
  GAME_KINDS,
  PROGRESSIONS,
  type GameKind,
  type GameSetup,
} from '../../model/setup';

const STEPS = ['The game', 'Premise and player', 'World and tone', 'Structure'] as const;

/**
 * The Game Setup Wizard (Writer spec §3), four short steps: what kind of game
 * and its name; premise, player fantasy and who the player is; world, tone,
 * themes and endings; how it divides and what it keeps track of. Everything
 * but the kind can be left blank. Opened from File › New for a new project,
 * and from Project › Game setup to change the answers later.
 */
export const SetupWizard = ({
  initial,
  initialName = '',
  editing = false,
  onDone,
  onBlank,
  onClose,
}: {
  initial?: GameSetup;
  initialName?: string;
  /** Changing an open project's answers: no name, no blank option, and Save instead of Create. */
  editing?: boolean;
  onDone: (setup: GameSetup, name: string) => void;
  /** Skip the wizard and start an empty project. */
  onBlank?: () => void;
  onClose: () => void;
}) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [setup, setSetup] = useState<GameSetup>(initial ?? blankSetup());
  const [newResource, setNewResource] = useState('');
  const set = (patch: Partial<GameSetup>) => setSetup((s) => ({ ...s, ...patch }));
  const text = (key: 'premise' | 'playerFantasy' | 'protagonist' | 'world' | 'tone' | 'loop' | 'customKind' | 'customUnit', label: string, placeholder: string, area = false) => (
    <label className="dfld">
      <span>{label}</span>
      {area ? (
        <textarea className="inp" rows={2} aria-label={label} placeholder={placeholder} value={setup[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} />
      ) : (
        <input className="inp" aria-label={label} placeholder={placeholder} value={setup[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </label>
  );
  const chooseKind = (kind: GameKind) => setSetup((s) => (editing ? { ...s, kind } : { ...s, kind, ...defaultsFor(kind) }));
  const toggleResource = (r: string) => set({ resources: setup.resources.includes(r) ? setup.resources.filter((x) => x !== r) : [...setup.resources, r] });
  const last = step === STEPS.length - 1;
  const finish = () => onDone(setup, name);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form
        className="dialog wide setup-wizard"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Game setup' : 'New game'}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (last || editing) finish();
          else setStep(step + 1);
        }}
      >
        <div className="dialog-head">
          <h2>{editing ? 'Game setup' : 'New game'}</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <ol className="setup-steps" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button type="button" className={`setup-step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <>
            {!editing && (
              <label className="dfld">
                <span>Name</span>
                <input className="inp" aria-label="Game name" placeholder="e.g. The Sunken Vault" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <div className="dfld" role="radiogroup" aria-label="Kind of game">
              <span>Kind of game</span>
              <div className="setup-chips">
                {GAME_KINDS.map((k) => (
                  <label key={k.value} className={`setup-chip${setup.kind === k.value ? ' on' : ''}`}>
                    <input type="radio" name="game-kind" checked={setup.kind === k.value} onChange={() => chooseKind(k.value)} />
                    {k.label}
                  </label>
                ))}
              </div>
            </div>
            {setup.kind === 'custom' && text('customKind', 'Your kind of game', 'e.g. Rhythm detective game')}
            {!editing && <p className="pref-hint">Each kind starts you with a usual structure and resources. You can change all of it on the last step, and later.</p>}
          </>
        )}

        {step === 1 && (
          <>
            {text('premise', 'Premise', 'What the game is about, in a sentence or two', true)}
            {text('playerFantasy', 'Player fantasy', 'What playing it lets the player be or do')}
            {text('protagonist', 'The player is', 'Who the player plays: a name, a role')}
            {text('loop', 'Core loop', 'What the player does, over and over: explore, solve, unlock…')}
          </>
        )}

        {step === 2 && (
          <>
            {text('world', 'World', 'Where and when it takes place')}
            {text('tone', 'Tone', 'e.g. Tense, melancholy, wry')}
            <label className="dfld">
              <span>Themes</span>
              <input className="inp" aria-label="Themes" placeholder="Separate with commas: memory, trust, greed" value={(setup.themes ?? []).join(', ')} onChange={(e) => set({ themes: e.target.value.split(',').map((t) => t.trimStart()) })} />
            </label>
            <label className="dfld">
              <span>Endings</span>
              <select className="pref-select" aria-label="Endings" value={setup.endings ?? 'single'} onChange={(e) => set({ endings: e.target.value as GameSetup['endings'] })}>
                {ENDINGS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <div className="setup-row">
              <label className="dfld">
                <span>Divided into</span>
                <select className="pref-select" aria-label="Divided into" value={setup.progression} onChange={(e) => set({ progression: e.target.value as GameSetup['progression'] })}>
                  {PROGRESSIONS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              {!editing && (
                <label className="dfld">
                  <span>How many</span>
                  <input className="inp small" type="number" min={2} max={12} aria-label="How many" value={setup.units} onChange={(e) => set({ units: Number(e.target.value) || 2 })} />
                </label>
              )}
            </div>
            {setup.progression === 'custom' && text('customUnit', 'One of them is called', 'e.g. Day, Heist, Episode')}
            {!editing && (
              <p className="pref-hint">
                The spine starts as Beginning → {containerName(setup, 0)} … {containerName(setup, Math.max(1, Math.min(12, setup.units || 2)) - 1)} → Ending.
              </p>
            )}
            <div className="dfld">
              <span>Recurring resources</span>
              <div className="setup-chips">
                {[...new Set([...COMMON_RESOURCES, ...setup.resources])].map((r) => (
                  <label key={r} className={`setup-chip${setup.resources.includes(r) ? ' on' : ''}`}>
                    <input type="checkbox" checked={setup.resources.includes(r)} onChange={() => toggleResource(r)} />
                    {r}
                  </label>
                ))}
              </div>
              <div className="setup-row">
                <input className="inp small" aria-label="Another resource" placeholder="Another: Sanity, Fuel…" value={newResource} onChange={(e) => setNewResource(e.target.value)} onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (newResource.trim()) set({ resources: [...setup.resources, newResource.trim()] });
                  setNewResource('');
                }} />
              </div>
              {!editing && <span className="pref-hint">Each becomes an entry in the Bible’s inventory, to fill in.</span>}
            </div>
          </>
        )}

        <div className="dialog-actions">
          {onBlank && (
            <button type="button" className="tb-btn setup-blank" onClick={onBlank}>
              Start blank instead
            </button>
          )}
          {step > 0 && !editing && (
            <button type="button" className="tb-btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {!last && !editing && (
            <button type="submit" className="tb-btn primary">
              Next
            </button>
          )}
          {(last || editing) && (
            <button type="button" className="tb-btn primary" onClick={finish}>
              {editing ? 'Save' : 'Create game'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
