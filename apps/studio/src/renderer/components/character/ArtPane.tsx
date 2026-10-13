import { useRef, useState } from 'react';
import { addArt, characterIssues, patchBinding, patchPlaceholder, profileOf, removeArt, RIGS, SILHOUETTES, useArt, type ArtRef, type AssetBinding, type Placeholder, type Silhouette } from '../../model/character/profile';
import type { Project, StoryObject } from '../../model/types';
import { Figure } from './Figure';

const KINDS: { id: ArtRef['kind']; label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'concept', label: 'Concept art' },
  { id: 'reference', label: 'Reference' },
  { id: 'model', label: '3D model thumbnail' },
];

const PROPS: { id: Placeholder['prop']; label: string }[] = [
  { id: 'none', label: 'Nothing' },
  { id: 'sword', label: 'Sword' },
  { id: 'shield', label: 'Shield' },
  { id: 'bow', label: 'Bow' },
  { id: 'staff', label: 'Staff' },
];

/** Images are kept in the project, so they are scaled to fit 512 px first. */
const MAX = 512;

export const readImage = (file: File): Promise<string> =>
  new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onerror = () => fail(reader.error);
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => fail(new Error('Not an image'));
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        if (scale === 1 && src.length < 400_000) return done(src);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return done(src);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });

/**
 * The art pane (spec §2): reference images, concept art, a portrait or a 3D
 * thumbnail, dropped or chosen; and the placeholder dummy that stands in
 * until finished art is bound. Which one stands for the character is a
 * choice; changing it never touches the id, inventory, dialogue or logic.
 */
export const ArtPane = ({ project, character, onCommit, onSay }: { project: Project; character: StoryObject; onCommit: (p: Project) => void; onSay: (t: string) => void }) => {
  const prof = profileOf(character);
  const { art } = prof;
  const [kind, setKind] = useState<ArtRef['kind']>('portrait');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = art.use === 'placeholder' ? undefined : art.refs.find((r) => r.id === art.use);

  const take = async (files: FileList | File[]) => {
    let p = project;
    let n = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        onSay(`${f.name} isn’t an image.`);
        continue;
      }
      try {
        const src = await readImage(f);
        p = addArt(p, character.id, { kind, name: f.name, src }).project;
        n++;
      } catch {
        onSay(`${f.name} couldn’t be read.`);
      }
    }
    if (n) {
      onCommit(p);
      onSay(`${n} image${n === 1 ? '' : 's'} added to ${character.name}.`);
    }
  };

  const ph = art.placeholder;
  return (
    <section className="cc-art" aria-label="Artwork">
      <span className="pz-label">Artwork</span>
      <div
        className={`cc-stage${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files);
        }}
      >
        {shown ? <img src={shown.src} alt={`${character.name}: ${shown.name}`} /> : <Figure placeholder={ph} height={170} title={`${character.name} placeholder`} />}
        <span className="cc-stage-tag">{shown ? KINDS.find((k) => k.id === shown.kind)?.label : 'Placeholder'}</span>
      </div>
      <div className="cc-art-row">
        <select className="inp small" aria-label="Add as" value={kind} onChange={(e) => setKind(e.target.value as ArtRef['kind'])}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <button className="tb-btn small" onClick={() => fileRef.current?.click()}>
          + Image…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Add artwork"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (files.length) void take(files);
          }}
        />
      </div>
      <p className="pref-hint">Or drop images on the picture.</p>
      <div className="cc-thumbs" role="list" aria-label="Art">
        <button role="listitem" className={`cc-thumb${art.use === 'placeholder' ? ' on' : ''}`} aria-pressed={art.use === 'placeholder'} title="Use the placeholder" onClick={() => onCommit(useArt(project, character.id, 'placeholder'))}>
          <Figure placeholder={ph} height={44} title="Placeholder" />
        </button>
        {art.refs.map((r) => (
          <span key={r.id} role="listitem" className={`cc-thumb${art.use === r.id ? ' on' : ''}`}>
            <button className="cc-thumb-pick" aria-pressed={art.use === r.id} title={`Use ${r.name}`} onClick={() => onCommit(useArt(project, character.id, r.id))}>
              <img src={r.src} alt={r.name} />
            </button>
            <button className="cc-thumb-x" aria-label={`Remove ${r.name}`} onClick={() => onCommit(removeArt(project, character.id, r.id))}>
              ×
            </button>
          </span>
        ))}
      </div>

      <span className="pz-label">Placeholder</span>
      <div className="cc-ph">
        <label className="pz-field">
          <span className="pz-label">Silhouette</span>
          <select className="inp small" aria-label="Silhouette" value={ph.silhouette} onChange={(e) => onCommit(patchPlaceholder(project, character.id, { silhouette: e.target.value as Silhouette }))}>
            {SILHOUETTES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pz-field">
          <span className="pz-label">Tint</span>
          <input className="inp small cc-color" type="color" aria-label="Tint" value={ph.tint} onChange={(e) => onCommit(patchPlaceholder(project, character.id, { tint: e.target.value }))} />
        </label>
        <label className="pz-field">
          <span className="pz-label">In hand</span>
          <select className="inp small" aria-label="Prop in hand" value={ph.prop} onChange={(e) => onCommit(patchPlaceholder(project, character.id, { prop: e.target.value as Placeholder['prop'] }))}>
            {PROPS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pz-field">
          <span className="pz-label">Label</span>
          <input
            key={`${character.id}-${ph.label}`}
            className="inp small"
            aria-label="Placeholder label"
            maxLength={6}
            defaultValue={ph.label}
            onBlur={(e) => e.currentTarget.value.toUpperCase() !== ph.label && onCommit(patchPlaceholder(project, character.id, { label: e.currentTarget.value.toUpperCase() }))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
      </div>
      <p className="pref-hint">The tint is the character’s colour everywhere: cues in the script, the Bible, the map.</p>
      <BindingEditor project={project} character={character} onCommit={onCommit} />
    </section>
  );
};

/** A text field that commits on blur or Enter. */
const Blur = ({ label, value, placeholder, onDone }: { label: string; value: string; placeholder?: string; onDone: (v: string) => void }) => (
  <input
    key={value}
    className="inp small"
    aria-label={label}
    placeholder={placeholder}
    defaultValue={value}
    onBlur={(e) => e.currentTarget.value !== value && onDone(e.currentTarget.value)}
    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
  />
);

const listOf = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const audioOf = (text: string): AssetBinding['audio'] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf('=');
      return at < 0 ? { key: l, file: '' } : { key: l.slice(0, at).trim(), file: l.slice(at + 1).trim() };
    });

/**
 * Final art (spec §10, §11): the engine model that replaces the placeholder,
 * its rig, the animations it has, where props attach and its sounds. The
 * export binds them; rig mismatches and ability cues with no animation are
 * listed here and in the export report. Swapping art never changes the id,
 * inventory, dialogue or logic.
 */
export const BindingEditor = ({ project, character, onCommit }: { project: Project; character: StoryObject; onCommit: (p: Project) => void }) => {
  const b = profileOf(character).binding;
  const set = (patch: Partial<AssetBinding>) => onCommit(patchBinding(project, character.id, patch));
  const issues = characterIssues(project, character.id).filter((i) => i.area === 'art' && i.severity !== 'info' && b.finalModel.trim());
  return (
    <div className="cc-binding" role="group" aria-label="Final art binding">
      <span className="pz-label">Final art in the engine</span>
      <div className="cc-ph">
        <label className="pz-field cc-wide">
          <span className="pz-label">Model</span>
          <Blur label="Final model" value={b.finalModel} placeholder="res://art/orc.glb · Assets/Art/Orc.fbx · /Game/Art/SK_Orc" onDone={(v) => set({ finalModel: v.trim() })} />
        </label>
        <label className="pz-field">
          <span className="pz-label">Rig</span>
          <select className="inp small" aria-label="Rig" value={b.rig} onChange={(e) => set({ rig: e.target.value as AssetBinding['rig'] })}>
            {RIGS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pz-field cc-wide">
          <span className="pz-label">Animations</span>
          <Blur label="Animations" value={b.animations.join(', ')} placeholder="idle, walk, attack…" onDone={(v) => set({ animations: listOf(v) })} />
        </label>
        <label className="pz-field">
          <span className="pz-label">Hand socket</span>
          <Blur label="Hand socket" value={b.sockets.hand} onDone={(v) => set({ sockets: { ...b.sockets, hand: v.trim() } })} />
        </label>
        <label className="pz-field">
          <span className="pz-label">Off-hand socket</span>
          <Blur label="Off-hand socket" value={b.sockets.offHand} onDone={(v) => set({ sockets: { ...b.sockets, offHand: v.trim() } })} />
        </label>
        <label className="pz-field">
          <span className="pz-label">Head socket</span>
          <Blur label="Head socket" value={b.sockets.head} onDone={(v) => set({ sockets: { ...b.sockets, head: v.trim() } })} />
        </label>
        <label className="pz-field cc-wide">
          <span className="pz-label">Sounds (key = file, one a line)</span>
          <textarea
            key={JSON.stringify(b.audio)}
            className="inp small"
            aria-label="Sounds"
            rows={2}
            placeholder="footstep = res://audio/orc_step.ogg"
            defaultValue={b.audio.map((a) => `${a.key} = ${a.file}`).join('\n')}
            onBlur={(e) => {
              const next = audioOf(e.currentTarget.value);
              if (JSON.stringify(next) !== JSON.stringify(b.audio)) set({ audio: next });
            }}
          />
        </label>
      </div>
      {issues.length > 0 && (
        <ul className="pz-issues" aria-label="Art binding problems">
          {issues.map((i, n) => (
            <li key={n} className={`pz-issue ${i.severity}`}>
              {i.text}
            </li>
          ))}
        </ul>
      )}
      <p className="pref-hint">{b.finalModel.trim() ? 'The export puts this model in place of the placeholder, under the same id: inventory, dialogue and logic stay as they are.' : 'Empty: the engine gets the placeholder figure, with its collider and hand socket.'}</p>
    </div>
  );
};
