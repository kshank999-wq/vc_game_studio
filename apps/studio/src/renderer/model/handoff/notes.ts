import type { GeneratedFile } from './engines';
import type { HandoffIR, IrNote } from './ir';

/**
 * Open comments and tasks for the engine team (spec §16). Every adapter
 * writes TASKS.md, grouped by what each is about in that engine's terms, and
 * puts a TODO(VCGS) comment beside the thing itself where the engine's code
 * has a place for one: a key constant, a level script's item, or, for a
 * comment on a generated file, the top of that file.
 */

const ROLE: Record<string, string> = {
  writer: 'Writer',
  narrative: 'Narrative designer',
  level: 'Level designer',
  gameplay: 'Gameplay programmer',
  cinematic: 'Cinematic designer',
  audio: 'Audio',
  reviewer: 'Reviewer',
};

/** "Task for Audio: Record a clink (Ana (Writer))" on one line, for a code comment. */
export const noteLine = (n: IrNote): string =>
  `${n.kind === 'task' ? `Task${n.for ? ` for ${ROLE[n.for] ?? n.for}` : ''}` : 'Comment'}: ${n.text.replace(/\s+/g, ' ').trim()} (${n.by})`;

/** TODO comments for the notes on one thing, in a language's line-comment syntax. */
export const todoLines = (notes: IrNote[], comment: string, indent = ''): string[] => notes.map((n) => `${indent}${comment} TODO(VCGS) ${noteLine(n).replace(/\*\//g, '* /')}`);

export const notesOn = (ir: HandoffIR, kind: IrNote['on']['kind'], key: string): IrNote[] => ir.notes.filter((n) => n.on.kind === kind && n.on.key === key);

const HEADS: Record<IrNote['on']['kind'], string> = {
  object: 'Story elements',
  connection: 'Branches and connections',
  level: 'Levels',
  levelItem: 'Level items',
  code: 'Generated files',
};

/**
 * TASKS.md: every open comment and task, grouped by what it is about, each
 * thing named as the engine knows it (`where`).
 */
export const tasksMarkdown = (ir: HandoffIR, engine: string, where: (n: IrNote) => string): string => {
  const out = [
    `# ${ir.project.name}: comments and tasks`,
    '',
    `The open comments and tasks from VC Game Studio, for the ${engine} team. This file is rewritten on each export: answer and tick them off in VC Game Studio.`,
    '',
  ];
  if (!ir.notes.length) return [...out, 'Nothing open.', ''].join('\n');
  const tasks = ir.notes.filter((n) => n.kind === 'task').length;
  out.push(`${tasks} ${tasks === 1 ? 'task' : 'tasks'}, ${ir.notes.length - tasks} ${ir.notes.length - tasks === 1 ? 'comment' : 'comments'}.`, '');
  for (const kind of Object.keys(HEADS) as IrNote['on']['kind'][]) {
    const here = ir.notes.filter((n) => n.on.kind === kind);
    if (!here.length) continue;
    out.push(`## ${HEADS[kind]}`, '');
    const keys = [...new Set(here.map((n) => n.on.key))];
    for (const key of keys) {
      const on = here.filter((n) => n.on.key === key);
      out.push(`### ${on[0]!.on.name} · \`${where(on[0]!)}\``, '');
      for (const n of on) {
        out.push(`- ${n.kind === 'task' ? '[ ] ' : ''}${noteLine(n)} · ${n.at.slice(0, 10)}`);
        for (const r of n.replies) out.push(`  - ${r.by}: ${r.text.replace(/\s+/g, ' ').trim()}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
};

/** The IR without its notes: what story data and fingerprints are made from, so a comment changes only TASKS.md and its TODO lines. */
export const withoutNotes = (ir: HandoffIR): HandoffIR => ({ ...ir, notes: [] });

/** How a file type writes a line comment, or null for types that take none (JSON, CSV). */
const commentFor = (path: string): string | null => {
  if (/\.(gd|py|cfg)$/.test(path)) return '#';
  if (/\.(cs|h|hpp|cpp|js|ts)$/.test(path)) return '//';
  if (/\.(tscn|tres)$/.test(path)) return ';';
  return null;
};

/**
 * A comment on a generated file goes at its top, as TODO lines (after a
 * resource's header line in Godot, whose first line must be its header).
 */
export const withCodeNotes = (files: GeneratedFile[], ir: HandoffIR): GeneratedFile[] => {
  const code = ir.notes.filter((n) => n.on.kind === 'code');
  if (!code.length) return files;
  return files.map((f) => {
    const on = code.filter((n) => n.on.key === f.path);
    const c = commentFor(f.path);
    if (!on.length || !c) return f;
    const lines = todoLines(on, c);
    if (c === ';') {
      const [head, ...rest] = f.content.split('\n');
      return { ...f, content: [head, ...lines, ...rest].join('\n') };
    }
    return { ...f, content: [...lines, f.content].join('\n') };
  });
};
