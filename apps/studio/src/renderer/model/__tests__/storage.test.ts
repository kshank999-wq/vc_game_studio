import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../files';
import { createProject } from '../project';
import { PROJECT_VERSION, readProject, readProjectOrWhy } from '../storage';

describe('project file versions', () => {
  it('opens a project saved by this version unchanged', () => {
    const project = createProject();
    expect(parse(serialize(project))).toEqual(project);
  });

  it('says a project from a newer version needs the app updated, instead of calling it not a project', () => {
    const newer = { ...createProject(), version: PROJECT_VERSION + 1 };
    expect(readProjectOrWhy(JSON.parse(JSON.stringify(newer)))).toBe('newer');
    expect(readProject(newer)).toBeNull();
  });

  it('refuses what is not a project', () => {
    expect(readProjectOrWhy({ hello: 'world' })).toBe('not-a-project');
    expect(readProjectOrWhy(null)).toBe('not-a-project');
    expect(readProjectOrWhy({ format: 'vcgs', version: 1, objects: {} })).toBe('not-a-project');
  });

  it('fills in what older projects lack', () => {
    const { lines: _lines, events: _events, branches: _branches, ...old } = createProject();
    const read = readProject(old);
    expect(read?.lines).toEqual([]);
    expect(read?.events).toEqual([]);
    expect(read?.version).toBe(PROJECT_VERSION);
  });
});
