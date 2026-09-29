import { describe, expect, it } from 'vitest';
import { liveNotes, mergeNotes, notesFromSync, notesSyncText } from '../codex-sync';

describe('syncing codex notes', () => {
  const ours = new Map([
    ['lore:order', { text: 'Priests', at: 100 }],
    ['items:key', { text: 'For the door', at: 300 }],
    ['quests:vault', { text: 'Old', at: 100 }],
  ]);
  const theirs = new Map([
    ['lore:order', { text: 'Priests, not monks', at: 200 }],
    ['items:key', { text: 'Older', at: 250 }],
    ['quests:vault', { text: '', at: 400 }],
    ['encounters:eels', { text: 'Bring the lantern', at: 50 }],
  ]);

  it('keeps the newer note for each entry, takings-off too', () => {
    const merged = mergeNotes(ours, theirs);
    expect(Object.fromEntries(liveNotes(merged.notes))).toEqual({ 'lore:order': 'Priests, not monks', 'items:key': 'For the door', 'encounters:eels': 'Bring the lantern' });
    expect(merged.notes.get('quests:vault')).toEqual({ text: '', at: 400 });
    expect(merged.changed).toBe(3);
    // Merging is the same either way round, and again changes nothing.
    expect([...mergeNotes(theirs, ours).notes].sort()).toEqual([...merged.notes].sort());
    expect(mergeNotes(merged.notes, theirs).changed).toBe(0);
  });

  it('reads back what it writes, and nothing that is not a sync file', () => {
    const text = notesSyncText('The Sunken Vault', ours);
    expect(JSON.parse(text)).toMatchObject({ format: 'vcgs-codex-notes-sync', version: 1, story: 'The Sunken Vault' });
    expect([...notesFromSync(text)!].sort()).toEqual([...ours].sort());
    expect(notesFromSync('CODEX NOTES · The Sunken Vault')).toBeNull();
    expect(notesFromSync('{"format":"other"}')).toBeNull();
    expect([...notesFromSync('{"format":"vcgs-codex-notes-sync","notes":{"a":{"text":1,"at":2},"b":{"text":"ok","at":3}}}')!]).toEqual([['b', { text: 'ok', at: 3 }]]);
  });
});
