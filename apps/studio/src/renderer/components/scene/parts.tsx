import { TYPE_LABEL } from '../../model/semantics';
import { CATEGORIES, addElement, categoryFor, inScene, useInScene, type Category } from '../../model/scene';
import type { ObjectType, Project, StoryObject } from '../../model/types';
import { Symbol } from '../Symbol';

/** Why a palette item can't go into a scene, or null when it can. */
export const sceneRefusal = (type: ObjectType): string | null => {
  if (categoryFor(type)) return null;
  if (type === 'scene' || type === 'plotPoint') return `${TYPE_LABEL[type]}s go on the story graph`;
  if (type === 'arcEvent') return 'Arc events go on a character lane';
  return `${TYPE_LABEL[type]} can’t go inside a scene`;
};

export const symbolColor = (object: StoryObject): string | undefined =>
  object.type === 'character' ? (object.data.color as string | undefined) : undefined;

/** An element's name, renamed in place. */
export const NameEdit = ({ value, onDone, className = 'chip-input' }: { value: string; onDone: (value: string | null) => void; className?: string }) => (
  <input
    className={className}
    aria-label="Name"
    defaultValue={value}
    autoFocus
    onFocus={(e) => e.currentTarget.select()}
    onPointerDown={(e) => e.stopPropagation()}
    onBlur={(e) => onDone(e.currentTarget.value)}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') onDone(null);
    }}
  />
);

/**
 * Add to a category: an element the project already has (a character from the
 * Bible, a location used elsewhere), or a new one.
 */
export const AddMenu = ({ project, sceneId, category, onAdd, onClose }: {
  project: Project;
  sceneId: string;
  category: Category;
  /** The project with the element added, and its id; `fresh` when it was created just now. */
  onAdd: (project: Project, id: string, fresh: boolean) => void;
  onClose: () => void;
}) => {
  const existing = Object.values(project.objects)
    .filter((o) => category.types.includes(o.type) && !inScene(project, sceneId, o.id) && !project.placements[o.id])
    .sort((a, b) => a.name.localeCompare(b.name));
  const create = (type: ObjectType) => {
    const added = addElement(project, sceneId, type);
    if (added) onAdd(added.project, added.id, true);
  };
  return (
    <div className="add-menu" role="menu" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {existing.length > 0 && <div className="menu-heading">FROM THE BIBLE</div>}
      {existing.map((o) => (
        <button
          key={o.id}
          role="menuitem"
          // An existing element is linked into the scene, never copied.
          onClick={() => onAdd(useInScene(project, sceneId, o.id), o.id, false)}
        >
          <Symbol type={o.type} size={11} color={symbolColor(o)} />
          {o.name}
          {o.data.code && <span className="menu-note mono">{o.data.code}</span>}
        </button>
      ))}
      {existing.length > 0 && <div className="menu-sep" />}
      {category.types.map((type) => (
        <button key={type} role="menuitem" className="menu-new" onClick={() => create(type)}>
          + New {TYPE_LABEL[type].toLowerCase()}
        </button>
      ))}
    </div>
  );
};

/** The category a palette drag would land in, for lighting its port or perimeter node. */
export const dropCategory = (type: ObjectType | null | undefined): Category | undefined =>
  type ? categoryFor(type) : undefined;

export const categoryByKey = (key: string): Category => CATEGORIES.find((c) => c.key === key)!;
