import { newId } from '../project';
import type { Project } from '../types';
import { TEMPLATES } from './templates';
import type { Category, ExtractedNote, NoteSet, NoteStatus, Range, SourceDocument, Verb } from './types';

/**
 * The shared Note Sorter engine (Note Sorter spec §3, §6): immutable sources,
 * source-linked note cards, nested categories, and what every note's status
 * is. Every operation takes a project and returns a new one, so the studio's
 * own Undo covers the sorter too.
 */

const stamp = () => new Date().toISOString();

export const EMPTY: NoteSet = { sources: [], notes: [], categories: [], suggestions: {}, suggestionsOn: true };

export const notesOf = (project: Project): NoteSet => project.notes ?? EMPTY;

const withNotes = (project: Project, update: (set: NoteSet) => NoteSet): Project => ({ ...project, notes: update(notesOf(project)) });

// ---------------------------------------------------------------- sources

/** A short, unique name for references ("memo ¶3"): the name's first word. */
const shortFor = (set: NoteSet, name: string): string => {
  const base = (name.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? 'notes').slice(0, 10);
  let short = base;
  for (let n = 2; set.sources.some((s) => s.short === short); n++) short = `${base}${n}`;
  return short;
};

/** Bring raw notes in. The text is kept exactly as it came and never changes. */
export const importSource = (project: Project, name: string, content: string, now = stamp()): { project: Project; id: string } => {
  const set = notesOf(project);
  const source: SourceDocument = { id: newId('src'), name: name.trim() || 'Notes', importedAt: now, content: content.replace(/\r\n?/g, '\n'), short: shortFor(set, name) };
  return { project: withNotes(project, (s) => ({ ...s, sources: [...s.sources, source] })), id: source.id };
};

export const removeSource = (project: Project, sourceId: string): Project =>
  withNotes(project, (s) => ({ ...s, sources: s.sources.filter((x) => x.id !== sourceId), notes: s.notes.filter((n) => n.sourceId !== sourceId) }));

export const sourceById = (project: Project, id: string): SourceDocument | undefined => notesOf(project).sources.find((s) => s.id === id);

/** A source's passages: each non-empty line, with where it sits. ¶ numbers count from 1. */
export interface Passage extends Range {
  index: number;
}

export const passagesOf = (source: SourceDocument): Passage[] => {
  const out: Passage[] = [];
  let at = 0;
  for (const line of source.content.split('\n')) {
    const lead = line.length - line.trimStart().length;
    const text = line.trim();
    if (text) out.push({ start: at + lead, end: at + lead + text.length, index: out.length + 1 });
    at += line.length + 1;
  }
  return out;
};

/** "memo ¶3": the source's short name and the passage a note starts in. */
export const refOf = (project: Project, note: Pick<ExtractedNote, 'sourceId' | 'range'>): string => {
  const source = sourceById(project, note.sourceId);
  if (!source) return 'source gone';
  const passage = passagesOf(source).find((p) => note.range.start < p.end && note.range.end > p.start) ?? passagesOf(source).find((p) => p.start >= note.range.start);
  return `${source.short} ¶${passage?.index ?? 1}`;
};

/** "Voice memo · Sep 22, ¶3": the long form, for a card's source link. */
export const longRefOf = (project: Project, note: ExtractedNote): string => {
  const source = sourceById(project, note.sourceId);
  return source ? `${source.name}, ${refOf(project, note).split(' ')[1]}` : 'its source was removed';
};

// ---------------------------------------------------------------- categories

export const categoriesOf = (project: Project): Category[] => [...notesOf(project).categories].sort((a, b) => a.order - b.order);
export const topCategories = (project: Project): Category[] => categoriesOf(project).filter((c) => !c.parentId);
export const childrenOf = (project: Project, id: string): Category[] => categoriesOf(project).filter((c) => c.parentId === id);

/** A category and every category under it. */
export const familyOf = (project: Project, id: string): string[] => [id, ...childrenOf(project, id).flatMap((c) => familyOf(project, c.id))];

export const addCategory = (project: Project, name: string, parentId?: string, templateKey?: string): { project: Project; id: string } => {
  const set = notesOf(project);
  const category: Category = {
    id: newId('cat'),
    name: name.trim() || 'New category',
    ...(parentId ? { parentId } : {}),
    ...(templateKey ? { templateKey } : {}),
    order: Math.max(0, ...set.categories.map((c) => c.order)) + 1,
  };
  return { project: withNotes(project, (s) => ({ ...s, categories: [...s.categories, category] })), id: category.id };
};

export const renameCategory = (project: Project, id: string, name: string): Project =>
  withNotes(project, (s) => ({ ...s, categories: s.categories.map((c) => (c.id === id && name.trim() ? { ...c, name: name.trim() } : c)) }));

/** Take a category away. Its cards and subcategories go up to its parent: no note is ever deleted by it. */
export const removeCategory = (project: Project, id: string): Project =>
  withNotes(project, (s) => {
    const gone = s.categories.find((c) => c.id === id);
    const up = gone?.parentId ?? null;
    return {
      ...s,
      categories: s.categories.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, ...(up ? { parentId: up } : { parentId: undefined }) } : c)),
      notes: s.notes.map((n) => (n.categoryId === id ? { ...n, categoryId: up } : n)),
    };
  });

/** Load a starting set (spec §5): only the categories not already there, by name. */
export const loadTemplate = (project: Project, key: string): Project => {
  const template = TEMPLATES.find((t) => t.key === key);
  if (!template) return project;
  let next = project;
  const named = (name: string, parentId?: string) => notesOf(next).categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && (c.parentId ?? undefined) === parentId);
  for (const t of template.categories) {
    let parent = named(t.name);
    if (!parent) {
      const made = addCategory(next, t.name, undefined, t.key);
      next = made.project;
      parent = notesOf(next).categories.find((c) => c.id === made.id)!;
    }
    for (const child of t.children ?? []) if (!named(child.name, parent.id)) next = addCategory(next, child.name, parent.id, child.key).project;
  }
  return withNotes(next, (s) => ({ ...s, template: key }));
};

// ---------------------------------------------------------------- notes

export const noteById = (project: Project, id: string): ExtractedNote | undefined => notesOf(project).notes.find((n) => n.id === id);

/** A category's cards, in order (its subcategories' too, with `deep`). */
export const notesIn = (project: Project, categoryId: string | null, deep = false): ExtractedNote[] => {
  const ids = categoryId && deep ? new Set(familyOf(project, categoryId)) : new Set([categoryId]);
  return notesOf(project)
    .notes.filter((n) => ids.has(n.categoryId))
    .sort((a, b) => a.order - b.order);
};

/** Shrink a range to the words in it, leaving out the spaces at either end. */
const trim = (content: string, range: Range): Range => {
  let { start, end } = range;
  while (start < end && /\s/.test(content[start]!)) start++;
  while (end > start && /\s/.test(content[end - 1]!)) end--;
  return { start, end };
};

/**
 * Drop a passage on a category (spec §6): a card, at once, with no dialog.
 * The passage in the source is only marked as sorted, never taken out.
 */
export const extract = (project: Project, sourceId: string, range: Range, categoryId: string | null, now = stamp()): { project: Project; id: string } | null => {
  const source = sourceById(project, sourceId);
  if (!source) return null;
  const r = trim(source.content, { start: Math.max(0, Math.min(range.start, range.end)), end: Math.min(source.content.length, Math.max(range.start, range.end)) });
  if (r.end <= r.start) return null;
  const set = notesOf(project);
  const note: ExtractedNote = {
    id: newId('note'),
    sourceId,
    range: r,
    text: source.content.slice(r.start, r.end).replace(/\s*\n\s*/g, ' '),
    categoryId,
    order: Math.max(0, ...set.notes.filter((n) => n.categoryId === categoryId).map((n) => n.order)) + 1,
    created: now,
    destinations: [],
    dependencies: [],
    flowPlacements: [],
  };
  return { project: withNotes(project, (s) => ({ ...s, notes: [...s.notes, note] })), id: note.id };
};

export type NotePatch = Partial<Pick<ExtractedNote, 'text' | 'name' | 'setAside' | 'categoryId'>>;

export const updateNote = (project: Project, id: string, patch: NotePatch): Project =>
  withNotes(project, (s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));

/** Give a passage back to the source: the card goes, and the words are unsorted again. */
export const removeNote = (project: Project, id: string): Project =>
  withNotes(project, (s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id).map((n) => ({ ...n, dependencies: n.dependencies.filter((d) => d.targetId !== id) })) }));

/** Move a card to a category, before another card there (or to the end). */
export const moveNote = (project: Project, id: string, categoryId: string | null, beforeId?: string): Project =>
  withNotes(project, (s) => {
    const note = s.notes.find((n) => n.id === id);
    if (!note) return s;
    const others = s.notes.filter((n) => n.categoryId === categoryId && n.id !== id).sort((a, b) => a.order - b.order);
    const at = beforeId ? others.findIndex((n) => n.id === beforeId) : -1;
    const ordered = at < 0 ? [...others, note] : [...others.slice(0, at), note, ...others.slice(at)];
    const order = new Map(ordered.map((n, i) => [n.id, i + 1]));
    return { ...s, notes: s.notes.map((n) => (order.has(n.id) ? { ...n, categoryId, order: order.get(n.id)! } : n)) };
  });

/**
 * Merge one card into another: one card, both passages kept as its sources,
 * and everything either became or was linked to.
 */
export const mergeNotes = (project: Project, intoId: string, fromId: string): Project =>
  withNotes(project, (s) => {
    const into = s.notes.find((n) => n.id === intoId);
    const from = s.notes.find((n) => n.id === fromId);
    if (!into || !from || into === from) return s;
    const merged: ExtractedNote = {
      ...into,
      text: `${into.text}\n${from.text}`,
      merged: [...(into.merged ?? []), { sourceId: from.sourceId, range: from.range }, ...(from.merged ?? [])],
      destinations: [...into.destinations, ...from.destinations],
      dependencies: [...into.dependencies, ...from.dependencies].filter((d) => d.targetId !== intoId && d.targetId !== fromId),
      flowPlacements: [...into.flowPlacements, ...from.flowPlacements],
    };
    return {
      ...s,
      notes: s.notes
        .filter((n) => n.id !== fromId)
        .map((n) => (n.id === intoId ? merged : { ...n, dependencies: n.dependencies.map((d) => (d.targetId === fromId ? { ...d, targetId: intoId } : d)) })),
    };
  });

/** Link a card to another card or a game object (spec §13). */
export const linkNote = (project: Project, id: string, verb: Verb, targetId: string): Project =>
  withNotes(project, (s) => ({
    ...s,
    notes: s.notes.map((n) => (n.id === id && targetId !== id && !n.dependencies.some((d) => d.verb === verb && d.targetId === targetId) ? { ...n, dependencies: [...n.dependencies, { verb, targetId }] } : n)),
  }));

export const unlinkNote = (project: Project, id: string, verb: Verb, targetId: string): Project =>
  withNotes(project, (s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, dependencies: n.dependencies.filter((d) => !(d.verb === verb && d.targetId === targetId)) } : n)) }));

// ---------------------------------------------------------------- status

/** A destination still there: its object exists (a dialogue block waiting for a scene counts). */
export const liveDestinations = (project: Project, note: ExtractedNote) =>
  note.destinations.filter((d) => (d.objectType === 'dialogue' ? !d.objectId || project.lines.some((l) => l.id === d.objectId) : !!project.objects[d.objectId]));

/** Is the object still where the note put it? Moved off the spine on the graph, it isn't placed any more. */
export const livePlacements = (project: Project, note: ExtractedNote) =>
  note.flowPlacements.filter((p) => {
    const line = project.lines.find((l) => l.id === p.objectId);
    if (!project.objects[p.objectId] && !line) return false;
    switch (p.target) {
      case 'spine':
      case 'playerLane':
        return project.placements[p.objectId]?.laneId === p.targetId && project.lanes.some((l) => l.id === p.targetId);
      case 'sceneLayer':
        return !!project.objects[p.targetId] && (!line || line.sceneId === p.targetId);
      case 'level':
        return !!project.levels?.levels.some((l) => l.id === p.targetId);
      default:
        return true;
    }
  });

export const statusOf = (project: Project, note: ExtractedNote): NoteStatus => {
  if (note.setAside) return 'setAside';
  if (livePlacements(project, note).length) return 'placed';
  if (liveDestinations(project, note).length) return 'converted';
  return 'sorted';
};

/** Every range of a source some card was taken from. */
const coveredIn = (set: NoteSet, sourceId: string): { range: Range; note: ExtractedNote }[] =>
  set.notes.flatMap((n) => [
    ...(n.sourceId === sourceId ? [{ range: n.range, note: n }] : []),
    ...(n.merged ?? []).filter((m) => m.sourceId === sourceId).map((m) => ({ range: m.range, note: n })),
  ]);

/** A source's text in runs: each either unsorted or taken by one or more cards. */
export interface Segment extends Range {
  notes: ExtractedNote[];
}

export const segmentsOf = (project: Project, source: SourceDocument, within: Range = { start: 0, end: source.content.length }): Segment[] => {
  const covered = coveredIn(notesOf(project), source.id).filter((c) => c.range.end > within.start && c.range.start < within.end);
  const cuts = new Set([within.start, within.end]);
  for (const c of covered) {
    cuts.add(Math.max(within.start, c.range.start));
    cuts.add(Math.min(within.end, c.range.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const notes = covered.filter((c) => c.range.start <= start && c.range.end >= end).map((c) => c.note);
    const last = out[out.length - 1];
    if (last && last.notes.length === 0 && notes.length === 0) last.end = end;
    else out.push({ start, end, notes });
  }
  return out;
};

const RANK: Record<NoteStatus, number> = { unsorted: 0, setAside: 1, sorted: 2, converted: 3, placed: 4 };

/** How much of a source has got how far, by its words (spaces aside). */
export interface Progress {
  unsorted: number;
  sorted: number;
  converted: number;
  placed: number;
  setAside: number;
  /** Fraction of the text taken into cards at all. */
  ratio: number;
  passages: number;
  untouched: number;
}

export const progressOf = (project: Project, source: SourceDocument): Progress => {
  const counts: Progress = { unsorted: 0, sorted: 0, converted: 0, placed: 0, setAside: 0, ratio: 0, passages: 0, untouched: 0 };
  for (const seg of segmentsOf(project, source)) {
    const words = source.content.slice(seg.start, seg.end).replace(/\s/g, '').length;
    const best = seg.notes.map((n) => statusOf(project, n)).sort((a, b) => RANK[b] - RANK[a])[0] ?? 'unsorted';
    counts[best] += words;
  }
  const total = counts.unsorted + counts.sorted + counts.converted + counts.placed + counts.setAside;
  counts.ratio = total ? (total - counts.unsorted) / total : 0;
  const passages = passagesOf(source);
  const covered = coveredIn(notesOf(project), source.id);
  counts.passages = passages.length;
  counts.untouched = passages.filter((p) => !covered.some((c) => c.range.start < p.end && c.range.end > p.start)).length;
  return counts;
};

/** Where every note stands, across every source (Review's left column, and the header). */
export const standing = (project: Project): Record<NoteStatus, number> & { passages: number } => {
  const set = notesOf(project);
  const out = { unsorted: 0, sorted: 0, converted: 0, placed: 0, setAside: 0, passages: 0 };
  for (const source of set.sources) {
    const p = progressOf(project, source);
    out.unsorted += p.untouched;
    out.passages += p.passages;
  }
  for (const note of set.notes) out[statusOf(project, note)]++;
  return out;
};

/** Cards whose text, name or source matches every word typed. */
export const searchNotes = (project: Project, query: string, within: ExtractedNote[] = notesOf(project).notes): ExtractedNote[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return within;
  return within.filter((n) => {
    const hay = `${n.text} ${n.name ?? ''} ${refOf(project, n)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
};
