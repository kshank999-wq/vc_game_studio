/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
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
});

describe('the Structure Creator (structure spec MVP 1)', () => {
  it('adds an office to a level: its floors from the car park to the roof, the structure graph and its settings', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Structure', exact: true } as never));
    const dialog = screen.getByRole('dialog', { name: 'New structure' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Modern office/ }));
    expect((within(dialog).getByRole('spinbutton', { name: 'Floors above ground' }) as HTMLInputElement).value).toBe('5');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Structure name' }), { target: { value: 'Harbour Office' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create structure' }));
    expect(screen.queryByRole('dialog', { name: 'New structure' })).toBeNull();
    // On its own map, the ground floor showing; every floor has its code, the top first.
    const floors = within(screen.getByRole('combobox', { name: 'Floor' })).getAllByRole('option').map((o) => o.textContent);
    expect(floors.slice(0, 7).map((f) => f!.split(' · ')[0])).toEqual(['R', '5', '4', '3', '2', 'G', 'B1']);
    expect((screen.getByRole('combobox', { name: 'Floor' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/^G · Ground floor/);
    const graph = screen.getByRole('region', { name: 'Structure graph' });
    expect(within(graph).getByText(/0 rooms/)).toBeTruthy();
    expect(within(graph).getByRole('img', { name: 'Rooms on 7 floors and how they connect' })).toBeTruthy();
    // The inspector says what it is.
    expect((screen.getByRole('combobox', { name: 'Structure type' }) as HTMLSelectElement).value).toBe('office');
    expect((screen.getByRole('combobox', { name: 'Between floors' }) as HTMLSelectElement).value).toBe('accessible');
    fireEvent.click(screen.getByRole('button', { name: '+ Basement' }));
    const after = within(screen.getByRole('combobox', { name: 'Floor' })).getAllByRole('option').map((o) => o.textContent!.split(' · ')[0]);
    expect(after.slice(0, 8)).toEqual(['R', '5', '4', '3', '2', 'G', 'B1', 'B2']);
    // The graph can be closed and opened again from the toolbar.
    fireEvent.click(within(graph).getByRole('button', { name: 'Close the structure graph' }));
    expect(screen.queryByRole('region', { name: 'Structure graph' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Structure graph' }));
    expect(screen.getByRole('region', { name: 'Structure graph' })).toBeTruthy();
  });

  it('generates a layout: a preview first, rejected leaves nothing, accepted keeps it (structure spec §6)', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Structure', exact: true } as never));
    const dialog = screen.getByRole('dialog', { name: 'New structure' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Apartment block/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create structure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = screen.getByRole('region', { name: 'Generate a layout' });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Floor by floor' }));
    expect((within(panel).getByRole('combobox', { name: 'Rules' }) as HTMLSelectElement).value).toBe('linear');
    const rooms = () => within(screen.getByRole('region', { name: 'Structure graph' })).getByText(/rooms ·/).textContent!;
    expect(rooms()).toMatch(/^0 rooms/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }));
    expect(within(panel).getByRole('status').textContent).toMatch(/^Preview, seed \d+: \d+ rooms/);
    // The preview shows in the structure graph, but isn't in the project yet.
    expect(rooms()).not.toMatch(/^0 rooms/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject' }));
    expect(rooms()).toMatch(/^0 rooms/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }));
    const seed = within(panel).getByRole('status').textContent!.match(/seed (\d+)/)![1];
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    expect(rooms()).not.toMatch(/^0 rooms/);
    expect(within(screen.getByRole('region', { name: 'Structure graph' })).getByRole('list', { name: 'Structure issues' }).textContent).toContain('Every room can be reached');
    // The seed it was made with is the structure's now.
    expect((screen.getByRole('spinbutton', { name: 'Seed' }) as HTMLInputElement).value).toBe(seed);
  });

  it('dresses what it lays out in a theme, and dresses the rooms again without moving a wall (structure spec V2)', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Structure', exact: true } as never));
    const dialog = screen.getByRole('dialog', { name: 'New structure' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Apartment block/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create structure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = screen.getByRole('region', { name: 'Generate a layout' });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Floor by floor' }));
    expect((within(panel).getByRole('combobox', { name: 'Theme' }) as HTMLSelectElement).value).toBe('residential');
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }));
    expect(within(panel).getByRole('status').textContent).toMatch(/dressed with \d+ props, \d+ lights/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    const rooms = within(screen.getByRole('region', { name: 'Structure graph' })).getByText(/rooms ·/).textContent!;
    // Now as a ruin, rooms only: the same rooms, dressed again.
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Theme' }), { target: { value: 'ruin' } });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Dress rooms only' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }));
    expect(within(panel).getByRole('status').textContent).toMatch(/the rooms as they are; dressed with .* replaces \d+ generated before/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    expect(within(screen.getByRole('region', { name: 'Structure graph' })).getByText(/rooms ·/).textContent).toBe(rooms);
  });

  it('imports a floor plan from an SVG: layers with roles, a preview, then rooms and doors on the floor (structure spec V2)', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Structure', exact: true } as never));
    const dialog = screen.getByRole('dialog', { name: 'New structure' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Ancient temple/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create structure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }));
    const imp = screen.getByRole('dialog', { name: 'Import a floor plan' });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600cm" height="800cm" viewBox="0 0 1600 800">
      <g id="Outline"><rect x="0" y="0" width="1600" height="800"/></g>
      <g id="Rooms"><rect x="0" y="0" width="800" height="800"/><rect x="800" y="0" width="800" height="800"/></g>
      <g id="Labels"><text x="400" y="400">Nave</text><text x="1200" y="400">Vestry</text></g>
      <g id="Doors"><rect x="760" y="350" width="80" height="90"/></g>
    </svg>`;
    const file = new File([svg], 'temple.svg', { type: 'image/svg+xml' });
    fireEvent.change(within(imp).getByLabelText('Plan file'), { target: { files: [file] } });
    await waitFor(() => expect(within(imp).getByRole('status').textContent).toBe('16 × 8 m: 2 rooms, 1 doors, 0 stairs.'));
    expect((within(imp).getByRole('combobox', { name: 'Drawn in' }) as HTMLSelectElement).value).toBe('cm');
    expect((within(imp).getByRole('combobox', { name: 'Layer Doors' }) as HTMLSelectElement).value).toBe('doors');
    fireEvent.click(within(imp).getByRole('button', { name: /^Import onto/ }));
    expect(screen.queryByRole('dialog', { name: 'Import a floor plan' })).toBeNull();
    const graph = screen.getByRole('region', { name: 'Structure graph' });
    expect(within(graph).getByText(/rooms ·/).textContent).toMatch(/^2 rooms/);
  });

  it('plays as a scene: a walkthrough, objectives, and things put in a room (structure spec MVP 3)', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Structure', exact: true } as never));
    const dialog = screen.getByRole('dialog', { name: 'New structure' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Apartment block/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Structure name' }), { target: { value: 'Old Hotel' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create structure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = screen.getByRole('region', { name: 'Generate a layout' });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Floor by floor' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    // The walkthrough: in from outside, room by room.
    const graph = screen.getByRole('region', { name: 'Structure graph' });
    fireEvent.click(within(graph).getByRole('tab', { name: 'Walkthrough' }));
    const walk = within(graph).getByRole('list', { name: 'Walkthrough' });
    expect(within(walk).getAllByRole('listitem')[0]!.textContent).toBe('Come in from outside.');
    expect(within(walk).getAllByRole('listitem').length).toBeGreaterThan(3);
    // An objective, in the inspector's As a scene section (nothing selected).
    fireEvent.click(screen.getByRole('button', { name: '+ Objective' }));
    expect((screen.getByRole('textbox', { name: 'Objective 1' }) as HTMLInputElement).value).toBe('Objective 1');
    // Put a new item into a room picked in the graph.
    const room = within(graph).getAllByRole('button').find((b) => /Lobby|Corridor|Room|Hall|Flat/.test(b.getAttribute('aria-label') ?? ''))!;
    fireEvent.click(room);
    fireEvent.change(screen.getByRole('combobox', { name: 'What to put in this room' }), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'New item’s name' }), { target: { value: 'Room Key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Put it here' }));
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Room Key');
    fireEvent.click(within(graph).getByRole('tab', { name: 'Walkthrough' }));
    expect(within(graph).getByRole('list', { name: 'Walkthrough' }).textContent).toContain('Take Room Key (Room Key)');
  });
});
