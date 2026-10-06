import { useState } from 'react';
import { addCustomType, customTypesOf, removeCustomType, updateCustomType } from '../../model/custom-types';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project } from '../../model/types';

/** The types a kind can be of: the elements writers make, not the spine's ends. */
const BASES: ObjectType[] = ['character', 'object', 'inventory', 'environment', 'puzzle', 'quest', 'skill', 'encounter', 'mechanic', 'lore', 'faction', 'scene', 'cinematic', 'state'];

const count = (project: Project, id: string) => Object.values(project.objects).filter((o) => o.data.customType === id).length;

/**
 * Your own kinds of element (custom node types): a Vehicle that is an
 * Interactive Object, a Spell that is a Skill, each with the fields every one
 * of them has. Give an element its kind under its detail.
 */
export const KindsDialog = ({ project, onCommit, onClose }: { project: Project; onCommit: (p: Project) => void; onClose: () => void }) => {
  const [name, setName] = useState('');
  const [base, setBase] = useState<ObjectType>('object');
  const [fields, setFields] = useState('');
  const kinds = customTypesOf(project);
  const split = (text: string) => text.split(',').map((f) => f.trim()).filter(Boolean);
  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog wide kinds" role="dialog" aria-modal="true" aria-label="Your own kinds of element" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Your own kinds of element</h2>
          <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="pref-hint">A kind is a type of element of your own, like a Vehicle (an Interactive Object) or a Spell (a Skill), with the fields every one of them has. Give an element its kind under its detail; its kind and fields go to the engines with it.</p>
        {kinds.length > 0 && (
          <ul className="kinds-list">
            {kinds.map((k) => (
              <li key={k.id} className="kinds-row">
                <input className="inp small" aria-label="Kind name" defaultValue={k.name} onBlur={(e) => e.currentTarget.value !== k.name && onCommit(updateCustomType(project, k.id, { name: e.currentTarget.value }))} />
                <span className="pref-hint">{TYPE_LABEL[k.base]} · {count(project, k.id)} made</span>
                <input
                  className="inp"
                  aria-label={`${k.name} fields`}
                  placeholder="Fields, with commas: Speed, Seats, Fuel"
                  defaultValue={k.fields.join(', ')}
                  onBlur={(e) => e.currentTarget.value !== k.fields.join(', ') && onCommit(updateCustomType(project, k.id, { fields: split(e.currentTarget.value) }))}
                />
                <button type="button" className="state-x" aria-label={`Remove ${k.name}`} onClick={() => onCommit(removeCustomType(project, k.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="setup-row kinds-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onCommit(addCustomType(project, name, base, split(fields)).project);
            setName('');
            setFields('');
          }}
        >
          <input className="inp small" aria-label="New kind" placeholder="New kind: Vehicle" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="pref-select" aria-label="A kind of" value={base} onChange={(e) => setBase(e.target.value as ObjectType)}>
            {BASES.map((b) => (
              <option key={b} value={b}>
                a kind of {TYPE_LABEL[b]}
              </option>
            ))}
          </select>
          <input className="inp" aria-label="Its fields" placeholder="Its fields: Speed, Seats" value={fields} onChange={(e) => setFields(e.target.value)} />
          <button type="submit" className="tb-btn primary" disabled={!name.trim()}>
            Add
          </button>
        </form>
        <div className="dialog-actions">
          <button type="button" className="tb-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
