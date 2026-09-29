/**
 * Syncing the player's codex notes: every note with when it was last changed
 * (a note taken off is kept as an empty one, so the taking off syncs too).
 * Two copies merge by keeping, for each entry, the newer of the two. The same
 * file format and rule as the engines' codex sync (docs/ENGINE-ADAPTERS.md).
 */

export const SYNC_FORMAT = 'vcgs-codex-notes-sync';

/** A note and when it was last changed (milliseconds since 1970); an empty text is a note taken off. */
export interface StampedNote {
  text: string;
  at: number;
}

export interface NotesSync {
  format: typeof SYNC_FORMAT;
  version: 1;
  story: string;
  notes: Record<string, StampedNote>;
}

/** The notes as a sync file's text. */
export const notesSyncText = (story: string, notes: ReadonlyMap<string, StampedNote>): string =>
  JSON.stringify({ format: SYNC_FORMAT, version: 1, story, notes: Object.fromEntries([...notes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) } satisfies NotesSync, null, 2);

/** The notes in a sync file's text, or null when it is not one. */
export const notesFromSync = (text: string): Map<string, StampedNote> | null => {
  try {
    const data = JSON.parse(text) as Partial<NotesSync>;
    if (data?.format !== SYNC_FORMAT || typeof data.notes !== 'object' || !data.notes) return null;
    const notes = new Map<string, StampedNote>();
    for (const [key, n] of Object.entries(data.notes))
      if (n && typeof n.text === 'string' && typeof n.at === 'number' && Number.isFinite(n.at)) notes.set(key, { text: n.text, at: n.at });
    return notes;
  } catch {
    return null;
  }
};

/**
 * Merge two copies: for each entry, the newer note wins (on a tie, ours).
 * Returns the merged notes and how many of ours the other copy changed.
 */
export const mergeNotes = (ours: ReadonlyMap<string, StampedNote>, theirs: ReadonlyMap<string, StampedNote>): { notes: Map<string, StampedNote>; changed: number } => {
  const notes = new Map(ours);
  let changed = 0;
  for (const [key, n] of theirs) {
    const mine = notes.get(key);
    if (!mine || n.at > mine.at) {
      if ((mine?.text ?? '') !== n.text) changed++;
      notes.set(key, n);
    }
  }
  return { notes, changed };
};

/** The notes as the codex shows them: those not taken off (as written; the codex trims them). */
export const liveNotes = (notes: ReadonlyMap<string, StampedNote>): Map<string, string> => new Map([...notes].filter(([, n]) => n.text.trim()).map(([k, n]) => [k, n.text]));

/** Where the preview keeps a project's notes in the browser, to sync its windows. */
export const notesStorageKey = (projectId: string) => `vcgs.codexNotes.${projectId}`;
