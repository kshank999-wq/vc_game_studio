import { describe, expect, it } from 'vitest';
import { spineLane, spineSequence } from '../layout';
import { sunkenVault } from '../sample';
import { sceneLines } from '../scene';
import { builtFrom, convertNote, ensurePlayerLane, nameFrom, placeNote, playerLaneOf, staged, stillNotes, suggestedKind } from '../notes/convert';
import { withSampleNotes } from '../notes/sample';
import {
  addCategory,
  categoriesOf,
  extract,
  loadTemplate,
  mergeNotes,
  moveNote,
  noteById,
  notesIn,
  notesOf,
  passagesOf,
  progressOf,
  refOf,
  removeCategory,
  segmentsOf,
  standing,
  statusOf,
  updateNote,
} from '../notes/sorter';
import { acceptSuggestion, suggestionsFor } from '../notes/suggest';
import { removeObject } from '../project';
import type { Project } from '../types';

const start = () => {
  const p = withSampleNotes(sunkenVault());
  const set = notesOf(p);
  const memo = set.sources[0]!;
  const cat = (name: string) => set.categories.find((c) => c.name === name)!.id;
  /** The range of some words in the memo. */
  const at = (words: string, source = memo) => {
    const start = source.content.indexOf(words);
    return { start, end: start + words.length };
  };
  return { p, memo, cat, at };
};

describe('the Note Sorter: sources and cards', () => {
  it('keeps sources as they came, split into passages', () => {
    const { p, memo } = start();
    expect(notesOf(p).sources.map((s) => s.short)).toEqual(['voice', 'lore', 'level']);
    expect(passagesOf(memo)).toHaveLength(10);
    expect(categoriesOf(p).map((c) => c.name)).toEqual(['Lore', 'Eras', 'Characters', 'Mechanics', 'Movement', 'Powers', 'Inventory & Powers', 'Choices', 'Levels', 'Cinematics', 'Dialogue', 'Enemies']);
  });

  it('makes a card from a passage dropped on a category, and the source never changes', () => {
    const { p, memo, cat, at } = start();
    const made = extract(p, memo.id, at('the lantern oil drains the longer you stay in deep water'), cat('Mechanics'))!;
    const note = noteById(made.project, made.id)!;
    expect(note.text).toBe('the lantern oil drains the longer you stay in deep water');
    expect(refOf(made.project, note)).toBe('voice ¶3');
    expect(statusOf(made.project, note)).toBe('sorted');
    // Editing the card's words leaves the source alone.
    const edited = updateNote(made.project, note.id, { text: 'Lantern oil drains in deep water.' });
    expect(notesOf(edited).sources[0]!.content).toBe(memo.content);
    // The passage is marked sorted, not removed.
    const segments = segmentsOf(edited, memo, passagesOf(memo)[2]!);
    expect(segments.map((s) => [memo.content.slice(s.start, s.end), s.notes.length])).toEqual([
      ['Lantern mechanic: ', 0],
      ['the lantern oil drains the longer you stay in deep water', 1],
      ['. Maybe the screen edges darken when it runs low.', 0],
    ]);
  });

  it('counts how far each source has got, by its words and its passages', () => {
    const { p, memo, cat, at } = start();
    let q = p;
    for (const words of ['The vault was sealed by the Drowned Order three hundred years before the game begins, when the river took the old city.', 'Opening cinematic: water pouring upward, back into the cave. Reverse everything.']) {
      q = extract(q, memo.id, at(words), cat('Lore'))!.project;
    }
    const progress = progressOf(q, memo);
    expect(progress.passages).toBe(10);
    expect(progress.untouched).toBe(8);
    expect(progress.ratio).toBeGreaterThan(0.1);
    expect(standing(q)).toMatchObject({ unsorted: 16, sorted: 2, passages: 18 });
  });

  it('nests, reorders, merges and removes categories without losing a card', () => {
    const { p, memo, cat, at } = start();
    let q = extract(p, memo.id, at('Eel swarms in the deep channels'), cat('Enemies'))!.project;
    const second = extract(q, memo.id, at('weak to lantern light'), cat('Enemies'))!;
    q = second.project;
    const [first] = notesIn(q, cat('Enemies'));
    q = moveNote(q, second.id, cat('Enemies'), first!.id);
    expect(notesIn(q, cat('Enemies')).map((n) => n.text)).toEqual(['weak to lantern light', 'Eel swarms in the deep channels']);
    q = mergeNotes(q, second.id, first!.id);
    const merged = noteById(q, second.id)!;
    expect(merged.text).toBe('weak to lantern light\nEel swarms in the deep channels');
    expect(merged.merged).toHaveLength(1);
    // A category removed hands its cards up; nothing is deleted.
    const sub = addCategory(q, 'Swarms', cat('Enemies'));
    q = moveNote(sub.project, second.id, sub.id);
    q = removeCategory(q, sub.id);
    expect(noteById(q, second.id)!.categoryId).toBe(cat('Enemies'));
    // A template only adds what isn't there.
    expect(categoriesOf(loadTemplate(q, 'action-adventure'))).toHaveLength(categoriesOf(q).length);
  });
});

describe('the Note Sorter: into the game', () => {
  const sorted = () => {
    const s = start();
    let p = s.p;
    const take = (words: string, category: string, source = s.memo) => {
      const made = extract(p, source.id, s.at(words, source), s.cat(category))!;
      p = made.project;
      return made.id;
    };
    const ids = {
      lantern: take('Lantern mechanic: the lantern oil drains the longer you stay in deep water.', 'Mechanics'),
      chapel: take('The flooded chapel level: pews underwater, only the rafters to walk on, floating coffins as moving platforms.', 'Levels'),
      eels: take('Eel swarms in the deep channels, weak to lantern light. Could tie into the chapel.', 'Enemies'),
      line: take('Mara, first line: "You mapped the cave. That doesn\'t make it yours."', 'Dialogue'),
      cinematic: take('Opening cinematic: water pouring upward, back into the cave. Reverse everything.', 'Cinematics'),
      choice: take('End choice: Mara keeps the ring for her family, or gives it back to the river. Changes the ending.', 'Choices'),
      lore: take('The vault was sealed by the Drowned Order three hundred years before the game begins, when the river took the old city.', 'Lore'),
    };
    return { ...s, p, ids };
  };

  it('suggests what a card becomes from its category, then its words', () => {
    const { p, ids } = sorted();
    const kinds = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, suggestedKind(p, noteById(p, id)!)?.key]));
    expect(kinds).toEqual({ lantern: 'mechanic', chapel: 'environment', eels: 'encounter', line: 'dialogue', cinematic: 'cinematic', choice: 'choice', lore: 'lore' });
    expect(nameFrom('Lantern mechanic: the lantern oil drains the longer you stay')).toBe('Lantern');
    expect(nameFrom('The flooded chapel level: pews underwater, only the rafters')).toBe('Flooded chapel');
    expect(nameFrom('Opening cinematic: water pouring upward, back into the cave.')).toBe('Opening cinematic');
    expect(nameFrom('Eel swarms in the deep channels, weak to lantern light.')).toBe('Eel swarms in the deep');
    expect(nameFrom('Mara, first line: "You mapped the cave."')).toBe('Mara, first line: You mapped');
  });

  it('converts a card into a game object that points back to it, more than once if need be', () => {
    const { p, ids } = sorted();
    const made = convertNote(p, ids.lantern, 'mechanic', 'Lantern oil')!;
    const object = made.project.objects[made.objectId]!;
    expect(object).toMatchObject({ type: 'mechanic', name: 'Lantern oil', data: { code: 'MEC-01', fromNote: ids.lantern } });
    expect(statusOf(made.project, noteById(made.project, ids.lantern)!)).toBe('converted');
    const twice = convertNote(made.project, ids.lantern, 'state', 'lantern_oil')!;
    expect(noteById(twice.project, ids.lantern)!.destinations.map((d) => d.objectType)).toEqual(['mechanic', 'state']);
    // An object deleted downstream: the card is back to sorted, never deleted.
    const gone = removeObject(removeObject(twice.project, made.objectId), twice.objectId);
    expect(statusOf(gone, noteById(gone, ids.lantern)!)).toBe('sorted');
  });

  it('places a spine beat, a Player Lane beat, and a card into a scene’s layer', () => {
    const { p, ids } = sorted();
    const vault = Object.values(p.objects).find((o) => o.name === 'The Vault Door')!.id;
    const key = Object.values(p.objects).find((o) => o.name === 'The Key')!.id;
    // The lore becomes a spine beat just after The Key.
    let q = convertNote(p, ids.lore, 'spineBeat', 'Sealed by the Order')!.project;
    const beat = noteById(q, ids.lore)!.destinations[0]!.objectId;
    q = placeNote(q, ids.lore, beat, { target: 'spine', after: key })!.project;
    const spine = spineSequence(q);
    expect(spine[spine.indexOf(key) + 1]).toBe(beat);
    expect(statusOf(q, noteById(q, ids.lore)!)).toBe('placed');
    // The mechanic as a Player Lane beat: the lane is made the first time.
    expect(playerLaneOf(q)).toBeUndefined();
    q = convertNote(q, ids.lantern, 'playerBeat', 'Learn the lantern')!.project;
    const step = noteById(q, ids.lantern)!.destinations[0]!.objectId;
    q = placeNote(q, ids.lantern, step, { target: 'playerLane' })!.project;
    expect(playerLaneOf(q)).toMatchObject({ name: 'Player Lane', kind: 'subplot', role: 'player' });
    expect(q.placements[step]!.laneId).toBe(playerLaneOf(q)!.id);
    expect(ensurePlayerLane(q).project).toBe(q);
    // The dialogue block becomes a line of the scene's script, spoken by Mara.
    q = convertNote(q, ids.line, 'dialogue')!.project;
    q = placeNote(q, ids.line, '', { target: 'sceneLayer', sceneId: vault, layer: 'presentation' })!.project;
    const said = sceneLines(q, vault).at(-1)!;
    expect(said.text).toBe('You mapped the cave. That doesn\'t make it yours.');
    expect(q.objects[said.speakerId!]!.name).toBe('Mara');
    // And the scene knows the notes that built it.
    expect(builtFrom(q, vault).map((b) => [b.note.id, b.layer])).toEqual([[ids.line, 'presentation']]);
    // A card moved off the spine on the graph isn't placed any more.
    const moved = { ...q, placements: { ...q.placements, [beat]: { laneId: null, x: 100, y: -200 } } };
    expect(statusOf(moved, noteById(moved, ids.lore)!)).toBe('converted');
    expect(spineLane(moved).id).toBeTruthy();
  });

  it('refuses a place a type doesn’t go, and lists what is ready to place', () => {
    const { p, ids } = sorted();
    let q = convertNote(p, ids.eels, 'encounter', 'Eel swarm')!.project;
    const eels = noteById(q, ids.eels)!.destinations[0]!.objectId;
    expect(placeNote(q, ids.eels, eels, { target: 'spine' })).toBeNull();
    q = placeNote(q, ids.eels, eels, { target: 'system', section: 'encounters' })!.project;
    expect(staged(q).map((s) => [s.destination.objectType, s.placed])).toEqual([['encounter', true]]);
    expect(stillNotes(q)).toHaveLength(6);
  });

  it('offers suggestions, and changes nothing until one is accepted', () => {
    const { p, memo, at, cat } = sorted();
    const lore = notesOf(p).sources[1]!;
    const q = extract(p, lore.id, at('Lantern oil runs out far from the surface: the lantern dims the deeper you go.', lore), cat('Mechanics'))!.project;
    const suggestions = suggestionsFor(q);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain('duplicate');
    expect(kinds).toContain('category');
    expect(kinds).toContain('entity');
    expect(suggestions.find((s) => s.kind === 'category')!.text).toMatch(/Add a .* category/);
    expect(suggestions.find((s) => s.kind === 'entity')!.payload.names).toEqual(['Brass Key', 'Abbot', 'Drowned Order']);
    // Offered is not done.
    expect(notesOf(q).notes).toHaveLength(notesOf(q).notes.length);
    const dup = suggestions.find((s) => s.kind === 'duplicate')!;
    const merged = acceptSuggestion(q, dup);
    expect(notesOf(merged).notes).toHaveLength(notesOf(q).notes.length - 1);
    expect(suggestionsFor(merged).some((s) => s.id === dup.id)).toBe(false);
    expect(memo).toBeTruthy();
  });
});

export type { Project };
