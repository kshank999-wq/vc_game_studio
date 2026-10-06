import { useState } from 'react';

export type GuidePlace = 'graph' | 'bible' | 'notes' | 'level' | 'puzzles' | 'play' | 'engine';

interface Step {
  title: string;
  body: string[];
  go?: { place: GuidePlace; label: string };
}

/** The tour: one short page per part of the studio, each with a way to open it. */
export const STEPS: readonly Step[] = [
  {
    title: 'Welcome',
    body: [
      'VC Game Studio is where a game’s story, world and logic are written down once and sent to Godot, Unity or Unreal.',
      'This tour takes a minute. Each page opens the part it talks about; come back with Help › Getting started.',
    ],
  },
  {
    title: 'The story graph',
    body: [
      'The spine runs from the Beginning to an Ending. Drag elements from the palette onto it: plot points, scenes, choices, cinematics.',
      'The Player Lane follows what the player does; add subplots and character arcs as lanes of their own. Branches leave the spine from a choice.',
      'Double-click a scene to open it, as a script, a mind map or a timeline.',
    ],
    go: { place: 'graph', label: 'Show the story graph' },
  },
  {
    title: 'The Game Bible',
    body: [
      'Every character, place, item, quest, faction and theme in one catalogue, grouped and searchable. It is the same elements the graph uses, not a copy.',
      'Its reports find what is missing: states nothing sets, items the player can never get, setups never paid off.',
    ],
    go: { place: 'bible', label: 'Open the Bible' },
  },
  {
    title: 'Notes in, game out',
    body: ['Paste or import loose notes (.txt, .md, .docx) into the Note Sorter. Sort them, then turn each into a character, a scene, an item or a rule, placed where it belongs.'],
    go: { place: 'notes', label: 'Open the Note Sorter' },
  },
  {
    title: 'Rules: what the story remembers',
    body: [
      'States hold what has happened: a list of values, a number or text. Conditions read them; effects change them.',
      'Triggers fire when their rule holds, gates hold the story back, and options can be hidden, locked or timed until their conditions hold.',
    ],
  },
  {
    title: 'Levels and puzzles',
    body: [
      'The Level Designer lays out worlds, regions, buildings and rooms in 2D and 3D graybox, with doors, pickups, triggers and patrols, and walks them in Play Mode.',
      'The Puzzle Creator builds puzzles as trees of goals, clues and gates, and screen puzzles (keypads, dials, tiles…) you can try at once.',
    ],
    go: { place: 'level', label: 'Open the Level Designer' },
  },
  {
    title: 'Play it through',
    body: ['The play-through plays the story as the engine would: choices, encounters, free play and rules. Change the world on the side to try another path, save paths you expect, and check them all after a change.'],
    go: { place: 'play', label: 'Start a play-through' },
  },
  {
    title: 'Send it to the engine',
    body: [
      'Engine handoff writes the project for Godot 4, Unity, Unreal or any engine (as JSON): data, a runtime and placeholder scenes.',
      'It shows what each engine gets, reviews changes before sending, and keeps code your team has added between sends.',
      'Projects are files on your computer; the studio keeps backups as you work (Help › Show project backups).',
    ],
    go: { place: 'engine', label: 'Open Engine handoff' },
  },
];

/** Getting started: a short tour, opened on first launch and from the Help menu. */
export const Guide = ({ onGo, onSample, onClose }: { onGo: (place: GuidePlace) => void; onSample?: () => void; onClose: () => void }) => {
  const [at, setAt] = useState(0);
  const step = STEPS[at]!;
  const last = at === STEPS.length - 1;
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog wide guide" role="dialog" aria-modal="true" aria-label="Getting started" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{step.title}</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <ol className="setup-steps guide-dots" aria-label="Pages">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button type="button" className={`setup-step${i === at ? ' on' : ''}${i < at ? ' done' : ''}`} aria-current={i === at ? 'step' : undefined} aria-label={s.title} onClick={() => setAt(i)}>
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
        {step.body.map((p) => (
          <p key={p} className="guide-text">
            {p}
          </p>
        ))}
        <div className="dialog-actions">
          {at === 0 && onSample && (
            <button type="button" className="tb-btn setup-blank" onClick={onSample}>
              Open the sample game
            </button>
          )}
          {step.go && (
            <button
              type="button"
              className="tb-btn setup-blank"
              onClick={() => {
                onGo(step.go!.place);
                onClose();
              }}
            >
              {step.go.label}
            </button>
          )}
          {at > 0 && (
            <button type="button" className="tb-btn" onClick={() => setAt(at - 1)}>
              Back
            </button>
          )}
          <button type="button" className="tb-btn primary" autoFocus onClick={() => (last ? onClose() : setAt(at + 1))}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};
