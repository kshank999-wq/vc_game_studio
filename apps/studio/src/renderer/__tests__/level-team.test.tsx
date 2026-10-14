/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { serialize } from '../files';
import { handOut } from '../model/level/coop';
import { levelsOf, updateItem } from '../model/level/level';
import { withTomb } from '../model/level/sample-structure';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';

const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull(), { timeout: 5000 });

beforeAll(() => {
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetPreferences();
  vi.restoreAllMocks();
});

describe('working on a structure together (structure spec V2)', () => {
  it('claims it, hands out a working copy, and merges one back choosing a conflict', async () => {
    const t = withTomb(sunkenVault());
    // Handed out earlier: the teammate renamed the lever and moved the chest; here the lever was renamed too.
    const out = handOut(t.project, t.id, 'Sam', 'Kim', '2026-10-14T09:00:00.000Z')!;
    let theirs = updateItem(out.copy, t.parts.lever, { name: 'Old lever' });
    theirs = updateItem(theirs, t.parts.chest, { x: levelsOf(theirs).items.find((i) => i.id === t.parts.chest)!.x + 1 });
    const mine = updateItem(out.project, t.parts.lever, { name: 'Rusty lever' });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(mine));
    const urls: string[] = [];
    URL.createObjectURL = vi.fn(() => {
      urls.push('blob:x');
      return 'blob:x';
    }) as never;
    URL.revokeObjectURL = vi.fn() as never;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    // Into the tomb's own map.
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: t.id } });
    expect(screen.getByText('Sam is working on this')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    let dialog = screen.getByRole('dialog', { name: 'Work on it together' });
    expect(within(dialog).getAllByRole('status')[0]!.textContent).toMatch(/^Sam has claimed it, since .*, with a working copy\./);
    // Hand it out again, to Ana: a file is saved, and the claim is hers.
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hand out to' }), { target: { value: 'Ana' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand out a working copy' }));
    expect(urls).toHaveLength(1);
    dialog = screen.getByRole('dialog', { name: 'Work on it together' });
    expect(within(dialog).getAllByRole('status')[0]!.textContent).toMatch(/^Ana has claimed it/);
    // Sam's copy comes back: merged, the older copy is warned about, the lever conflict is chosen.
    const file = new File([serialize(theirs)], 'tomb from Sam.vcgs', { type: 'application/json' });
    fireEvent.change(within(dialog).getByLabelText('Working copy file'), { target: { files: [file] } });
    await waitFor(() => expect(within(dialog).getByRole('status', { name: 'Merge summary' }).textContent).toBe('From Sam: 1 change to take, 1 conflict.'));
    expect(within(dialog).getByText(/handed out again since \(to Ana\)/)).toBeTruthy();
    const pick = within(dialog).getByRole('radiogroup', { name: 'Keep for Old lever' });
    fireEvent.click(within(pick).getByRole('radio', { name: 'Take theirs' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(screen.queryByRole('dialog', { name: 'Work on it together' })).toBeNull();
    await waitFor(() => expect(document.body.textContent).toMatch(/Merged Old Tomb: 2 changes taken\./));
    // Ana's newer claim stays.
    expect(screen.getByText('Ana is working on this')).toBeTruthy();
  });
});
