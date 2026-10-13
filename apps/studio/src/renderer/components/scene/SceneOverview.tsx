import { PERIMETER, elementsIn, sceneLines, setSceneData } from '../../model/scene';
import type { Project } from '../../model/types';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  onTab: (tab: 'Map' | 'Dialogue') => void;
  onOpenElement: (id: string) => void;
  onOpenScene?: (id: string) => void;
}

/** The maps a map is part of, outermost first, read straight from the project (the Level Designer's code loads only with the map). */
const pathOf = (project: Project, mapId: string): string[] => {
  const maps = project.levels?.levels ?? [];
  const out: string[] = [];
  let at = maps.find((m) => m.id === mapId);
  for (let guard = 0; at && guard < 32; guard++) {
    out.unshift(at.name);
    at = at.parentId ? maps.find((m) => m.id === at!.parentId) : undefined;
  }
  return out;
};

/**
 * What the scene is, at a glance (the scene box's first page): where it
 * happens, what happens, why it is there, who and what is in it, the
 * dialogue, and where it leads. The work itself is on the Map and in the
 * Dialogue; this is the summary that organises it.
 */
export const SceneOverview = ({ project, sceneId, onCommit, onTab, onOpenElement, onOpenScene }: Props) => {
  const scene = project.objects[sceneId]!;
  const mapId = typeof scene.data.mapId === 'string' ? scene.data.mapId : undefined;
  const where = mapId ? pathOf(project, mapId) : [];
  const lines = sceneLines(project, sceneId);
  const speakers = [...new Set(lines.map((l) => l.speakerId).filter((s): s is string => !!s))].map((id) => project.objects[id]?.name).filter(Boolean);
  // Where the scene leads: its own connections, and its choices' options.
  const choices = elementsIn(project, sceneId, 'choices').map((c) => c.id);
  const exits = project.connections
    .filter((c) => (c.sourceId === sceneId || choices.includes(c.sourceId)) && ['spine', 'branch', 'gate'].includes(c.kind) && project.objects[c.targetId] && c.targetId !== sceneId)
    .map((c) => ({ id: c.id, to: c.targetId, label: c.label, via: c.sourceId === sceneId ? undefined : project.objects[c.sourceId]?.name }));
  const field = (key: 'summary' | 'purpose', label: string, placeholder: string) => (
    <label className="ov-field">
      <span>{label}</span>
      <textarea
        key={`${key}:${sceneId}`}
        aria-label={label}
        placeholder={placeholder}
        defaultValue={(scene.data[key] as string | undefined) ?? ''}
        onBlur={(e) => onCommit(setSceneData(project, sceneId, { [key]: e.currentTarget.value.trim() }))}
      />
    </label>
  );

  return (
    <div className="scene-overview">
      <section className={`ov-where${mapId ? '' : ' missing'}`} aria-label="Where it happens">
        <span className="ov-label">WHERE</span>
        {where.length ? (
          <span className="ov-path">{where.join(' › ')}</span>
        ) : (
          <span className="ov-path muted">Not set anywhere yet: every scene happens in an area of the world.</span>
        )}
        <button className={`tb-btn small${mapId ? '' : ' primary'}`} onClick={() => onTab('Map')}>
          {mapId ? 'Open the map' : 'Set where it happens'}
        </button>
      </section>

      {field('summary', 'What happens', 'What happens in this scene, in a sentence or two. It shows on the story graph.')}
      {field('purpose', 'Why it is in the game', 'What it changes for the player or the story.')}

      <section className="ov-section" aria-label="What is in it">
        <span className="ov-label">IN THIS SCENE</span>
        <div className="ov-cats">
          {PERIMETER.map((c) => {
            const items = elementsIn(project, sceneId, c.key);
            if (!items.length) return null;
            return (
              <div key={c.key} className="ov-cat" style={{ '--cat': c.color } as React.CSSProperties}>
                <span className="ov-cat-head">
                  <Symbol type={c.symbol} size={12} />
                  {c.label}
                </span>
                {items.map((o) => (
                  <button key={o.id} className="ov-item" onClick={() => onOpenElement(o.id)}>
                    {o.name}
                  </button>
                ))}
              </div>
            );
          })}
          {PERIMETER.every((c) => !elementsIn(project, sceneId, c.key).length) && <span className="muted">Nothing yet: add characters, objects, choices and puzzles in the panel on the right.</span>}
        </div>
      </section>

      <section className="ov-section" aria-label="Dialogue">
        <span className="ov-label">DIALOGUE</span>
        <span>
          {lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}${speakers.length ? ` · ${speakers.join(', ')}` : ''}` : 'No lines yet.'}
        </span>
        <button className="tb-btn small" onClick={() => onTab('Dialogue')}>
          {lines.length ? 'Open the dialogue' : 'Write dialogue'}
        </button>
      </section>

      <section className="ov-section" aria-label="Where it leads">
        <span className="ov-label">LEADS TO</span>
        {exits.length ? (
          <div className="ov-exits">
            {exits.map((x) => (
              <button key={x.id} className="ov-item" disabled={!onOpenScene || project.objects[x.to]?.type !== 'scene'} onClick={() => onOpenScene?.(x.to)}>
                {x.via ? `${x.via}: ` : ''}
                {x.label ? `“${x.label}” → ` : '→ '}
                {project.objects[x.to]!.name}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted">Nowhere yet: connect it, or its choices, to the scenes they lead to on the story graph.</span>
        )}
      </section>
    </div>
  );
};
