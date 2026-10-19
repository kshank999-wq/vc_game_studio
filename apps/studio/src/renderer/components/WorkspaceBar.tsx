/** The big buttons under the menu bar: one for each part of the studio. */
export type Workspace = 'graph' | 'missions' | 'bible' | 'notes' | 'characters' | 'puzzles' | 'level' | 'engine' | 'play';

const PARTS: { id: Workspace; label: string; hint: string }[] = [
  { id: 'graph', label: 'Story Graph', hint: 'The timeline: levels, plot points, scenes, subplots and arcs' },
  { id: 'missions', label: 'Missions', hint: 'A mission card for each level, and what happens when the hero is captured' },
  { id: 'bible', label: 'Game Bible', hint: 'Every character, place, object and rule, in one place' },
  { id: 'notes', label: 'Note Sorter', hint: 'Sort raw notes into the game: lore, characters, mechanics, scenes, levels' },
  { id: 'characters', label: 'Characters', hint: 'The Character Creator: players, enemies, NPCs, allies and extras, with their art, abilities and inventory' },
  { id: 'puzzles', label: 'Puzzles', hint: 'Write puzzles, then build their steps: goals, requirements, clues, interactions' },
  { id: 'level', label: 'Levels', hint: 'Lay out worlds, regions, levels and rooms on the 2D map and in 3D (Ctrl+L)' },
  { id: 'engine', label: 'Engine Handoff', hint: 'Send the game to Godot, Unity or Unreal' },
  { id: 'play', label: 'Play-through', hint: 'Play the story through (F5)' },
];

/**
 * A game module shows only its parts (`only`), in its order; its home takes the
 * graph's place under its own name (`homeLabel`).
 */
export const WorkspaceBar = ({ current, onOpen, only, homeLabel }: { current: Workspace | null; onOpen: (part: Workspace) => void; only?: readonly Workspace[]; homeLabel?: string }) => (
  <nav className="workspace-bar" aria-label="Workspaces">
    {(only ? only.map((id) => PARTS.find((p) => p.id === id)!).filter(Boolean) : PARTS).map((p) => {
      const label = p.id === 'graph' && homeLabel ? homeLabel : p.label;
      return (
        <button key={p.id} className={`ws-btn${current === p.id ? ' on' : ''}`} aria-current={current === p.id ? 'page' : undefined} title={p.id === 'graph' && homeLabel ? `${homeLabel}: every step of the game, from concept to play` : p.hint} onClick={() => onOpen(p.id)}>
          {label}
        </button>
      );
    })}
  </nav>
);
