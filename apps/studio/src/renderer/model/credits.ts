import type { Project, StoryObject } from './types';

/**
 * The Opening's credits: role and name, in the order they roll. Names left
 * empty are placeholders, shown as [name] until they are filled in.
 */
export interface Credit {
  id: string;
  role: string;
  name: string;
}

export const creditsOf = (object: StoryObject | undefined): Credit[] => (Array.isArray(object?.data.credits) ? (object!.data.credits as Credit[]) : []);

/** One credit as a line: "Directed by — Ken", or "Directed by — [name]" while it is a placeholder. */
export const creditLine = (c: Credit): string => `${c.role.trim() || '[role]'} — ${c.name.trim() || '[name]'}`;

const withCredits = (project: Project, id: string, credits: Credit[]): Project => {
  const o = project.objects[id];
  if (!o) return project;
  return { ...project, objects: { ...project.objects, [id]: { ...o, data: { ...o.data, credits }, modified: new Date().toISOString() } } };
};

const nextId = (credits: Credit[]) => {
  let n = credits.length + 1;
  while (credits.some((c) => c.id === `credit_${n}`)) n++;
  return `credit_${n}`;
};

export const addCredit = (project: Project, id: string, role = '', name = ''): Project => {
  const credits = creditsOf(project.objects[id]);
  return withCredits(project, id, [...credits, { id: nextId(credits), role, name }]);
};

export const updateCredit = (project: Project, id: string, creditId: string, patch: Partial<Omit<Credit, 'id'>>): Project =>
  withCredits(project, id, creditsOf(project.objects[id]).map((c) => (c.id === creditId ? { ...c, ...patch } : c)));

export const removeCredit = (project: Project, id: string, creditId: string): Project =>
  withCredits(project, id, creditsOf(project.objects[id]).filter((c) => c.id !== creditId));

export const moveCredit = (project: Project, id: string, creditId: string, by: -1 | 1): Project => {
  const credits = [...creditsOf(project.objects[id])];
  const at = credits.findIndex((c) => c.id === creditId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= credits.length) return project;
  [credits[at], credits[to]] = [credits[to]!, credits[at]!];
  return withCredits(project, id, credits);
};
