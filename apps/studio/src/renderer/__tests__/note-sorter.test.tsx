/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteSorter } from '../components/notes/NoteSorter';
import { notesOf, standing, statusOf } from '../model/notes/sorter';
import { sunkenVault } from '../model/sample';
import type { Project } from '../model/types';

afterEach(cleanup);

/** The sorter with the studio's commit and undo, kept in a test harness. */
const open = (start: Project) => {
  const seen: { project: Project; said: string[] } = { project: start, said: [] };
  const Harness = () => {
    const [history, setHistory] = useState<Project[]>([start]);
    const project = history[history.length - 1]!;
    seen.project = project;
    return (
      <NoteSorter
        project={project}
        onCommit={(p) => setHistory((h) => [...h, p])}
        onUndo={() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))}
        canUndo={history.length > 1}
        onOpenBible={() => {}}
        onSay={(m) => seen.said.push(m)}
      />
    );
  };
  render(<Harness />);
  return seen;
};

const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

describe('the Note Sorter', () => {
  it('imports pasted notes, one passage per line', () => {
    const seen = open(sunkenVault());
    fireEvent.click(screen.getByRole('button', { name: '+ Import notes' }));
    const dialog = screen.getByRole('dialog', { name: 'Import notes' });
    fireEvent.change(within(dialog).getByLabelText('Source name'), { target: { value: 'Call with Sam' } });
    fireEvent.change(within(dialog).getByLabelText('Pasted notes'), { target: { value: 'A boss who floods the arena.\n\nThe ferryman sells maps.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(notesOf(seen.project).sources.map((s) => s.name)).toEqual(['Call with Sam']);
    expect(screen.getByRole('region', { name: 'Raw notes: Call with Sam' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort passage ¶1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort passage ¶2' })).toBeTruthy();
  });

  it('sorts a passage from the grip, converts it and places it on the Spine, all undoable', () => {
    const seen = open(sunkenVault());
    fireEvent.click(screen.getByRole('button', { name: 'Try a sample brainstorm' }));
    const before = standing(seen.project);

    // Sort: the grip opens “Sort into”; pick a category.
    fireEvent.click(screen.getByRole('button', { name: 'Sort passage ¶5' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Sort into' })).getByRole('menuitem', { name: 'Cinematics' }));
    const card = notesOf(seen.project).notes.find((n) => n.text.startsWith('Opening cinematic'))!;
    expect(statusOf(seen.project, card)).toBe('sorted');
    expect(standing(seen.project).unsorted).toBe(before.unsorted - 1);
    expect(within(screen.getByRole('region', { name: 'Category Cinematics' })).getByRole('button', { name: /Card: Opening cinematic/ })).toBeTruthy();

    // Convert: the Cinematics category suggests a cinematic.
    fireEvent.click(within(screen.getByRole('region', { name: 'Category Cinematics' })).getByRole('button', { name: /Card: Opening cinematic/ }));
    expect(screen.getByRole('tab', { name: /Convert/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Suggested: Cinematic')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Cinematic' }));
    const made = Object.values(seen.project.objects).find((o) => o.data.fromNote === card.id)!;
    expect(made.type).toBe('cinematic');
    expect(made.name).toBe('Opening cinematic');
    expect(statusOf(seen.project, notesOf(seen.project).notes.find((n) => n.id === card.id)!)).toBe('converted');

    // Place: pick it up in Build flow, click a gap on the Spine.
    tab(/Build flow/);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Ready to place' })).getByRole('button', { name: 'Opening cinematic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place on the Spine after The Key' }));
    expect(statusOf(seen.project, notesOf(seen.project).notes.find((n) => n.id === card.id)!)).toBe('placed');
    expect(seen.said.at(-1)).toMatch(/Opening cinematic placed/);
    expect(within(screen.getByLabelText('Spine')).getByRole('button', { name: /Cinematic .*Opening cinematic/ })).toBeTruthy();

    // Undo walks it back a step at a time.
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(statusOf(seen.project, notesOf(seen.project).notes.find((n) => n.id === card.id)!)).toBe('converted');
  });

  it('places a card on a Bible shelf, and Review lists it as placed', () => {
    const seen = open(sunkenVault());
    fireEvent.click(screen.getByRole('button', { name: 'Try a sample brainstorm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort passage ¶1' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Sort into' })).getByRole('menuitem', { name: 'Lore' }));
    tab(/Convert/);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'What is it?' })).getByRole('button', { name: /^Lore/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Lore entry' }));
    tab(/Build flow/);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Ready to place' })).getByRole('button', { name: /vault was sealed/i }));
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Other places to drop' })).getByRole('button', { name: /^Lore/ }));
    const note = notesOf(seen.project).notes[0]!;
    expect(statusOf(seen.project, note)).toBe('placed');

    tab(/Review/);
    fireEvent.click(screen.getByRole('button', { name: /Placed in the game/ }));
    const table = screen.getByRole('region', { name: 'Placed in the game' });
    expect(within(table).getByText(/vault was sealed/i)).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Move' })).toBeTruthy();
  });

  it('shows Review’s standing, filters the unsorted list and approves a suggestion', () => {
    const seen = open(sunkenVault());
    fireEvent.click(screen.getByRole('button', { name: 'Try a sample brainstorm' }));
    tab(/Review/);
    const counts = standing(seen.project);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Unsorted\\s*${counts.unsorted}`) }));
    const table = screen.getByRole('region', { name: 'Unsorted' });
    expect(table.querySelectorAll('tbody tr').length).toBe(counts.unsorted);
    const level = notesOf(seen.project).sources.find((s) => s.name === 'Level ideas')!;
    fireEvent.change(within(table).getByLabelText('Source'), { target: { value: level.id } });
    expect(table.querySelectorAll('tbody tr').length).toBe(4);

    // A suggestion changes nothing until it's approved.
    const panel = screen.getByRole('complementary', { name: 'Suggestions' });
    const cats = notesOf(seen.project).categories.length;
    const add = within(panel).getByRole('group', { name: 'New category' });
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
    expect(notesOf(seen.project).categories.length).toBe(cats + 1);
    // Switching suggestions off empties the panel.
    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(within(panel).queryAllByRole('group')).toEqual([]);
  });
});
