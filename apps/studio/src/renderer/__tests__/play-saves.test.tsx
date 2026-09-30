/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { sunkenVault } from '../model/sample';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lines = () => [...document.querySelectorAll('.play-transcript > *')].map((l) => l.textContent);

describe('saved games in the preview', () => {
  it('saves in a slot, and loading carries on from there; Step back undoes a load', () => {
    const p = sunkenVault();
    render(<PlayView project={p} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(document.querySelector('.play-option:not(:disabled)')!);
    const saved = lines();
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    const panel = screen.getByRole('dialog', { name: 'Saved games' });
    expect(within(panel).getByRole('button', { name: 'Load Slot 1' })).toHaveProperty('disabled', true);
    fireEvent.click(within(panel).getByRole('button', { name: 'Save in Slot 1' }));
    expect(within(panel).getByRole('status').textContent).toBe('Saved in Slot 1.');
    expect(panel.textContent).not.toContain('Empty · ');
    // Play on, then load: back to where it was saved.
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.queryByRole('button', { name: /Continue/ }) ?? document.querySelector('.play-option:not(:disabled)')!);
    expect(lines().length).toBeGreaterThan(saved.length);
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Saved games' })).getByRole('button', { name: 'Load Slot 1' }));
    expect(screen.getByRole('dialog', { name: 'Saved games' }).querySelector('[role="status"]')!.textContent).toMatch(/^Loaded: .+ Step back undoes it\.$/);
    expect(lines()).toEqual(saved);
    // The slot is still there next time (in this browser).
    cleanup();
    render(<PlayView project={p} onNavigate={() => {}} />);
    const fresh = lines();
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    const again = screen.getByRole('dialog', { name: 'Saved games' });
    fireEvent.click(within(again).getByRole('button', { name: 'Load Slot 1' }));
    expect(lines()).toEqual(saved);
    // Step back takes the load back.
    fireEvent.click(within(again).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /Step back/ }));
    expect(lines()).toEqual(fresh);
    expect(fresh).not.toEqual(saved);
    // Delete it.
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Saved games' })).getByRole('button', { name: 'Delete Slot 1' }));
    expect(within(screen.getByRole('dialog', { name: 'Saved games' })).getByRole('button', { name: 'Load Slot 1' })).toHaveProperty('disabled', true);
  });

  it('saves to a file and loads one; a save from another project will not load', async () => {
    const p = sunkenVault();
    render(<PlayView project={p} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    const saved = lines();
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    const panel = screen.getByRole('dialog', { name: 'Saved games' });
    const blobs: Blob[] = [];
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob) => (blobs.push(b), 'blob:save');
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(panel).getByRole('button', { name: 'Save to a file' }));
    click.mockRestore();
    const text = await new Promise<string>((done) => {
      const r = new FileReader();
      r.onload = () => done(String(r.result));
      r.readAsText(blobs[0]!);
    });
    expect(JSON.parse(text).format).toBe('vcgs-play-save');
    URL.createObjectURL = created;
    if (revoked) URL.revokeObjectURL = revoked;
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /Restart/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    const input = within(screen.getByRole('dialog', { name: 'Saved games' })).getByLabelText('Saved game file to load');
    fireEvent.change(input, { target: { files: [new File([text], 'save.json', { type: 'application/json' })] } });
    await waitFor(() => expect(lines()).toEqual(saved));
    const other = JSON.stringify({ ...JSON.parse(text), project: 'someone-else', story: 'Another Story' });
    fireEvent.change(input, { target: { files: [new File([other], 'save.json', { type: 'application/json' })] } });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Saved games' })).getByRole('status').textContent).toBe('That game was saved from another project (Another Story).'));
  });
});
