import { useState } from 'react';
import type { ObjectType } from '../model/types';
import { TYPE_LABEL } from '../model/semantics';
import { Symbol } from './Symbol';

/** The legend is made of node buttons (HANDOFF iteration 2), grouped Story / Scene elements / Logic. */
const GROUPS: { title: string; items: { type: ObjectType; kind?: string }[] }[] = [
  {
    title: 'Story',
    items: [
      { type: 'plotPoint', kind: 'SPINE' },
      { type: 'scene', kind: 'MAJOR' },
      { type: 'cinematic', kind: 'MAJOR' },
      { type: 'choice', kind: 'BRANCH' },
      { type: 'dialogue', kind: 'BRANCH' },
      { type: 'arcEvent', kind: 'ARC' },
    ],
  },
  {
    title: 'Scene elements',
    items: [{ type: 'character' }, { type: 'object' }, { type: 'environment' }, { type: 'inventory' }],
  },
  { title: 'Logic', items: [{ type: 'trigger' }, { type: 'gate' }, { type: 'puzzle' }] },
];


const TIPS: Partial<Record<ObjectType, string>> = {
  plotPoint: 'A bone of the story. Goes on the spine or a subplot.',
  scene: 'A playable scene. Goes on the spine, a subplot, or above the spine as a branch.',
  cinematic: 'A non-interactive sequence. Goes on the spine.',
  choice: 'A decision point. Goes on the spine, a subplot or above the spine.',
  dialogue: 'An exchange of lines. Floats above the spine as part of a branch.',
  arcEvent: 'A change in a character: growth, setback or turning point. Goes on a character lane.',
  character: 'A person in a scene, from the Bible.',
  object: 'Something the player can use or change.',
  environment: 'Where a scene takes place.',
  inventory: 'Something the player carries.',
  trigger: 'Makes something happen.',
  gate: 'Holds something back until a condition is met.',
  puzzle: 'A problem the player solves.',
  state: 'A fact the game remembers, like a door being open.',
};

/** Inside a scene the palette offers what a scene holds. */
const SCENE_GROUPS: typeof GROUPS = [
  {
    title: 'Scene elements',
    items: [{ type: 'character' }, { type: 'dialogue' }, { type: 'object' }, { type: 'environment' }, { type: 'inventory' }, { type: 'puzzle' }],
  },
  { title: 'Story', items: [{ type: 'choice' }, { type: 'cinematic' }] },
  { title: 'Logic', items: [{ type: 'trigger' }, { type: 'gate' }, { type: 'state' }] },
];

interface Props {
  active: ObjectType | null;
  onStart: (type: ObjectType, event: React.PointerEvent) => void;
  mode: 'graph' | 'scene';
  /** The narrow rail of symbols (spec §26: legend collapsed state). */
  rail: boolean;
  onToggleRail: () => void;
}

export const Palette = ({ active, onStart, mode, rail, onToggleRail }: Props) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groups = mode === 'scene' ? SCENE_GROUPS : GROUPS;
  if (rail) {
    return (
      <aside className="palette rail" aria-label="Add — drag an element">
        <button className="rail-btn" aria-label="Expand the legend" title="Expand the legend" onClick={onToggleRail}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
        {groups.map((group) => (
          <div key={group.title} className="rail-group">
            {group.items.map((item) => (
              <button
                key={item.type}
                className={`rail-btn${active === item.type ? ' active' : ''}`}
                aria-label={TYPE_LABEL[item.type]}
                title={`${TYPE_LABEL[item.type]} — ${TIPS[item.type] ?? ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  onStart(item.type, e);
                }}
              >
                <Symbol type={item.type} size={16} />
              </button>
            ))}
          </div>
        ))}
      </aside>
    );
  }
  return (
    <aside className="palette" aria-label="Add — drag a node">
      <div className="palette-head">
        <div className="palette-title">ADD</div>
        <span className="palette-hint">{mode === 'scene' ? 'drag into the scene' : 'drag onto a lane'}</span>
        <button className="rail-toggle" aria-label="Collapse the legend" title="Collapse the legend" onClick={onToggleRail}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
      </div>
      {groups.map((group) => (
        <section key={group.title}>
          <button
            className="palette-group"
            aria-expanded={!collapsed[group.title]}
            onClick={() => setCollapsed((c) => ({ ...c, [group.title]: !c[group.title] }))}
          >
            {group.title}
            <span className="twisty">{collapsed[group.title] ? '▸' : '▾'}</span>
          </button>
          {!collapsed[group.title] &&
            group.items.map((item) => (
              <button
                key={item.type}
                className={`node-button${active === item.type ? ' active' : ''}`}
                title={TIPS[item.type]}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  onStart(item.type, e);
                }}
              >
                <Symbol type={item.type} />
                {TYPE_LABEL[item.type]}
                {item.kind && <span className="node-button-kind">{item.kind}</span>}
                <span className="port-ring" />
              </button>
            ))}
        </section>
      ))}
      {mode === 'graph' && <p className="palette-foot">
        Drag a node onto the spine or a lane, or above the spine for a branch. Drag from a node's gold ring to connect it.
      </p>}
      {mode === 'scene' && <p className="palette-foot">Drag an element anywhere into the scene. It files itself under its category.</p>}
    </aside>
  );
};
