/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { fileNameFor, parse, serialize } from '../files';
import { sunkenVault } from '../model/sample';
import { getPreferences, resetPreferences, setPreferences } from '../preferences';

/** The Bible, play-through, shot list and handoff load on first use; wait for the one just opened. */
// The first import of a lazy view (three.js among them) can take a few seconds on a busy machine.
const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull(), { timeout: 5000 });

/** File › New from the sample, which loads the sample on demand. */
const openSample = async () => {
  fireEvent.click(screen.getByRole('menuitem', { name: 'New from the sample (The Sunken Vault)' }));
  await waitFor(() => expect(document.querySelectorAll('[data-node]').length).toBeGreaterThan(10), { timeout: 5000 });
};

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

const openMenu = (title: string) => fireEvent.pointerDown(screen.getByRole('menuitem', { name: title }));

describe('project files', () => {
  it('round-trip a whole project, and refuse anything else', () => {
    const project = sunkenVault();
    expect(parse(serialize(project))).toEqual(project);
    expect(parse('{"hello": 1}')).toBeNull();
    expect(parse('not json')).toBeNull();
    expect(fileNameFor({ ...project, name: 'Act 1: The Vault?' })).toBe('Act 1 The Vault.vcgs');
  });
});

describe('preferences', () => {
  it('are kept on this computer and fall back to the defaults', () => {
    setPreferences({ showMinimap: false, scriptSize: 18 });
    expect(JSON.parse(localStorage.getItem('vcgs.prefs.v1')!)).toMatchObject({ showMinimap: false, scriptSize: 18 });
    resetPreferences();
    expect(getPreferences().showMinimap).toBe(true);
  });
});

describe('the menu bar', () => {
  it('opens a menu, runs a command, and closes', () => {
    const { container } = render(<App />);
    openMenu('Project');
    expect(screen.getByRole('menu', { name: 'Project' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a subplot lane' }));
    expect(container.querySelectorAll('.subplot-band')).toHaveLength(1);
    expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull();
  });

  it('starts from the sample, then asks before a new project throws it away', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    expect(container.querySelectorAll('[data-node]').length).toBeGreaterThan(10);
    act(() => {
      fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('Save “The Sunken Vault” first?');
    fireEvent.click(screen.getByRole('button', { name: 'Don’t save' }));
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3);
  });

  it('toggles the minimap from View, and opens Preferences and the shortcuts', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.minimap')).toBeTruthy();
    openMenu('View');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Minimap/ }));
    expect(container.querySelector('.minimap')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    });
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    act(() => {
      fireEvent.keyDown(window, { key: '?' });
    });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

describe('search', () => {
  it('opens with Ctrl+K and goes to a node on the graph', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'cave mouth' } });
    expect(screen.getAllByRole('option')[0]!.textContent).toContain('The Cave Mouth');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Search the project' })).toBeNull();
    expect(container.querySelector('[data-node].selected')?.textContent).toContain('The Cave Mouth');
  });
});

describe('other windows', () => {
  it('the main window takes an edit sent from another window, and it is one undo step', async () => {
    const { role } = await import('../windows');
    const { renameProject } = await import('../model/project');
    render(<App />);
    const other = new BroadcastChannel(`vcgs:${role.session}`);
    const heard: { t: string; project?: { name: string } }[] = [];
    other.onmessage = (e) => heard.push(e.data);
    other.postMessage({ t: 'hello' });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const state = heard.find((m) => m.t === 'state')!;
    expect(state.project!.name).toBe('Untitled Game');
    other.postMessage({ t: 'commit', project: renameProject(state.project as never, 'From the Bible window') });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByRole('button', { name: 'From the Bible window' })).toBeTruthy();
    expect(heard.at(-1)!.project!.name).toBe('From the Bible window');
    other.postMessage({ t: 'undo' });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByRole('button', { name: 'Untitled Game' })).toBeTruthy();
    other.close();
  });
});

describe('deleting from the Bible', () => {
  it('says what goes with a character before deleting her', async () => {
    render(<App />);
    openMenu('File');
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Mara')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete “Mara”?');
    expect(dialog.textContent).toContain('The arc lane “Mara” stays');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete…' })).toBeNull();
  });
});

describe('play-through', () => {
  it('opens with F5, plays to a choice, and takes it', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    act(() => {
      fireEvent.keyDown(window, { key: 'F5' });
    });
    await opened();
    expect(container.querySelector('.play-view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // SC-01 opens by lighting the lantern: its oil is a mechanic in play.
    expect(container.querySelector('.play-mechanic')?.textContent).toContain('Now available: Lantern oil');
    expect((screen.getByLabelText('Available: Lantern oil') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Carry on/ }));
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // SC-02 opens on an encounter: win it or lose it.
    expect(container.querySelector('.play-choice-title')?.textContent).toContain('Encounter: Eel swarm');
    fireEvent.click(screen.getByRole('button', { name: /Lose · try again/ }));
    expect(container.querySelector('.play-transcript')?.textContent).toContain('Eel swarm: try again');
    fireEvent.click(screen.getByRole('button', { name: /^1\s*Win/ }));
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // Finding the key starts the quest, and its seal tells the Order's story.
    expect(container.querySelector('.play-quest')?.textContent).toContain('New quest: Open the vault');
    expect(container.querySelector('.play-lore')?.textContent).toContain('Discovered: The Drowned Order');
    // The codex counts those, Mara, the chamber, the key, the lantern's oil and the eels (met, then beaten), and opens on the quest log, the characters, the locations, the items, the mechanics, the encounters and the lore (C, or its button).
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex · 8 new');
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    const codex = screen.getByRole('dialog', { name: 'Codex' });
    expect(codex.textContent).toContain('Open the vault — Reach the vault chamber and open the door');
    expect(codex.textContent).toContain('Lantern oil · Hold to raise the lantern');
    expect(codex.textContent).toContain('MaraA guide who knows the flooded caves');
    expect(codex.textContent).toContain('Vault Key (carried)A heavy bronze key');
    expect(codex.textContent).toContain('Vault ChamberA drowned hall under the old city');
    expect(codex.textContent).toContain('Eel swarm (won)Eels, a dozen or so · weak to lantern light');
    expect(codex.textContent).toContain('The Drowned OrderRiver priests who sealed the vault');
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex');
    // Search it: "/" goes to the box; only what matches stays, and C types rather than closes.
    act(() => {
      fireEvent.keyDown(window, { key: '/' });
    });
    const search = screen.getByLabelText('Search the codex') as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'lantern' } });
    expect(codex.textContent).toContain('MaraA guide');
    expect(codex.textContent).toContain('Eel swarm');
    expect(codex.textContent).not.toContain('Vault Key');
    expect(screen.queryByRole('region', { name: 'Lore' })).toBeNull();
    fireEvent.keyDown(search, { key: 'c' });
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(codex.textContent).toContain('Nothing matches “nothing like it”.');
    // Filter by section: only Encounters, then with the search too, then All again.
    const sections = within(codex).getByRole('group', { name: 'Codex sections' });
    fireEvent.click(within(sections).getByRole('button', { name: 'Encounters' }));
    expect(within(sections).getByRole('button', { name: 'Encounters' }).getAttribute('aria-pressed')).toBe('true');
    expect(codex.textContent).toContain('Nothing matches “nothing like it” in Encounters.');
    fireEvent.change(search, { target: { value: 'lantern' } });
    expect(codex.textContent).toContain('Eel swarm');
    expect(codex.textContent).not.toContain('MaraA guide');
    // Sort: the choice sticks while the codex is open (one entry a section here, so the same order).
    fireEvent.change(within(codex).getByLabelText('Sort the codex'), { target: { value: 'name' } });
    expect((within(codex).getByLabelText('Sort the codex') as HTMLSelectElement).value).toBe('name');
    expect(codex.textContent).toContain('Eel swarm');
    // Bookmarks: star an entry, then show the bookmarks alone.
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(within(sections).getByRole('button', { name: '★ Bookmarks' }));
    expect(codex.textContent).toContain('No bookmarks yet.');
    fireEvent.click(within(sections).getByRole('button', { name: 'All' }));
    fireEvent.click(within(codex).getByRole('button', { name: 'Bookmark Eel swarm' }));
    expect(within(codex).getByRole('button', { name: 'Bookmark Eel swarm' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sections).getByRole('button', { name: '★ Bookmarks' }));
    expect(codex.textContent).toContain('Eel swarm');
    expect(codex.textContent).not.toContain('MaraA guide');
    // A note on it: the pencil opens a box, Enter keeps it, and it shows under the entry.
    fireEvent.click(within(codex).getByRole('button', { name: 'Note on Eel swarm' }));
    const box = within(codex).getByLabelText('Your note on Eel swarm');
    fireEvent.change(box, { target: { value: 'Light the lantern first' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(within(codex).queryByLabelText('Your note on Eel swarm')).toBeNull();
    expect(codex.textContent).toContain('Note: Light the lantern first');
    // Export the notes: a text file with each noted entry.
    const saved: Blob[] = [];
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob) => (saved.push(b), 'blob:notes');
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(codex).getByRole('button', { name: 'Export notes' }));
    expect(click).toHaveBeenCalled();
    const read = (b: Blob) => new Promise<string>((done) => {
      const r = new FileReader();
      r.onload = () => done(String(r.result));
      r.readAsText(b);
    });
    expect(await read(saved[0]!)).toContain('ENCOUNTERS · EEL SWARM (won)\nLight the lantern first');
    click.mockRestore();
    // Import notes back: the exported file, with one changed and one for the Order's story.
    const file = new File([`CODEX NOTES · The Sunken Vault\n\nENCOUNTERS · EEL SWARM (won)\nBring the lantern\n\nLORE · THE DROWNED ORDER\nPriests\n\nLORE · THE LAST EXPEDITION\nWho?`], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(within(codex).getByLabelText('Notes file to import'), { target: { files: [file] } });
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toBe('Imported 2 notes. Not in the codex (yet): LORE · THE LAST EXPEDITION.'));
    expect(codex.textContent).toContain('Note: Bring the lantern');
    fireEvent.click(within(sections).getByRole('button', { name: 'All' }));
    expect(codex.textContent).toContain('Note: Priests');
    // Share them: no share sheet here, so they are copied, as the text the export writes.
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
    fireEvent.click(within(codex).getByRole('button', { name: 'Share notes' }));
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('Notes copied.'));
    expect(copied[0]).toContain('LORE · THE DROWNED ORDER\nPriests');
    // With a share sheet, that is used instead.
    const shared: ShareData[] = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: ShareData) => void shared.push(d) });
    fireEvent.click(within(codex).getByRole('button', { name: 'Share notes' }));
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toBe('Notes shared.'));
    expect(shared[0]).toMatchObject({ title: 'The Sunken Vault codex notes' });
    delete (navigator as { share?: unknown }).share;
    // Neither a share sheet nor a clipboard (an embedded page, say): the notes are shown, selected, to copy by hand.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fireEvent.click(within(codex).getByRole('button', { name: 'Share notes' }));
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('This page cannot copy by itself'));
    expect((within(codex).getByLabelText('Notes to copy') as HTMLTextAreaElement).value).toContain('LORE · THE DROWNED ORDER\nPriests');
    // Email them: a mail link with the notes, for the mail app.
    const email = within(codex).getByRole('link', { name: 'Email notes' }) as HTMLAnchorElement;
    expect(email.href).toMatch(/^mailto:\?subject=The%20Sunken%20Vault%20codex%20notes&body=CODEX%20NOTES/);
    expect(decodeURIComponent(email.href)).toContain('LORE · THE DROWNED ORDER\r\nPriests');
    const noNav = vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom does not follow links
    fireEvent.click(email);
    noNav.mockRestore();
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('Opening your mail app with the notes.'));
    // Text them: a text-message link with the notes, for the messages app.
    const text = within(codex).getByRole('link', { name: 'Text notes' }) as HTMLAnchorElement;
    expect(text.href).toMatch(/^sms:\?&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0A%0A/);
    expect(decodeURIComponent(text.href)).toContain('LORE · THE DROWNED ORDER\nPriests');
    const noText = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.click(text);
    noText.mockRestore();
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('Opening your messages app with the notes.'));
    // Print them: the notes as a page, in a hidden frame that asks for the print dialog.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom has no print dialog
    fireEvent.click(within(codex).getByRole('button', { name: 'Print notes' }));
    const frame = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('<h2>Lore</h2>\n<div class="note"><h3>THE DROWNED ORDER</h3><p>Priests</p></div>');
    const printed = vi.fn();
    Object.defineProperty(frame.contentWindow!, 'print', { configurable: true, value: printed });
    frame.dispatchEvent(new Event('load'));
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('Printing the notes.'));
    expect(printed).toHaveBeenCalled();
    frame.remove();
    // No print dialog: save them as a page to print from.
    const pageClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(codex).getByRole('button', { name: 'Save as a page' }));
    expect(saved.at(-1)!.type).toBe('text/html;charset=utf-8');
    expect(await read(saved.at(-1)!)).toContain('<title>The Sunken Vault · codex notes</title>');
    // Where the page may not print at all, it is saved straight away.
    fireEvent.click(within(codex).getByRole('button', { name: 'Print notes' }));
    const refused = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement;
    Object.defineProperty(refused.contentWindow!, 'print', { configurable: true, value: () => { throw new Error('blocked'); } });
    refused.dispatchEvent(new Event('load'));
    await waitFor(() => expect(within(codex).getByRole('status').textContent).toContain('This page cannot print by itself'));
    refused.remove();
    pageClick.mockRestore();
    quiet.mockRestore();
    // Sync: the notes are kept in the browser, and a note changed in another window turns up here.
    const storedKey = Object.keys(localStorage).find((k) => k.startsWith('vcgs.codexNotes.'))!;
    const stored = JSON.parse(localStorage.getItem(storedKey)!);
    expect(stored.story).toBe('The Sunken Vault');
    expect(Object.values(stored.notes).map((n) => (n as { text: string }).text)).toContain('Priests');
    const eels = Object.keys(stored.notes).find((k) => k.startsWith('encounters:'))!;
    const elsewhere = JSON.stringify({ ...stored, notes: { ...stored.notes, [eels]: { text: 'Changed in the other window', at: Date.now() + 60000 } } });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storedKey, newValue: elsewhere }));
    });
    expect(codex.textContent).toContain('Note: Changed in the other window');
    // Take in notes someone shared: paste them, and they go where they belong.
    fireEvent.click(within(codex).getByRole('button', { name: 'Paste notes' }));
    fireEvent.change(within(codex).getByLabelText('Shared notes to take in'), { target: { value: 'CODEX NOTES · The Sunken Vault\n\nITEMS · VAULT KEY\nFrom a friend: it fits the vault door' } });
    fireEvent.click(within(codex).getByRole('button', { name: 'Take them in' }));
    expect(within(codex).getByRole('status').textContent).toBe('Imported 1 note.');
    expect(codex.textContent).toContain('Note: From a friend: it fits the vault door');
    expect(within(codex).queryByLabelText('Shared notes to take in')).toBeNull();
    fireEvent.click(within(sections).getByRole('button', { name: '★ Bookmarks' }));
    URL.createObjectURL = created;
    if (revoked) URL.revokeObjectURL = revoked; // else keep the stub: a download's clean-up may still be pending
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'lantern' } });
    fireEvent.click(within(sections).getByRole('button', { name: 'All' }));
    expect(codex.textContent).toContain('MaraA guide');
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    // Escape clears the search, then leaves the box.
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(codex.textContent).toContain('Vault Key');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(document.activeElement).not.toBe(search);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Codex' })).toBeNull();
    expect(container.querySelector('.play-free')?.textContent).toContain('Rusted Lever');
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    expect(container.querySelector('.play-transcript')?.textContent).toContain('Seam drains fires');
    // Using the lever puts it in the codex's objects.
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex · 1 new');
    // Turning the key opens the vault: the quest is done.
    expect(container.querySelector('.play-quest.done')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Turn the key/ }));
    expect(container.querySelector('.play-quest.done')?.textContent).toContain('Quest complete: Open the vault');
    expect((screen.getByLabelText('Quest Open the vault') as HTMLSelectElement).value).toBe('done');
  });
});

describe('the shot list', () => {
  it('opens from a cinematic in the Bible, adds a shot and edits it', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Door in the dark')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Open the shot list' }));
    await opened();
    expect(container.querySelectorAll('.shot-card')).toHaveLength(3);
    expect(container.querySelector('.shotlist-sum')?.textContent).toBe('3 shots · 7.5s');
    fireEvent.click(screen.getByRole('button', { name: '+ Add a shot at the end' }));
    expect(container.querySelectorAll('.shot-card')).toHaveLength(4);
    fireEvent.change(screen.getByRole('combobox', { name: 'Framing' }), { target: { value: 'Insert' } });
    expect(container.querySelectorAll('.seq-shot')[3]?.textContent).toContain('Insert');
    expect(container.querySelector('.shotlist-sum')?.textContent).toBe('4 shots · 10.5s');
  });
});
