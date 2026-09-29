import type { Project } from '../types';
import { importSource, loadTemplate } from './sorter';

/**
 * A day's brainstorm for The Sunken Vault (Note Sorter spec §17), to try the
 * sorter on: three documents with lore, people, mechanics, levels,
 * cinematics, dialogue and choices all mixed together, as real notes are.
 */
export const SAMPLE_NOTES: readonly { name: string; content: string }[] = [
  {
    name: 'Voice memo · Sep 22',
    content: [
      'The vault was sealed by the Drowned Order three hundred years before the game begins, when the river took the old city.',
      'You play the Explorer, a cartographer who maps the wrong cave. Mara, the guide, knows the tunnels and does not trust him.',
      'Lantern mechanic: the lantern oil drains the longer you stay in deep water. Maybe the screen edges darken when it runs low.',
      'Keys of the Order, one per flooded level. Collect all three to open the vault. The Brass Key lets you read the old maps.',
      'Opening cinematic: water pouring upward, back into the cave. Reverse everything.',
      'End choice: Mara keeps the ring for her family, or gives it back to the river. Changes the ending.',
      'The flooded chapel level: pews underwater, only the rafters to walk on, floating coffins as moving platforms.',
      'Eel swarms in the deep channels, weak to lantern light. Could tie into the chapel.',
      'Mara, first line: "You mapped the cave. That doesn\'t make it yours."',
      'The Abbot kept the ledger of everyone the Order drowned.',
    ].join('\n'),
  },
  {
    name: 'Lore draft v2',
    content: [
      'The Drowned Order were river priests who believed the water kept their secrets for them.',
      'Mara can hold her breath twice as long as the Explorer, but only in cold water.',
      'Lantern oil runs out far from the surface: the lantern dims the deeper you go.',
      'The river rises every era, one flood for each century of the Order.',
    ].join('\n'),
  },
  {
    name: 'Level ideas',
    content: [
      'The bell tower rises through every flood, one floor above the water each era.',
      'Guard patrol on the cave ledge passes every forty seconds.',
      'Rope bridges snap if you carry both keys at once: a weight puzzle.',
      'Bell puzzle: ring the chapel bells in the order of the floods.',
    ].join('\n'),
  },
];

/** Bring the sample brainstorm in, with the action-adventure categories ready to sort into. */
export const withSampleNotes = (project: Project): Project => {
  let next = project;
  for (const doc of SAMPLE_NOTES) next = importSource(next, doc.name, doc.content).project;
  return loadTemplate(next, 'action-adventure');
};
