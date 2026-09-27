import type { Destination } from './details';
import { TYPE_LABEL } from './semantics';
import type { ObjectType, Project } from './types';

/**
 * Search across the whole project (spec §4: search in the command bar; §24:
 * a result can focus the graph). Elements match on their name, code, type
 * and notes; script lines on what is said. Each result knows where to go.
 */

export interface SearchResult {
  id: string;
  kind: 'element' | 'line';
  type: ObjectType;
  label: string;
  /** Code · type · where it is. */
  detail: string;
  /** The words that matched, when it wasn't the name. */
  snippet?: string;
  score: number;
  /** Where it lives: a node on the graph, or inside a scene. */
  to: Destination;
  /** The Bible has an entry for it (lines open their scene instead). */
  inBible: boolean;
}

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** How well `text` matches every word of the query: 0 is no match. */
const scoreText = (text: string, words: string[]): number => {
  const t = fold(text);
  if (!t) return 0;
  let total = 0;
  for (const w of words) {
    const at = t.indexOf(w);
    if (at < 0) return 0;
    // Start of the text beats start of a word beats anywhere.
    total += at === 0 ? 3 : /[^a-z0-9]/.test(t[at - 1]!) ? 2 : 1;
  }
  return total / words.length;
};

const snippetOf = (text: string, words: string[]): string => {
  const at = fold(text).indexOf(words[0]!);
  if (at < 0) return text.slice(0, 80);
  const start = Math.max(0, at - 24);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 80).trim()}${start + 80 < text.length ? '…' : ''}`;
};

/** Where an element is best shown: its node on the graph, else the mind map of a scene that holds it. */
export const destinationOf = (project: Project, id: string): Destination | null => {
  if (project.placements[id]) return { kind: 'graph', id };
  const holder = project.connections.find((c) => c.kind === 'contains' && c.targetId === id && project.objects[c.sourceId]);
  return holder ? { kind: 'scene', sceneId: holder.sourceId, mode: 'exploded' } : null;
};

export const search = (project: Project, query: string, limit = 40): SearchResult[] => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: SearchResult[] = [];
  const sceneName = (id: string) => {
    const s = project.objects[id];
    return s ? `${s.data.code ? `${s.data.code} ` : ''}${s.name}` : '';
  };

  for (const o of Object.values(project.objects)) {
    const code = String(o.data.code ?? '');
    const name = scoreText(o.name, words);
    const byCode = code ? scoreText(code, words) : 0;
    const byType = scoreText(TYPE_LABEL[o.type], words) * 0.4;
    const fields = [o.notes, ...Object.values(o.data).filter((v): v is string => typeof v === 'string' && v !== code)];
    const inText = fields.find((f) => scoreText(f, words) > 0);
    const score = Math.max(name * 2, byCode * 2, byType, inText ? 0.5 : 0);
    if (!score) continue;
    const to = destinationOf(project, o.id);
    if (!to) continue;
    const where = to.kind === 'scene' ? `in ${sceneName(to.sceneId)}` : o.type === 'scene' || o.type === 'plotPoint' ? '' : 'on the graph';
    out.push({
      id: o.id,
      kind: 'element',
      type: o.type,
      label: o.name,
      detail: [code, TYPE_LABEL[o.type], where].filter(Boolean).join(' · '),
      ...(name === 0 && byCode === 0 && inText ? { snippet: snippetOf(inText, words) } : {}),
      score,
      to,
      inBible: o.type !== 'begin' && o.type !== 'end',
    });
  }

  for (const l of project.lines) {
    if (!project.objects[l.sceneId]) continue;
    const said = scoreText(`${l.text} ${l.direction}`, words);
    const speaker = l.speakerId ? project.objects[l.speakerId]?.name ?? '' : '';
    const bySpeaker = speaker ? scoreText(speaker, words) * 0.3 : 0;
    const score = Math.max(said * 0.8, bySpeaker);
    if (!score || !l.text) continue;
    out.push({
      id: l.id,
      kind: 'line',
      type: l.kind === 'dialogue' ? 'dialogue' : 'scene',
      label: speaker ? `${speaker.toUpperCase()}: ${l.text}` : l.text,
      detail: `${l.kind === 'dialogue' ? 'Line' : 'Action'} · ${sceneName(l.sceneId)}`,
      score,
      to: { kind: 'scene', sceneId: l.sceneId, mode: 'open' },
      inBible: false,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
};
