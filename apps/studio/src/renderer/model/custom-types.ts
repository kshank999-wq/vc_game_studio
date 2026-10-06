import { customOf, setData } from './details';
import { newId } from './project';
import type { ObjectType, Project, StoryObject } from './types';

/**
 * Your own kinds of element (spec §6, custom node types): a name, the
 * built-in type it is a kind of (a Vehicle is an Interactive Object, a Spell
 * a Skill), and the fields every one of them has. An element of that type
 * takes the kind under its detail; its fields join the element's own fields,
 * empty to fill in, and the kind travels to the engines with them.
 */
export interface CustomType {
  id: string;
  name: string;
  base: ObjectType;
  fields: string[];
}

export const customTypesOf = (project: Project): CustomType[] => project.customTypes ?? [];

export const customTypesFor = (project: Project, base: ObjectType): CustomType[] => customTypesOf(project).filter((t) => t.base === base);

/** The kind an element was given, if it still exists and fits its type. */
export const customTypeOf = (project: Project, object: StoryObject | undefined): CustomType | undefined => {
  const id = object?.data.customType;
  return typeof id === 'string' ? customTypesOf(project).find((t) => t.id === id && t.base === object!.type) : undefined;
};

/** Fields as written, trimmed, without blanks or the same name twice (in any case). */
const clean = (fields: readonly string[]) => {
  const seen = new Set<string>();
  return fields.map((f) => f.trim()).filter((f) => f && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()));
};

export const addCustomType = (project: Project, name: string, base: ObjectType, fields: readonly string[] = []): { project: Project; id: string } => {
  const type: CustomType = { id: newId('kind'), name: name.trim() || 'New kind', base, fields: clean(fields) };
  return { project: { ...project, customTypes: [...customTypesOf(project), type] }, id: type.id };
};

/** Rename a kind or change its fields; elements of it gain any new fields (nothing written is lost). */
export const updateCustomType = (project: Project, id: string, patch: Partial<Pick<CustomType, 'name' | 'fields'>>): Project => {
  const types = customTypesOf(project).map((t) => (t.id === id ? { ...t, ...(patch.name !== undefined ? { name: patch.name.trim() || t.name } : {}), ...(patch.fields ? { fields: clean(patch.fields) } : {}) } : t));
  let next: Project = { ...project, customTypes: types };
  const type = types.find((t) => t.id === id);
  if (type) for (const o of Object.values(next.objects)) if (o.data.customType === id) next = withFields(next, o.id, type.fields);
  return next;
};

/** Remove a kind: its elements keep their fields and are plain elements of their type again. */
export const removeCustomType = (project: Project, id: string): Project => {
  let next: Project = { ...project, customTypes: customTypesOf(project).filter((t) => t.id !== id) };
  for (const o of Object.values(next.objects)) if (o.data.customType === id) next = setData(next, o.id, { customType: undefined });
  if (!next.customTypes?.length) {
    const { customTypes: _gone, ...rest } = next;
    next = rest as Project;
  }
  return next;
};

const withFields = (project: Project, objectId: string, fields: readonly string[]): Project => {
  const have = customOf(project.objects[objectId]);
  const missing = fields.filter((f) => !have.some((h) => h.key.trim().toLowerCase() === f.toLowerCase()));
  return missing.length ? setData(project, objectId, { custom: [...have, ...missing.map((key) => ({ key, value: '' }))] }) : project;
};

/** Give an element a kind (or none): its kind's fields are added, empty, to its own. */
export const setCustomType = (project: Project, objectId: string, typeId: string | null): Project => {
  const type = typeId ? customTypesOf(project).find((t) => t.id === typeId) : undefined;
  const next = setData(project, objectId, { customType: type ? type.id : undefined });
  return type ? withFields(next, objectId, type.fields) : next;
};
