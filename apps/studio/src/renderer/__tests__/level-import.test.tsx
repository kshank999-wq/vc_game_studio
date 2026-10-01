/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetPreferences } from '../preferences';

// jsdom can't decode pictures: reading one gives back a tiny PNG, 2000 × 1000 pixels as the original was.
vi.mock('../components/level/import-files', async (original) => ({
  ...(await original<typeof import('../components/level/import-files')>()),
  readImage: async () => ({ image: 'data:image/png;base64,iVBORw0KGgo=', pixels: { w: 2000, h: 1000 } }),
}));

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

const OBJ = ['v -50 0 -25', 'v 50 0 -25', 'v 50 0 25', 'v -50 0 25', 'v -50 90 -25', 'v 50 90 -25', 'v 50 90 25', 'v -50 90 25', 'f 1 2 3 4', 'f 5 6 7 8', 'f 1 2 6 5'].join('\n');

describe('importing into the Level Designer (spec V2 §10)', () => {
  it('lays a reference image under a world, sized to it, and changes its scale', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Start with a world' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New world' })).getByRole('button', { name: 'Create world' }));

    const file = new File(['png'], 'kingdom-map.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Reference image file'), { target: { files: [file] } });
    const ref = await screen.findByRole('group', { name: 'Reference kingdom-map' });
    // A 10 km world: the 2:1 picture is 10 km wide, 5 m a pixel, under the map.
    expect(within(ref).getByText(/10 km × 5 km · 2000 × 1000 px/)).toBeTruthy();
    expect((within(ref).getByRole('combobox', { name: 'What it is' }) as HTMLSelectElement).value).toBe('map');
    const drawn = container.querySelector('.lvl-references image')!;
    expect(drawn.getAttribute('width')).toBe('10000');
    expect(drawn.getAttribute('height')).toBe('5000');

    const mpp = within(ref).getByRole('textbox', { name: 'Metres per pixel' });
    fireEvent.change(mpp, { target: { value: '2' } });
    fireEvent.blur(mpp);
    expect(within(screen.getByRole('group', { name: 'Reference kingdom-map' })).getByText(/4 km × 2 km/)).toBeTruthy();
    expect(container.querySelector('.lvl-references image')!.getAttribute('width')).toBe('4000');

    // Hidden, it leaves the map; removed, it is gone.
    fireEvent.click(within(screen.getByRole('group', { name: 'Reference kingdom-map' })).getByRole('checkbox', { name: 'Shown' }));
    expect(container.querySelector('.lvl-references image')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove kingdom-map' }));
    expect(screen.queryByRole('group', { name: 'Reference kingdom-map' })).toBeNull();
  });

  it('imports a model in the units it was made in and places it from Personal assets', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Start with a world' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New world' })).getByRole('button', { name: 'Create world' }));
    const personal = screen.getByRole('region', { name: 'Personal assets' });
    expect(within(personal).getByText(/Import an OBJ, glTF or GLB/)).toBeTruthy();

    const file = new File([OBJ], 'market-stall.obj', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Model file'), { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: 'Import model' });
    expect(dialog.textContent).toContain('market-stall.obj · OBJ · 6 triangles, 8 vertices');
    // 100 across: guessed as metres; made in centimetres, it is a metre wide.
    expect(within(dialog).getByText(/Comes out/).textContent).toContain('100 m wide');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Made in' }), { target: { value: 'cm' } });
    expect(within(dialog).getByText(/Comes out/).textContent).toBe('Comes out 1 m wide, 0.5 m deep and 0.9 m tall.');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Model name' }), { target: { value: 'Market stall' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tags' }), { target: { value: 'market, kit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to Personal assets' }));
    expect(screen.queryByRole('dialog', { name: 'Import model' })).toBeNull();
    const pick = within(screen.getByRole('region', { name: 'Personal assets' })).getByRole('button', { name: 'Place Market stall' });
    expect(pick.textContent).toContain('1 m');
    // Found by its tags too, and kept for every project.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'kit' } });
    expect(screen.getByRole('button', { name: 'Place Market stall' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: '' } });
    expect(JSON.parse(localStorage.getItem('vcgs.library.v1')!)[0]).toMatchObject({ name: 'Market stall', proxy: 'model', size: { w: 1, d: 0.5, h: 0.9 }, tags: ['market', 'kit'] });

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Place Market stall' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Level map' }), { button: 0, clientX: 200, clientY: 150 });
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Market stall');
    expect(screen.getByText('market-stall.obj')).toBeTruthy();
    expect(screen.getByText(/6 tris · made in cm/)).toBeTruthy();
  });
});
