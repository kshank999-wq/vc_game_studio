import type { ObjectType, Project } from '../types';
import { placeNote, staged, type Place } from './convert';
import { addCategory, mergeNotes, notesOf, passagesOf, progressOf, refOf, segmentsOf } from './sorter';
import { TEMPLATES } from './templates';
import type { ExtractedNote, Layer, NoteSet, Suggestion } from './types';

/**
 * Suggestions (Note Sorter spec §16): possible duplicates, a category the
 * notes seem to want, where a converted card might go, and people in the
 * raw notes nobody has sorted yet. They are worked out from the notes by
 * plain rules — no model, nothing sent anywhere — and **nothing changes
 * until the designer accepts one**. Accepting runs the same operation the
 * designer would have run by hand, so Undo takes it back.
 */

const STOP = new Set(
  'the a an and or but of to in on at by for with from into onto over under as is are was were be been being it its this that these those he she they them his her their you your we our i me my not no so if then than when while can could would should will may might must do does did has have had just only also very more most some any each every one two three about after before again all both few own same such too up down out off once here there where which who whom what why how like'.split(
    ' ',
  ),
);

/** A passage's words that say something, in order, crudely stemmed so "drains" meets "drain". */
const termsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''));

export const wordsOf = (text: string): Set<string> => new Set(termsOf(text));

/** Two words that say something, one after the other: "lantern oil". */
const pairsOf = (text: string): Set<string> => {
  const t = termsOf(text);
  return new Set(t.slice(1).map((w, i) => `${t[i]} ${w}`));
};

const overlap = (a: Set<string>, b: Set<string>): { shared: number; ratio: number } => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return { shared, ratio: union ? shared / union : 0 };
};

/** The same idea twice: most of the words shared, or a telling phrase and another word besides. */
const alike = (a: string, b: string): boolean => {
  const { shared, ratio } = overlap(wordsOf(a), wordsOf(b));
  if (shared >= 2 && ratio >= 0.34) return true;
  return shared >= 2 && overlap(pairsOf(a), pairsOf(b)).shared >= 1;
};

const quote = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/** Which scene layer an object type belongs in (spec §10). */
export const layerFor = (type: ObjectType): Layer =>
  type === 'character' ? 'behavior' : ['trigger', 'gate', 'state', 'puzzle', 'object'].includes(type) ? 'systemic' : ['dialogue', 'cinematic'].includes(type) ? 'presentation' : 'narrative';

/** Capitalised names in the unsorted parts of the notes that no character already has: people, factions, things. */
const unsortedNames = (project: Project): string[] => {
  const set = notesOf(project);
  const known = new Set(
    Object.values(project.objects)
      .filter((o) => o.type === 'character')
      .map((o) => o.name.toLowerCase()),
  );
  const counts = new Map<string, number>();
  for (const source of set.sources) {
    const text = source.content;
    // Only words still unsorted count, but the whole text is read, so a sentence's first word is known for one.
    const open = segmentsOf(project, source).filter((seg) => !seg.notes.length);
    const unsorted = (at: number) => open.some((seg) => at >= seg.start && at < seg.end);
    // "the Drowned Order" and "Drowned Order" are one name.
    const add = (name: string) => {
      const same = [...counts.keys()].find((k) => k.replace(/^the /i, '').toLowerCase() === name.replace(/^the /i, '').toLowerCase());
      counts.set(same ?? name, (counts.get(same ?? name) ?? 0) + 1);
    };
    // "the Sultan", "Rafi": a capital not at the start of a sentence, or a title after "the".
    for (const m of text.matchAll(/(?<![.!?:"“]\s*|^|\n)(?<=\s)(the\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g)) {
      if (!unsorted(m.index!)) continue;
      const name = (m[1] ? `the ${m[2]}` : m[2]!).trim();
      const bare = m[2]!.toLowerCase();
      if (known.has(bare) || known.has(name.toLowerCase()) || STOP.has(bare) || /^(Age|Era|Level|Act|Scene|Chapter|Order)$/.test(m[2]!)) continue;
      add(name);
    }
    for (const m of text.matchAll(/\bthe\s+([a-z]+(?:'s)?\s+(?:heir|king|queen|master|mother|father|sister|brother|captain|abbot|priest|daughter|son))\b/g)) {
      if (unsorted(m.index!)) add(`the ${m[1]}`);
    }
  }
  return [...counts.keys()].slice(0, 4);
};

/** Every suggestion there is now, pending ones only, each with a stable id. */
export const suggestionsFor = (project: Project): Suggestion[] => {
  const set = notesOf(project);
  if (!set.suggestionsOn) return [];
  const out: Suggestion[] = [];
  const live = set.notes.filter((n) => !n.setAside);

  // Possible duplicates: two cards that say the same thing.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (alike(a.text, b.text)) {
        out.push({
          id: `dup:${[a.id, b.id].sort().join(':')}`,
          kind: 'duplicate',
          text: `“${quote(a.text)}” (${refOf(project, a)}) and “${quote(b.text)}” (${refOf(project, b)}) look like the same idea.`,
          payload: { into: a.id, from: b.id },
        });
      }
    }
  }

  // A category the unsorted notes keep mentioning.
  const have = new Set(set.categories.map((c) => c.name.toLowerCase()));
  const everything = TEMPLATES.find((t) => t.key === 'everything')!.categories;
  const untouched = set.sources.flatMap((source) =>
    passagesOf(source)
      .filter((p) => !set.notes.some((n) => n.sourceId === source.id && n.range.start < p.end && n.range.end > p.start))
      .map((p) => source.content.slice(p.start, p.end).toLowerCase()),
  );
  for (const c of everything) {
    if (have.has(c.name.toLowerCase())) continue;
    const stem = c.name.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
    if (stem.length < 3) continue;
    const pattern = new RegExp(`\\b${stem.replace(/\s+/g, '\\s+')}`, 'i');
    const count = untouched.filter((p) => pattern.test(p)).length;
    if (count >= 2) {
      // Under Lore, if it's one of Lore's kin and Lore is there.
      const parent = ['eras'].includes(c.key) ? set.categories.find((x) => x.templateKey === 'lore' || x.name.toLowerCase() === 'lore') : undefined;
      out.push({
        id: `cat:${c.key}`,
        kind: 'category',
        text: `${count} unsorted passages mention ${c.name.toLowerCase()}. Add a ${c.name} category${parent ? ` under ${parent.name}` : ''}?`,
        payload: { name: c.name, key: c.key, ...(parent ? { parentId: parent.id } : {}) },
      });
    }
  }

  // Where a converted card might go: a scene, location or level its words name.
  const places = [
    ...Object.values(project.objects)
      .filter((o) => o.type === 'scene')
      .map((o) => ({ id: o.id, name: o.name, kind: 'scene' as const })),
    ...(project.levels?.levels ?? []).map((l) => ({ id: l.id, name: l.name, kind: 'level' as const })),
  ];
  for (const s of staged(project).filter((x) => !x.placed && x.destination.objectId)) {
    const text = s.note.text.toLowerCase();
    for (const place of places) {
      const named = place.name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w));
      const hit = named.find((w) => text.includes(w.replace(/s$/, '')));
      if (!hit) continue;
      const object = project.objects[s.destination.objectId];
      if (!object) continue;
      const layer = layerFor(object.type);
      out.push({
        id: `dest:${s.note.id}:${object.id}:${place.id}`,
        kind: 'destination',
        text: `${object.name} could go in ${place.name}${place.kind === 'scene' ? ` (its ${layer} layer)` : ''}: the note says “${hit}”.`,
        payload: { note: s.note.id, object: object.id, target: place.kind, place: place.id, layer },
      });
      break;
    }
  }

  // People in the raw notes not yet sorted.
  const names = unsortedNames(project);
  if (names.length) {
    out.push({
      id: `ent:${names.join('|').toLowerCase()}`,
      kind: 'entity',
      text: `Names in the raw notes not yet sorted — characters, factions or things: ${names.join(', ')}.`,
      payload: { names },
    });
  }

  return out.filter((s) => !set.suggestions[s.id]);
};

const decide = (project: Project, id: string, state: 'accepted' | 'dismissed'): Project => {
  const set: NoteSet = notesOf(project);
  return { ...project, notes: { ...set, suggestions: { ...set.suggestions, [id]: state } } };
};

export const dismissSuggestion = (project: Project, id: string): Project => decide(project, id, 'dismissed');

/** Accept a suggestion: the designer's say-so, and the same change they would have made by hand. */
export const acceptSuggestion = (project: Project, suggestion: Suggestion): Project => {
  let next = project;
  const p = suggestion.payload;
  switch (suggestion.kind) {
    case 'duplicate':
      next = mergeNotes(next, p.into as string, p.from as string);
      break;
    case 'category':
      next = addCategory(next, p.name as string, p.parentId as string | undefined, p.key as string).project;
      break;
    case 'destination': {
      const place: Place = p.target === 'scene' ? { target: 'sceneLayer', sceneId: p.place as string, layer: p.layer as Layer } : { target: 'level', levelId: p.place as string };
      next = placeNote(next, p.note as string, p.object as string, place)?.project ?? next;
      break;
    }
    case 'entity':
      // Nothing to change: "Show me" finds the words in the raw notes.
      break;
  }
  return decide(next, suggestion.id, 'accepted');
};

export const setSuggestionsOn = (project: Project, on: boolean): Project => {
  const set = notesOf(project);
  return { ...project, notes: { ...set, suggestionsOn: on } };
};

/** A card and every card like it, for Compare. */
export const duplicatesOf = (project: Project, note: ExtractedNote): ExtractedNote[] => {
  return notesOf(project).notes.filter((n) => n.id !== note.id && !n.setAside && alike(note.text, n.text));
};

/** How far each source has got, in words, for Review's bars. */
export const sourceProgress = (project: Project) => notesOf(project).sources.map((source) => ({ source, progress: progressOf(project, source), notes: notesOf(project).notes.filter((n) => n.sourceId === source.id).length }));

