import { useRef, useState } from 'react';
import { fetchCatalog, fetchListed, readPrefab, safeUrl, starterPrefabs, type Catalog, type CatalogEntry, type Fetcher, type Prefab } from '../../model/level/prefabs';
import { setPreferences, usePreferences } from '../../preferences';

const browserFetch: Fetcher = async (url) => {
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  return { ok: r.ok, status: r.status, text: () => r.text() };
};

/**
 * Prefabs (structure spec V2): pieces of a level kept to place again. Save the
 * selection (or the whole structure) as one, place the studio's starters or
 * the project's own, share one as a file, and open catalogs: index files at
 * an address you add, whose prefabs download only when you ask and only if
 * they match the SHA-256 the catalog lists. One that is sold opens its page.
 */
export const PrefabsPanel = ({
  prefabs,
  selected,
  structureName,
  fetcher = browserFetch,
  onPlace,
  onSave,
  onSaveStructure,
  onExport,
  onImport,
  onRemove,
  onSay,
  onClose,
  onPopOut,
}: {
  prefabs: readonly Prefab[];
  /** How many items are selected (a prefab is made of them and what comes with them). */
  selected: number;
  /** Set on a structure's map: the whole structure can be saved as one. */
  structureName?: string;
  fetcher?: Fetcher;
  onPlace: (prefab: Prefab) => void;
  onSave: (name: string) => void;
  onSaveStructure: (name: string) => void;
  onExport: (prefab: Prefab) => void;
  /** A prefab read from a file or a catalog, to keep in the project. */
  onImport: (prefab: Prefab) => void;
  onRemove: (prefab: Prefab) => void;
  onSay: (text: string) => void;
  onClose: () => void;
  /** Pull it out into a window of its own (to put on another screen). */
  onPopOut?: () => void;
}) => {
  const prefs = usePreferences();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [catalogs, setCatalogs] = useState<Record<string, Catalog | { problems: string[] } | 'loading'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const read = async (files: FileList | null) => {
    const f = files?.[0];
    if (file.current) file.current.value = '';
    if (!f) return;
    const text =
      typeof f.text === 'function'
        ? await f.text()
        : await new Promise<string>((ok) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result ?? ''));
            r.readAsText(f);
          });
    const got = readPrefab(text);
    if (got.prefab) onImport(got.prefab);
    else onSay(got.problems[0] ?? 'That isn’t a prefab.');
  };
  const open = async (url: string) => {
    setCatalogs((c) => ({ ...c, [url]: 'loading' }));
    const got = await fetchCatalog(url, fetcher);
    setCatalogs((c) => ({ ...c, [url]: got.catalog ?? { problems: got.problems } }));
    if (got.catalog && got.problems.length) onSay(got.problems[0]!);
  };
  const add = () => {
    const url = safeUrl(address.trim());
    if (!url) {
      onSay('A catalog address must start with https://.');
      return;
    }
    if (!prefs.prefabCatalogs.includes(url)) setPreferences({ prefabCatalogs: [...prefs.prefabCatalogs, url] });
    setAddress('');
    void open(url);
  };
  const get = async (entry: CatalogEntry) => {
    if (!entry.url) {
      if (entry.page) window.open(entry.page, '_blank', 'noopener');
      return;
    }
    setBusy(entry.id);
    const got = await fetchListed(entry, fetcher);
    setBusy(null);
    if (got.prefab) onImport(got.prefab);
    else onSay(got.problems[0] ?? 'It couldn’t be downloaded.');
  };
  const row = (p: Prefab, own: boolean) => (
    <li key={p.id} className="lvl-prefab">
      <div className="lvl-prefab-text">
        <strong>{p.name}</strong>
        <span className="muted">
          {p.description}
          {p.kind === 'structure' ? ' Every floor.' : ''}
          {p.objects.length ? ` Brings ${p.objects.map((o) => o.name).join(', ')}.` : ''}
        </span>
      </div>
      <div className="lvl-structure-actions">
        <button className="tb-btn small primary" onClick={() => onPlace(p)} aria-label={`Place ${p.name}`}>
          Place
        </button>
        <button className="tb-btn small" onClick={() => onExport(p)} aria-label={`Save ${p.name} as a file`}>
          File
        </button>
        {own && (
          <button className="icon-btn small" onClick={() => onRemove(p)} aria-label={`Remove ${p.name}`}>
            ×
          </button>
        )}
      </div>
    </li>
  );
  return (
    <section className="lvl-generate lvl-prefabs" aria-label="Prefabs">
      <header className="lvl-structure-head">
        <strong>Prefabs</strong>
        <span className="muted">Pieces to place again, here or in another project</span>
        <span className="grow" />
        {onPopOut && (
          <button className="icon-btn small" aria-label="Open in its own window" title="Open in its own window, to put on another screen" onClick={onPopOut}>
            ⧉
          </button>
        )}
        <button className="icon-btn small" aria-label="Close prefabs" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="lvl-prefabs-body">
        <div className="lvl-prefabs-save">
          <label className="dfld">
            <span>Name</span>
            <input className="inp small" aria-label="Prefab name" value={name} placeholder="Guard post" onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            className="tb-btn small"
            disabled={!selected}
            onClick={() => {
              onSave(name || 'Prefab');
              setName('');
            }}
            title="The selection, the doors in its rooms, what is in them and what its parts work"
          >
            Save the selection{selected ? ` (${selected})` : ''}
          </button>
          {structureName && (
            <button
              className="tb-btn small"
              onClick={() => {
                onSaveStructure(name || structureName);
                setName('');
              }}
            >
              Save the whole structure
            </button>
          )}
          <button className="tb-btn small" onClick={() => file.current?.click()}>
            Open a prefab file…
          </button>
          <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Prefab file" onChange={(e) => void read(e.target.files)} />
        </div>
        <h4>In this project</h4>
        {prefabs.length ? <ul className="lvl-prefab-list" aria-label="This project’s prefabs">{prefabs.map((p) => row(p, true))}</ul> : <p className="pref-hint">None yet: select something and save it.</p>}
        <h4>Starters</h4>
        <ul className="lvl-prefab-list" aria-label="Starter prefabs">
          {starterPrefabs().map((p) => row(p, false))}
        </ul>
        <h4>Catalogs</h4>
        <p className="pref-hint">A catalog is an index file of prefabs at an https address. Nothing is fetched until you open one; each download is checked against its SHA-256 before it is used.</p>
        {prefs.prefabCatalogs.map((url) => {
          const c = catalogs[url];
          return (
            <div key={url} className="lvl-prefab-catalog">
              <div className="lvl-structure-actions">
                <span className="mono grow" title={url}>
                  {c && c !== 'loading' && 'name' in c ? c.name : url}
                </span>
                <button className="tb-btn small" disabled={c === 'loading'} onClick={() => void open(url)}>
                  {c === 'loading' ? 'Opening…' : c ? 'Refresh' : 'Open'}
                </button>
                <button className="icon-btn small" aria-label={`Forget ${url}`} onClick={() => setPreferences({ prefabCatalogs: prefs.prefabCatalogs.filter((u) => u !== url) })}>
                  ×
                </button>
              </div>
              {c && c !== 'loading' && 'problems' in c && !('entries' in c) && <p className="lvl-issue warning">{c.problems[0]}</p>}
              {c && c !== 'loading' && 'entries' in c && (
                <ul className="lvl-prefab-list" aria-label={`Prefabs in ${c.name}`}>
                  {c.entries.map((e) => (
                    <li key={e.id} className="lvl-prefab">
                      <div className="lvl-prefab-text">
                        <strong>{e.name}</strong>
                        <span className="muted">
                          {e.description}
                          {e.author ? ` By ${e.author}.` : ''}
                          {e.license ? ` ${e.license}.` : ''}
                        </span>
                      </div>
                      <button className="tb-btn small" disabled={busy === e.id} onClick={() => void get(e)} aria-label={e.url ? `Download ${e.name}` : `Get ${e.name}`}>
                        {busy === e.id ? 'Downloading…' : e.url ? 'Download' : `Get it${e.price ? ` (${e.price})` : ''}`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div className="lvl-structure-actions">
          <input className="inp small grow" aria-label="Catalog address" placeholder="https://example.com/prefabs/index.json" value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="tb-btn small" disabled={!address.trim()} onClick={add}>
            Add catalog
          </button>
        </div>
      </div>
    </section>
  );
};
