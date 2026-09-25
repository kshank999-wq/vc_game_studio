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
      { type: 'dialogue', kind: 'SCENE' },
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
  scene: 'A playable scene. Goes on the spine or a subplot.',
  cinematic: 'A non-interactive sequence. Goes on the spine.',
  choice: 'A decision point. Goes on the spine or a subplot.',
  dialogue: 'Lines spoken inside a scene.',
  character: 'A person in a scene, from the Bible.',
  object: 'Something the player can use or change.',
  environment: 'Where a scene takes place.',
  inventory: 'Something the player carries.',
  trigger: 'Makes something happen.',
  gate: 'Holds something back until a condition is met.',
  puzzle: 'A problem the player solves.',
};

interface Props {
  active: ObjectType | null;
  onStart: (type: ObjectType, event: React.PointerEvent) => void;
}

export const Palette = ({ active, onStart }: Props) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <aside className="palette" aria-label="Add — drag a node">
      <div className="palette-head">
        <div className="palette-title">ADD</div>
        <span className="palette-hint">drag onto a lane</span>
      </div>
      {GROUPS.map((group) => (
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
      <p className="palette-foot">Drag a node onto the spine or a lane, or click one and then click where it goes.</p>
    </aside>
  );
};
