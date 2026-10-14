import { useState } from 'react';
import { placeInRoom, type RoomPlacement } from '../../model/level/place-in-room';
import type { AssetDefinition } from '../../model/level/types';
import type { Project } from '../../model/types';

/**
 * Put something from the story into this room, in context (structure spec
 * §9): an inventory item (as a pickup), a character (as an NPC, an enemy or a
 * companion, by their roles), or a new item made here and added to the
 * catalog. The room holds a placement; the definition stays in the catalog.
 */
export const PlaceInRoom = ({ project, roomId, global, onCommit, onSelect }: { project: Project; roomId: string; global: readonly AssetDefinition[]; onCommit: (p: Project) => void; onSelect: (ids: string[]) => void }) => {
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const of = (t: 'inventory' | 'character') => Object.values(project.objects).filter((o) => o.type === t).sort((a, b) => a.name.localeCompare(b.name));
  const items = of('inventory');
  const characters = of('character');
  const what = (): RoomPlacement | null => {
    if (pick === 'new') return name.trim() ? { kind: 'newItem', name } : null;
    const o = project.objects[pick];
    if (!o) return null;
    return o.type === 'character' ? { kind: 'character', ref: o.id } : { kind: 'item', ref: o.id };
  };
  const put = () => {
    const w = what();
    if (!w) return;
    const done = placeInRoom(project, roomId, w, global);
    if (!done) return;
    onCommit(done.project);
    onSelect([done.id]);
    setPick('');
    setName('');
  };
  return (
    <div className="lvl-place-room">
      <span className="lvl-flabel">Put in this room</span>
      <div className="lvl-btnrow wrap">
        <select className="inp small" aria-label="What to put in this room" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose…</option>
          <option value="new">A new item…</option>
          {items.length > 0 && (
            <optgroup label="Items">
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
          {characters.length > 0 && (
            <optgroup label="Characters">
              {characters.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {pick === 'new' && <input className="inp small" aria-label="New item’s name" placeholder="e.g. Bronze Key" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && put()} />}
        <button className="tb-btn small" disabled={!what()} onClick={put}>
          Put it here
        </button>
      </div>
    </div>
  );
};
