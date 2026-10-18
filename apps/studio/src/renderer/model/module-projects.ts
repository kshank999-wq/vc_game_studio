import type { Project } from './types';
import type { ModuleId } from './modules';
import { createDefenseProject } from './defense/defense';
import { createShooterProject } from './shooter/shooter';
import { createArenaProject } from './arena/arena';

/** A new project of a module other than the story game: its starter game, with the name and premise from the New Game wizard. */
export const createModuleProject = (module: Exclude<ModuleId, 'story'>, name: string, premise = ''): Project =>
  module === 'shooter' ? createShooterProject(name, premise) : module === 'arena' ? createArenaProject(name, premise) : createDefenseProject(name, premise);
