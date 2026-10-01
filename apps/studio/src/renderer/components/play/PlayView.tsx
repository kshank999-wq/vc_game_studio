import { useEffect, useMemo, useRef, useState } from 'react';
import type { Destination } from '../../model/details';
import { interactionsOf, statesOf } from '../../model/details';
import { screenOf } from '../../model/puzzle/screens';
import { ScreenPlayer } from '../puzzle/ScreenPlayer';
import { checkAllPaths } from '../../model/paths';
import { advance, carriedMark, choose, codexNotesFrom, codexNotesText, notesMailto, notesPrintHtml, notesSms, NOTE_LABEL, CODEX_SECTION_NAMES, CODEX_SORTS, type CodexSort, codexOf, codexProgress, codexSectionKeys, codexSections, type CodexSection, craft, endFreePlay, gear, interact, learn, screenWrong, playToDecision, promptOf, setWorld, startPlay, type Entry, type Play, type PlayWorld, type Voice } from '../../model/play';
import type { ObjectType, Project } from '../../model/types';
import { CraftSection, GearSection, SkillsSection } from './GearPanels';
import { PathsPanel } from './PathsPanel';
import { SavesPanel } from './SavesPanel';
import { copyText, downloadText, notesFileNameFor, notesPageNameFor, printHtml, readText } from '../../files';
import { liveNotes, mergeNotes, notesFromSync, notesStorageKey, notesSyncText, type StampedNote } from '../../model/codex-sync';
import { Symbol } from '../Symbol';
import { Inline } from '../Inline';

interface Props {
  project: Project;
  /** Start here (a node on the graph) instead of at the Beginning. */
  from?: string;
  onNavigate: (to: Destination) => void;
  /** Saving expected paths changes the project (one undo step each). */
  onCommit?: (project: Project) => void;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

const VoiceView = ({ voice }: { voice: Voice }) => (
  <div className="play-line">
    <div className="play-speaker">{voice.speaker?.toUpperCase() ?? 'NO SPEAKER'}</div>
    {voice.direction && <div className="play-direction">({voice.direction})</div>}
    <div className="play-said">{voice.text ? <Inline text={voice.text} /> : '…'}</div>
  </div>
);

const EntryView = ({ entry }: { entry: Entry }) => {
  switch (entry.kind) {
    case 'heading':
      return (
        <div className="play-heading">
          <div className="play-slug">{entry.text}</div>
          {entry.sub && <div className="play-sub">{entry.sub}</div>}
        </div>
      );
    case 'line':
      // Dual dialogue: both voices at once, side by side as the script sets them.
      return entry.with ? (
        <div className="play-dual" role="group" aria-label="Spoken at the same time">
          <VoiceView voice={entry} />
          <VoiceView voice={entry.with} />
        </div>
      ) : (
        <VoiceView voice={entry} />
      );
    case 'action':
      return (
        <div className="play-action">
          {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'cinematic':
      return (
        <div className="play-cinematic">
          <div>
            <Symbol type="cinematic" size={12} /> {entry.text}
            {entry.detail && <span className="play-note"> · {entry.detail}</span>}
            {entry.skippable === false && <span className="play-note"> · can’t be skipped</span>}
          </div>
          {entry.shots && (
            <ol className="play-shots">
              {entry.shots.map((s) => (
                <li key={s}>{s.replace(/^\d+\. /, '')}</li>
              ))}
            </ol>
          )}
        </div>
      );
    case 'picked':
      return <div className="play-picked">▸ {entry.text}</div>;
    case 'did':
      return <div className="play-picked">▸ {entry.text}</div>;
    case 'effect':
      return <div className="play-effect">{entry.text}</div>;
    case 'fired':
      return <div className="play-fired">⚡ {entry.text}</div>;
    case 'hint':
      return (
        <div className="play-hint">
          💡 Hint · {entry.detail}: {entry.text}
        </div>
      );
    case 'skip':
      return (
        <div className="play-skip" title={`Needs: ${entry.needs}`}>
          Skipped {entry.text} <span className="play-note">— needs {entry.needs}</span>
        </div>
      );
    case 'quest':
      return (
        <div className={`play-quest ${entry.state}`}>
          <Symbol type="quest" size={12} /> {entry.state === 'done' ? 'Quest complete' : 'New quest'}: {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'encounter':
      return (
        <div className="play-encounter">
          <Symbol type="encounter" size={12} /> {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'lore':
      return (
        <div className="play-lore">
          <Symbol type="lore" size={12} /> Discovered: {entry.text}
        </div>
      );
    case 'mechanic':
      return (
        <div className="play-mechanic">
          <Symbol type="mechanic" size={12} /> Now available: {entry.text}
        </div>
      );
    case 'skill':
      return (
        <div className="play-skill">
          <Symbol type="skill" size={12} /> Learned: {entry.text}
          {entry.ranks > 1 && <span className="play-note"> · rank {entry.rank} of {entry.ranks}</span>}
        </div>
      );
    case 'gear':
      return (
        <div className="play-gear">
          <Symbol type="inventory" size={12} /> {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'craft':
      return (
        <div className="play-gear play-craft">
          <Symbol type="inventory" size={12} /> {entry.text}
          <span className="play-note"> · {entry.detail}</span>
        </div>
      );
    case 'end':
      return <div className="play-end">{entry.text}</div>;
  }
};

/** The codex as the player would read it: the quest log, the characters met, the locations visited, the items found, the objects used, the mechanics, the encounters met, then the lore found. */
const CodexPanel = ({
  project,
  world,
  onClose,
  bookmarks,
  onBookmark,
  notes,
  onNote,
  onImportNotes,
  synced,
}: {
  project: Project;
  world: PlayWorld;
  onClose: () => void;
  /** Entry keys ("lore:…") the player has bookmarked. */
  bookmarks: ReadonlySet<string>;
  onBookmark: (key: string) => void;
  /** The player's notes on entries, by entry key. */
  notes: ReadonlyMap<string, string>;
  onNote: (key: string, text: string) => void;
  /** Notes read from an exported file, by entry key, to set (the others stay). */
  onImportNotes: (notes: ReadonlyMap<string, string>) => void;
  /** What the last sync from elsewhere changed, if anything. */
  synced: string;
}) => {
  const c = codexOf(project, world);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<CodexSection['key'] | 'bookmarks' | ''>('');
  const [sort, setSort] = useState<CodexSort>('found');
  const search = useRef<HTMLInputElement>(null);
  const keys = codexSectionKeys(project, world);
  // The entries shown, by section and in order (the same rules as the engines' codex).
  const shown = new Map(codexSections(project, world, query, section, sort, bookmarks, notes).map((s) => [s.key, s.entries.map((e) => e.id)]));
  // Importing notes: the file picker, and what the last import did.
  const notesFile = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState('');
  /** Take notes from exported or shared text: set those that match, and say what happened. */
  const takeNotes = (text: string) => {
    const read = codexNotesFrom(project, world, text);
    onImportNotes(read.notes);
    const got = `Imported ${read.notes.size} note${read.notes.size === 1 ? '' : 's'}`;
    setImported(read.skipped.length ? `${got}. Not in the codex (yet): ${read.skipped.join('; ')}.` : `${got}.`);
  };
  const importNotes = async (file: File) => takeNotes(await readText(file));
  // Sharing: the share sheet where there is one, else the clipboard; and a box to paste shared notes into.
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  // Where neither a share sheet nor the clipboard can be used: the notes, to copy by hand.
  const [toCopy, setToCopy] = useState('');
  const shareNotes = async () => {
    const text = codexNotesText(project, world, notes);
    setToCopy('');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${project.name} codex notes`, text });
        setImported('Notes shared.');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Refused (an embedded page, say): copy them instead.
      }
    }
    const copied = await copyText(text);
    if (copied) setImported('Notes copied. Paste them to share them; in another codex, Paste notes takes them in.');
    else {
      setToCopy(text);
      setImported('This page cannot copy by itself: the notes are below, selected. Copy them (Ctrl+C or ⌘C) to share them.');
    }
  };
  // Printing: the notes as a page, in the print dialog; where the page may not print, it is saved to print from.
  const PRINTING = 'Printing the notes. No print dialog? Save them as a page and print that.';
  const printNotes = async () => {
    const page = notesPrintHtml(codexNotesText(project, world, notes));
    setToCopy('');
    if (await printHtml(page)) {
      setImported(PRINTING);
    } else savePage();
  };
  const savePage = () => {
    downloadText(notesPageNameFor(project), notesPrintHtml(codexNotesText(project, world, notes)), 'text/html');
    setImported('This page cannot print by itself: the notes are saved as a page. Open it and print it.');
  };
  // Emailing or texting: a mail or text link with the notes, for the player's app; too long for a link, they go on the clipboard.
  const links = notes.size ? { mail: notesMailto(codexNotesText(project, world, notes)), sms: notesSms(codexNotesText(project, world, notes)) } : null;
  const APP = { mail: 'mail app', sms: 'messages app' } as const;
  const sendNotes = async (kind: 'mail' | 'sms') => {
    setToCopy('');
    const into = kind === 'mail' ? 'the mail' : 'the message';
    if (links?.[kind].whole) return setImported(`Opening your ${APP[kind]} with the notes. None opened? Share notes copies them, to paste into ${kind === 'mail' ? 'a mail' : 'a message'}.`);
    const text = codexNotesText(project, world, notes);
    const tooLong = `The notes are too long for a ${kind === 'mail' ? 'mail' : 'text'} link`;
    if (await copyText(text)) setImported(`${tooLong}: they are on the clipboard. Paste them into ${into}.`);
    else {
      setToCopy(text);
      setImported(`${tooLong}: they are below, selected. Copy them (Ctrl+C or ⌘C) and paste them into ${into}.`);
    }
  };
  /** A link that opens the mail or messages app with the notes (a disabled button with none). */
  const sendLink = (kind: 'mail' | 'sms', name: string, label: string, title: string) =>
    links ? (
      <a className="tb-btn small" aria-label={name} href={links[kind].url} target="_blank" rel="noopener noreferrer" title={title} onClick={() => void sendNotes(kind)}>
        {label}
      </a>
    ) : (
      <button className="tb-btn small" aria-label={name} disabled title="Write a note (✎) first">
        {label}
      </button>
    );
  // The entry whose note is being written, by key.
  const [editing, setEditing] = useState('');
  /** A pencil to write (or change) the player's note on an entry. */
  const pencil = (key: CodexSection['key'], id: string, name: string) => (
    <button
      className={`play-codex-star${notes.get(`${key}:${id}`) ? ' on' : ''}`}
      aria-label={`Note on ${name}`}
      aria-expanded={editing === `${key}:${id}`}
      title="Write a note"
      onClick={() => setEditing((k) => (k === `${key}:${id}` ? '' : `${key}:${id}`))}
    >
      ✎
    </button>
  );
  /** The note on an entry: a box while it is written, then the note itself. */
  const note = (key: CodexSection['key'], id: string, name: string) => {
    const k = `${key}:${id}`;
    if (editing === k)
      return (
        <input
          className="play-codex-search play-codex-note-edit"
          aria-label={`Your note on ${name}`}
          placeholder="Your note (Enter to keep it)"
          autoFocus
          value={notes.get(k) ?? ''}
          onChange={(e) => onNote(k, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing('');
            }
          }}
          onBlur={() => setEditing('')}
        />
      );
    const text = notes.get(k)?.trim();
    return text ? (
      <p className="play-codex-note">
        {NOTE_LABEL}
        {text}
      </p>
    ) : null;
  };
  /** A star to bookmark an entry (or take the bookmark off). */
  const star = (key: CodexSection['key'], id: string, name: string) => {
    const on = bookmarks.has(`${key}:${id}`);
    return (
      <button className={`play-codex-star${on ? ' on' : ''}`} aria-label={`Bookmark ${name}`} aria-pressed={on} title={on ? 'Remove the bookmark' : 'Bookmark it'} onClick={() => onBookmark(`${key}:${id}`)}>
        {on ? '★' : '☆'}
      </button>
    );
  };
  const found = query.trim() || section ? shown : null;
  const has = (key: CodexSection['key']) => !found || found.has(key);
  const keep = (key: CodexSection['key']) => (x: { id: string }) => !!shown.get(key)?.includes(x.id);
  const inOrder = (key: CodexSection['key']) => (a: { id: string }, b: { id: string }) => shown.get(key)!.indexOf(a.id) - shown.get(key)!.indexOf(b.id);
  useEffect(() => {
    // "/" goes to the search box, as in the engines' codex screens.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="play-codex" role="dialog" aria-label="Codex">
      <div className="play-codex-head">
        <span className="rule-label">Codex</span>
        <span className="pref-hint">What the player has found, as a codex screen shows it. Notes sync across this browser’s windows.</span>
        <button className="tb-btn small" onClick={onClose}>
          Close <kbd>C</kbd>
        </button>
        <div className="play-codex-notes-actions" role="group" aria-label="Notes">
          <span className="pref-hint">Notes</span>
          <button
            className="tb-btn small"
            aria-label="Export notes"
            disabled={!notes.size}
            title={notes.size ? 'Save every note as a text file' : 'Write a note (✎) first'}
            onClick={() => downloadText(notesFileNameFor(project), codexNotesText(project, world, notes))}
          >
            Export
          </button>
          <button className="tb-btn small" aria-label="Import notes" title="Read notes from an exported file" onClick={() => notesFile.current?.click()}>
            Import
          </button>
          <button className="tb-btn small" aria-label="Share notes" disabled={!notes.size} title={notes.size ? 'Share every note (or copy them)' : 'Write a note (✎) first'} onClick={() => void shareNotes()}>
            Share
          </button>
          {sendLink('mail', 'Email notes', 'Email', 'Email every note (from your mail app)')}
          {sendLink('sms', 'Text notes', 'Text', 'Text every note (from your messages app)')}
          <button className="tb-btn small" aria-label="Print notes" disabled={!notes.size} title={notes.size ? 'Print every note' : 'Write a note (✎) first'} onClick={() => void printNotes()}>
            Print
          </button>
          <button className="tb-btn small" aria-label="Paste notes" aria-expanded={pasting} title="Take in notes someone shared with you" onClick={() => setPasting((o) => !o)}>
            Paste
          </button>
        </div>
        <input
          ref={notesFile}
          type="file"
          accept=".txt,text/plain"
          aria-label="Notes file to import"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importNotes(file);
          }}
        />
      </div>
      {toCopy && (
        <textarea
          className="play-codex-search"
          aria-label="Notes to copy"
          readOnly
          rows={5}
          value={toCopy}
          ref={(el) => el?.select()}
          onBlur={() => setToCopy('')}
        />
      )}
      {pasting && (
        <div className="play-codex-paste">
          <textarea
            className="play-codex-search"
            aria-label="Shared notes to take in"
            placeholder="Paste the notes someone shared (CODEX NOTES · …)"
            rows={4}
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            className="tb-btn small"
            disabled={!pasted.trim()}
            onClick={() => {
              takeNotes(pasted);
              setPasted('');
              setPasting(false);
            }}
          >
            Take them in
          </button>
        </div>
      )}
      {synced && !imported && (
        <p className="play-note" role="status">
          {synced}
        </p>
      )}
      {imported && (
        <p className="play-note" role="status">
          {imported}
          {imported === PRINTING && (
            <>
              {' '}
              <button className="tb-btn small" onClick={savePage}>
                Save as a page
              </button>
            </>
          )}
        </p>
      )}
      <input
        ref={search}
        className="play-codex-search"
        type="search"
        aria-label="Search the codex"
        placeholder="Search the codex  ( / )"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears the search, then leaves the box (so C and Escape work again).
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery('');
            else e.currentTarget.blur();
          }
        }}
      />
      {keys.length > 1 && (
        <div className="play-codex-filters" role="group" aria-label="Codex sections">
          {(['', 'bookmarks', ...keys] as const).map((k) => (
            <button key={k || 'all'} className={`play-codex-filter${section === k ? ' on' : ''}`} aria-pressed={section === k} onClick={() => setSection(k)}>
              {k === 'bookmarks' ? `★ ${CODEX_SECTION_NAMES[k]}` : k ? CODEX_SECTION_NAMES[k] : 'All'}
            </button>
          ))}
        </div>
      )}
      <label className="play-codex-sort">
        <span className="pref-hint">Sort</span>
        <select aria-label="Sort the codex" value={sort} onChange={(e) => setSort(e.target.value as CodexSort)}>
          {CODEX_SORTS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {section === 'bookmarks' && !found?.size && !query.trim() && <p className="play-note">No bookmarks yet. Star an entry (☆) to keep it here.</p>}
      {found && !found.size && query.trim() && (
        <p className="play-note">
          Nothing matches “{query.trim()}”{section ? ` in ${CODEX_SECTION_NAMES[section]}` : ''}.
        </p>
      )}
      {c.quests > 0 && has('quests') && (
        <section aria-label="Quests">
          <h3>
            Quests <span className="play-note">· {c.underWay.length} under way, {c.done.length} done</span>
          </h3>
          {!c.underWay.length && !c.done.length && <p className="play-note">None yet.</p>}
          <ul className="play-codex-quests">
            {c.underWay.filter(keep('quests')).sort(inOrder('quests')).map((q) => (
              <li key={q.id}>
                {star('quests', q.id, q.name)} {pencil('quests', q.id, q.name)} <Symbol type="quest" size={11} /> <strong>{q.name}</strong>
                {q.goal && <span className="play-note"> — {q.goal}</span>}
                {note('quests', q.id, q.name)}
              </li>
            ))}
            {c.done.filter(keep('quests')).sort(inOrder('quests')).map((q) => (
              <li key={q.id} className="done">
                {star('quests', q.id, q.name)} {pencil('quests', q.id, q.name)} <Symbol type="quest" size={11} /> {q.name} <span className="play-note">(done)</span>
                {note('quests', q.id, q.name)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.charactersTotal > 0 && has('characters') && (
        <section aria-label="Characters">
          <h3>
            Characters <span className="play-note">· {c.characters.length} of {c.charactersTotal} met</span>
          </h3>
          {!c.characters.length && <p className="play-note">None yet.</p>}
          {c.characters.filter(keep('characters')).sort(inOrder('characters')).map((ch) => (
            <article key={ch.id} className="play-codex-lore play-codex-character">
              <h4>
                {star('characters', ch.id, ch.name)} {pencil('characters', ch.id, ch.name)} <Symbol type="character" size={11} /> {ch.name}
              </h4>
              <p>{ch.text}</p>
              {note('characters', ch.id, ch.name)}
            </article>
          ))}
        </section>
      )}
      {c.locationsTotal > 0 && has('locations') && (
        <section aria-label="Locations">
          <h3>
            Locations <span className="play-note">· {c.locations.length} of {c.locationsTotal} visited</span>
          </h3>
          {!c.locations.length && <p className="play-note">None yet.</p>}
          {c.locations.filter(keep('locations')).sort(inOrder('locations')).map((l) => (
            <article key={l.id} className="play-codex-lore play-codex-location">
              <h4>
                {star('locations', l.id, l.name)} {pencil('locations', l.id, l.name)} <Symbol type="environment" size={11} /> {l.name}
              </h4>
              <p>{l.text}</p>
              {note('locations', l.id, l.name)}
            </article>
          ))}
        </section>
      )}
      {c.itemsTotal > 0 && has('items') && (
        <section aria-label="Items">
          <h3>
            Items <span className="play-note">· {c.items.length} of {c.itemsTotal} found</span>
          </h3>
          {!c.items.length && <p className="play-note">None yet.</p>}
          {c.items.filter(keep('items')).sort(inOrder('items')).map((i) => (
            <article key={i.id} className="play-codex-lore play-codex-item">
              <h4>
                {star('items', i.id, i.name)} {pencil('items', i.id, i.name)} <Symbol type="inventory" size={11} /> {i.name}
                {i.carried > 0 && <span className="play-note">{carriedMark(i)}</span>}
              </h4>
              <p>{i.text}</p>
              {note('items', i.id, i.name)}
            </article>
          ))}
        </section>
      )}
      {c.objectsTotal > 0 && has('objects') && (
        <section aria-label="Objects">
          <h3>
            Objects <span className="play-note">· {c.objects.length} of {c.objectsTotal} used</span>
          </h3>
          {!c.objects.length && <p className="play-note">None yet.</p>}
          {c.objects.filter(keep('objects')).sort(inOrder('objects')).map((o) => (
            <article key={o.id} className="play-codex-lore play-codex-object">
              <h4>
                {star('objects', o.id, o.name)} {pencil('objects', o.id, o.name)} <Symbol type="object" size={11} /> {o.name}
                {o.state && <span className="play-note"> ({o.state})</span>}
              </h4>
              <p>{o.text}</p>
              {note('objects', o.id, o.name)}
            </article>
          ))}
        </section>
      )}
      {c.mechanicsTotal > 0 && has('mechanics') && (
        <section aria-label="Mechanics">
          <h3>
            Mechanics <span className="play-note">· {c.mechanics.length} of {c.mechanicsTotal} available</span>
          </h3>
          {!c.mechanics.length && <p className="play-note">None yet.</p>}
          {c.mechanics.filter(keep('mechanics')).sort(inOrder('mechanics')).map((m) => (
            <article key={m.id} className="play-codex-lore play-codex-mechanic">
              <h4>
                {star('mechanics', m.id, m.name)} {pencil('mechanics', m.id, m.name)} <Symbol type="mechanic" size={11} /> {m.name}
                {m.controls && <span className="play-note"> · {m.controls}</span>}
              </h4>
              <p>{m.text}</p>
              {note('mechanics', m.id, m.name)}
            </article>
          ))}
        </section>
      )}
      {c.skillsTotal > 0 && has('skills') && (
        <section aria-label="Skills">
          <h3>
            Skills <span className="play-note">· {c.skills.length} of {c.skillsTotal} learned</span>
          </h3>
          {!c.skills.length && <p className="play-note">None yet.</p>}
          {c.skills.filter(keep('skills')).sort(inOrder('skills')).map((k) => (
            <article key={k.id} className="play-codex-lore play-codex-skill">
              <h4>
                {star('skills', k.id, k.name)} {pencil('skills', k.id, k.name)} <Symbol type="skill" size={11} /> {k.name}
                <span className="play-note">
                  {' '}
                  · {k.kind}
                  {k.tree ? ` · ${k.tree}` : ''}
                  {k.ranks > 1 ? ` · rank ${k.rank} of ${k.ranks}` : ''}
                </span>
              </h4>
              {k.effect && <p className="play-codex-effect">{k.effect}</p>}
              <p>{k.text}</p>
              {note('skills', k.id, k.name)}
            </article>
          ))}
        </section>
      )}
      {c.encountersTotal > 0 && has('encounters') && (
        <section aria-label="Encounters">
          <h3>
            Encounters <span className="play-note">· {c.encounters.length} met, {c.encounters.filter((e) => e.won).length} won</span>
          </h3>
          {!c.encounters.length && <p className="play-note">None yet.</p>}
          {c.encounters.filter(keep('encounters')).sort(inOrder('encounters')).map((e) => (
            <article key={e.id} className="play-codex-lore play-codex-encounter">
              <h4>
                {star('encounters', e.id, e.name)} {pencil('encounters', e.id, e.name)} <Symbol type="encounter" size={11} /> {e.name}
                {e.won && <span className="play-note"> (won)</span>}
              </h4>
              {(e.enemies || e.weakness) && (
                <p className="play-note">{[e.enemies, e.weakness && `weak to ${e.weakness.toLowerCase()}`].filter(Boolean).join(' · ')}</p>
              )}
              <p>{e.text}</p>
              {note('encounters', e.id, e.name)}
            </article>
          ))}
        </section>
      )}
      {c.loreTotal > 0 && has('lore') && (
        <section aria-label="Lore">
          <h3>
            Lore <span className="play-note">· {c.lore.length} of {c.loreTotal} found</span>
          </h3>
          {!c.lore.length && <p className="play-note">Nothing found yet.</p>}
          {c.lore.filter(keep('lore')).sort(inOrder('lore')).map((l) => (
            <article key={l.id} className="play-codex-lore">
              <h4>
                {star('lore', l.id, l.name)} {pencil('lore', l.id, l.name)} <Symbol type="lore" size={11} /> {l.name}
              </h4>
              <p>{l.text}</p>
              {note('lore', l.id, l.name)}
            </article>
          ))}
        </section>
      )}
    </div>
  );
};

/** The world, which the designer can change by hand to try another path. */
const WorldPanel = ({ project, world, onChange, onLearn, onGear, onCraft }: { project: Project; world: PlayWorld; onChange: (change: (w: PlayWorld) => PlayWorld) => void; onLearn: (id: string) => void; onGear: (id: string, act: 'equip' | 'unequip' | 'use') => void; onCraft: (id: string) => void }) => {
  const of = (type: ObjectType) =>
    Object.values(project.objects)
      .filter((o) => o.type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
  const states = of('state');
  const items = of('inventory');
  const objects = of('object').filter((o) => statesOf(o).length);
  const characters = of('character');
  const quests = of('quest');
  const known = (type: 'lore' | 'mechanic') => of(type);
  const toggles = (type: 'lore' | 'mechanic', title: string, label: string) => {
    const list = known(type);
    const key = type === 'lore' ? 'lore' : 'mechanics';
    return list.length > 0 ? (
      <section>
        <h3>{title}</h3>
        {list.map((o) => (
          <label key={o.id} className="play-row">
            <span>{o.name}</span>
            <input
              type="checkbox"
              className="pref-switch"
              aria-label={`${label} ${o.name}`}
              checked={!!world[key][o.id]}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                onChange((w) => {
                  const next = { ...w[key] };
                  if (on) next[o.id] = true;
                  else delete next[o.id];
                  return { ...w, [key]: next };
                });
              }}
            />
          </label>
        ))}
      </section>
    ) : null;
  };
  const chosen = Object.entries(world.chosen).filter(([id]) => project.objects[id]);
  const named = (record: Record<string, boolean>) => Object.keys(record).filter((id) => record[id] && project.objects[id]).map((id) => project.objects[id]!.name);
  return (
    <aside className="play-world" aria-label="The world">
      <div className="play-world-head">
        <span className="rule-label">The world</span>
        <span className="pref-hint">Change anything to try another path.</span>
      </div>
      {states.length > 0 && (
        <section>
          <h3>States</h3>
          {states.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select className="inp" value={world.flags[o.id] ?? ''} onChange={(e) => onChange((w) => ({ ...w, flags: { ...w.flags, [o.id]: e.currentTarget.value } }))}>
                {statesOf(o).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      {items.length > 0 && (
        <section>
          <h3>Carried</h3>
          {items.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <input
                type="checkbox"
                className="pref-switch"
                checked={(world.items[o.id] ?? 0) > 0}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  onChange((w) => ({ ...w, items: { ...w.items, [o.id]: on ? Math.max(1, w.items[o.id] ?? 0) : 0 } }));
                }}
              />
            </label>
          ))}
        </section>
      )}
      {objects.length > 0 && (
        <section>
          <h3>Objects</h3>
          {objects.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select className="inp" value={world.objects[o.id] ?? ''} onChange={(e) => onChange((w) => ({ ...w, objects: { ...w.objects, [o.id]: e.currentTarget.value } }))}>
                {statesOf(o).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      {characters.length > 0 && (
        <section>
          <h3>Arcs</h3>
          {characters.map((o) => (
            <div key={o.id} className="play-row">
              <span>{o.name}</span>
              <span className="play-arc">
                <button className="icon-btn small" aria-label={`${o.name} −1`} onClick={() => onChange((w) => ({ ...w, arcs: { ...w.arcs, [o.id]: (w.arcs[o.id] ?? 0) - 1 } }))}>
                  −
                </button>
                <span className="mono">{world.arcs[o.id] ?? 0}</span>
                <button className="icon-btn small" aria-label={`${o.name} +1`} onClick={() => onChange((w) => ({ ...w, arcs: { ...w.arcs, [o.id]: (w.arcs[o.id] ?? 0) + 1 } }))}>
                  +
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      {quests.length > 0 && (
        <section>
          <h3>Quests</h3>
          {quests.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select
                className="inp"
                aria-label={`Quest ${o.name}`}
                value={world.quests[o.id] ?? ''}
                onChange={(e) => {
                  const state = e.currentTarget.value;
                  onChange((w) => {
                    const next = { ...w.quests };
                    if (state === 'active' || state === 'done') next[o.id] = state;
                    else delete next[o.id];
                    return { ...w, quests: next };
                  });
                }}
              >
                <option value="">Not started</option>
                <option value="active">Under way</option>
                <option value="done">Done</option>
              </select>
            </label>
          ))}
        </section>
      )}
      <GearSection project={project} world={world} onGear={onGear} />
      <CraftSection project={project} world={world} onCraft={onCraft} />
      <SkillsSection project={project} world={world} onLearn={onLearn} />
      {toggles('mechanic', 'Mechanics', 'Available:')}
      {toggles('lore', 'Lore', 'Discovered:')}
      <section>
        <h3>So far</h3>
        <dl className="play-facts">
          <dt>Choices</dt>
          <dd>{chosen.length ? chosen.map(([id, label]) => `${project.objects[id]!.name}: ${label}`).join(' · ') : 'none yet'}</dd>
          <dt>Solved</dt>
          <dd>{named(world.solved).join(' · ') || 'nothing yet'}</dd>
          <dt>Won</dt>
          <dd>{named(world.won).join(' · ') || 'no encounters yet'}</dd>
          <dt>Fired</dt>
          <dd>{named(world.fired).join(' · ') || 'nothing yet'}</dd>
          <dt>Visited</dt>
          <dd>{named(world.visited).join(' · ') || 'nowhere yet'}</dd>
        </dl>
      </section>
    </aside>
  );
};

/**
 * Play the story through, as the engine will: lines and actions in order,
 * choices with their options (those not on offer say what they need), free
 * play with the scene's objects to use, and the ending it reaches.
 */
export const PlayView = ({ project, from, onNavigate, onCommit }: Props) => {
  const [history, setHistory] = useState<Play[]>(() => [startPlay(project, from)]);
  const play = history[history.length - 1]!;
  const prompt = useMemo(() => promptOf(project, play), [project, play]);
  const push = (next: Play) => next !== play && setHistory((h) => [...h, next]);
  /** A screen puzzle up in free play (puzzle spec §8): solved, its interaction is used. */
  const [onScreen, setOnScreen] = useState<{ objectId: string; interactionId: string } | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const [savesOpen, setSavesOpen] = useState(false);
  const [pathsOpen, setPathsOpen] = useState(false);
  const pathsFailing = useMemo(() => (pathsOpen || !project.paths?.length ? 0 : checkAllPaths(project).filter((r) => !r.check.ok).length), [project, pathsOpen]);
  // The player's bookmarks in the codex: kept for the whole play-through, stepping back or not.
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set());
  // And the player's notes on entries, the same way.
  // Each with when it was last changed (a note taken off stays, empty), so they can sync.
  const [stamped, setStamped] = useState<ReadonlyMap<string, StampedNote>>(new Map());
  const notes = useMemo(() => liveNotes(stamped), [stamped]);
  const [synced, setSynced] = useState('');
  const setNote = (key: string, text: string) => setStamped((n) => new Map(n).set(key, { text, at: Date.now() }));
  // Sync: the notes are kept in the browser too, so every window of the studio (and the next visit) has the same ones.
  const storageKey = notesStorageKey(project.id);
  const syncWith = (stored: string | null, from: string) => {
    const theirs = stored ? notesFromSync(stored) : null;
    if (!theirs) return;
    setStamped((ours) => {
      const merged = mergeNotes(ours, theirs);
      if (!merged.changed) return ours;
      setSynced(`Notes synced: ${merged.changed} changed ${from}.`);
      return merged.notes;
    });
  };
  useEffect(() => {
    try {
      syncWith(localStorage.getItem(storageKey), 'from before');
    } catch {
      // No storage here (a private window, say): the notes stay in this window.
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) syncWith(e.newValue, 'in another window');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);
  useEffect(() => {
    if (!stamped.size) return;
    try {
      const stored = localStorage.getItem(storageKey);
      const merged = mergeNotes(stamped, (stored && notesFromSync(stored)) || new Map()).notes;
      const text = notesSyncText(project.name, merged);
      if (text !== stored) localStorage.setItem(storageKey, text);
    } catch {
      // No storage here: nothing to sync with.
    }
  }, [stamped, storageKey]);
  // What the codex had when last read, for its "new" count.
  const [seen, setSeen] = useState(0);
  const progress = codexProgress(project, play.world);
  const book = codexOf(project, play.world);
  const hasCodex = book.quests + book.charactersTotal + book.locationsTotal + book.itemsTotal + book.objectsTotal + book.mechanicsTotal + book.skillsTotal + book.encountersTotal + book.loreTotal > 0;
  const fresh = Math.max(0, progress - seen);
  useEffect(() => {
    // Read while open; after a step back there is less to have read.
    if (codexOpen || progress < seen) setSeen(progress);
  }, [codexOpen, progress, seen]);
  const restart = () => {
    setHistory([startPlay(project, from)]);
    setSeen(0);
  };

  useEffect(() => {
    const el = transcript.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  }, [play.log.length, prompt.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (savesOpen || pathsOpen) {
        if (e.key === 'Escape') {
          setSavesOpen(false);
          setPathsOpen(false);
        }
        return;
      }
      if (hasCodex && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setCodexOpen((o) => !o);
        return;
      }
      if (codexOpen) {
        if (e.key === 'Escape') setCodexOpen(false);
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && prompt.kind === 'continue') {
        e.preventDefault();
        push(advance(project, play));
      } else if (prompt.kind === 'choice' && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (prompt.options[i]?.available) push(choose(project, play, i));
      } else if (e.key === 'Backspace' && history.length > 1) {
        e.preventDefault();
        setHistory((h) => h.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const here = play.where.sceneId ?? play.where.nodeId;
  const hereName = here ? `${project.objects[here]?.data.code ?? ''} ${project.objects[here]?.name ?? ''}`.trim() : '';

  return (
    <div className="play-view">
      <section className="play-stage">
        <div className="play-bar">
          <span className="rule-label">Play-through</span>
          <span className="play-where">{hereName && `Now in ${hereName}`}</span>
          <div className="grow" />
          <button className="tb-btn small" disabled={history.length < 2} title="Step back (Backspace)" onClick={() => setHistory((h) => h.slice(0, -1))}>
            ↶ Step back
          </button>
          <button className="tb-btn small" disabled={prompt.kind !== 'continue'} onClick={() => push(playToDecision(project, play))}>
            ⏭ To the next decision
          </button>
          <button className="tb-btn small" onClick={restart}>
            ⟲ Restart
          </button>
          <button
            className={`tb-btn small${savesOpen ? ' on' : ''}`}
            aria-pressed={savesOpen}
            title="Save the play-through, or load a saved one"
            onClick={() => {
              setSavesOpen(!savesOpen);
              setCodexOpen(false);
              setPathsOpen(false);
            }}
          >
            Saves
          </button>
          <button
            className={`tb-btn small${pathsOpen ? ' on' : ''}`}
            aria-pressed={pathsOpen}
            title="Expected paths: save a run, and check the story still goes that way"
            onClick={() => {
              setPathsOpen(!pathsOpen);
              setSavesOpen(false);
              setCodexOpen(false);
            }}
          >
            Paths{pathsFailing > 0 && <span className="play-codex-new play-paths-failing"> · {pathsFailing} ✗</span>}
          </button>
          {hasCodex && (
            <button className={`tb-btn small${codexOpen ? ' on' : ''}`} aria-pressed={codexOpen} title="The codex: quests and lore found (C)" onClick={() => (setCodexOpen(!codexOpen), setSavesOpen(false), setPathsOpen(false))}>
              Codex{fresh > 0 && <span className="play-codex-new"> · {fresh} new</span>}
            </button>
          )}
          {here && (
            <button
              className="tb-btn small"
              onClick={() => (play.where.sceneId ? onNavigate({ kind: 'scene', sceneId: play.where.sceneId, mode: 'timeline' }) : onNavigate({ kind: 'graph', id: here }))}
            >
              Show in the studio
            </button>
          )}
        </div>
        {pathsOpen && <PathsPanel project={project} play={play} from={from} onCommit={onCommit} onShow={push} onClose={() => setPathsOpen(false)} />}
        {savesOpen && <SavesPanel project={project} play={play} onLoad={push} onClose={() => setSavesOpen(false)} />}
        {codexOpen && (
          <CodexPanel
            project={project}
            world={play.world}
            onClose={() => setCodexOpen(false)}
            bookmarks={bookmarks}
            notes={notes}
            synced={synced}
            onImportNotes={(read) =>
              setStamped((n) => {
                const next = new Map(n);
                for (const [key, text] of read) next.set(key, { text, at: Date.now() });
                return next;
              })
            }
            onNote={setNote}
            onBookmark={(key) =>
              setBookmarks((b) => {
                const next = new Set(b);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
          />
        )}
        <div className="play-transcript" ref={transcript} aria-live="polite">
          {play.log.map((entry, i) => (
            <EntryView key={i} entry={entry} />
          ))}
        </div>
        <div className="play-prompt">
          {prompt.kind === 'continue' && (
            <button className="tb-btn primary play-continue" autoFocus onClick={() => push(advance(project, play))}>
              Continue <kbd>↵</kbd>
            </button>
          )}
          {prompt.kind === 'choice' && (
            <div className="play-choice">
              <div className="play-choice-title">
                <Symbol type={prompt.symbol ?? 'choice'} size={12} /> {prompt.prompt || prompt.title}
              </div>
              {prompt.options.map((o, i) => (
                <button key={i} className="play-option" disabled={!o.available} title={o.needs ? `Needs: ${o.needs}` : undefined} onClick={() => push(choose(project, play, i))}>
                  <kbd>{i + 1}</kbd>
                  <span>{o.label}</span>
                  {o.needs && <span className="play-needs">needs {o.needs}</span>}
                </button>
              ))}
            </div>
          )}
          {prompt.kind === 'freePlay' && (
            <div className="play-free">
              <div className="play-choice-title">
                {prompt.title} <span className="play-note">· free play, ends {prompt.endsByRule ? `when ${prompt.ends}` : prompt.ends}</span>
              </div>
              <div className="play-objects">
                {prompt.objects.length === 0 && <span className="play-note">Nothing in this scene can be used.</span>}
                {prompt.objects.map((o) => (
                  <div key={o.id} className="play-object">
                    <div className="play-object-name">
                      <Symbol type="object" size={11} /> {o.name}
                      {o.state && <span className="play-note"> · {o.state}</span>}
                    </div>
                    {o.verbs.map((v) => (
                      <button key={v.id} className="tb-btn small" disabled={!v.available} title={v.available ? v.does : `Needs: ${v.needs}`} onClick={() => (interactionsOf(project.objects[o.id]).find((i) => i.id === v.id)?.screen && screenOf(project.objects[o.id]) ? setOnScreen({ objectId: o.id, interactionId: v.id }) : push(interact(project, play, o.id, v.id)))}>
                        {v.verb}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {onScreen && screenOf(project.objects[onScreen.objectId]) && (
                <ScreenPlayer
                  project={project}
                  screen={screenOf(project.objects[onScreen.objectId])!}
                  seed={onScreen.objectId}
                  title={project.objects[onScreen.objectId]!.name}
                  triesUsed={play.world.screenFails?.[onScreen.objectId] ?? 0}
                  onRight={() => {
                    push(interact(project, play, onScreen.objectId, onScreen.interactionId));
                    setOnScreen(null);
                  }}
                  onWrong={() => push(screenWrong(project, play, onScreen.objectId))}
                  onLeave={() => setOnScreen(null)}
                />
              )}
              <button className="tb-btn small" onClick={() => push(endFreePlay(project, play))}>
                {prompt.endsByRule ? 'Skip ahead' : 'Move on'}
              </button>
            </div>
          )}
          {prompt.kind === 'end' && (
            <div className={`play-over play-${prompt.outcome}`}>
              <span>{prompt.outcome === 'ending' ? 'The end' : prompt.outcome === 'gameOver' ? 'Game over' : 'Stopped'}</span>
              <span className="play-note">{prompt.text}</span>
              <button className="tb-btn primary" onClick={restart}>
                Play again
              </button>
            </div>
          )}
        </div>
      </section>
      <WorldPanel project={project} world={play.world} onChange={(change) => push(setWorld(project, play, change))} onLearn={(id) => push(learn(project, play, id))} onGear={(id, act) => push(gear(project, play, id, act))} onCraft={(id) => push(craft(project, play, id))} />
    </div>
  );
};
