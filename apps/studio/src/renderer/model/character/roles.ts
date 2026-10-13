import type { Effect, Rule } from '../rules';
import type { Project } from '../types';

/**
 * What each role adds (Character Creator spec §6.1, §6.3–6.5): the player's
 * progression and failure handling, an interactive NPC's knowledge, topics,
 * services and dialogue entrances, an ally's recruitment and support, and an
 * ambient extra's lightweight loops. Conditions are the studio's own rules
 * and effects, so the play-through and the engines read them as they read
 * every other rule.
 */

// ---------------------------------------------------------------- interactive NPC (§6.3)

export type Service = 'talk' | 'vendor' | 'questGiver' | 'info';
export const SERVICES: { id: Service; label: string; hint: string }[] = [
  { id: 'talk', label: 'Talks', hint: 'Has something to say' },
  { id: 'vendor', label: 'Vendor', hint: 'Buys and sells' },
  { id: 'questGiver', label: 'Quest giver', hint: 'Starts or advances quests' },
  { id: 'info', label: 'Information', hint: 'Answers questions on its topics' },
];

/** Something the NPC knows and will talk about, when its condition holds. */
export interface Topic {
  id: string;
  name: string;
  /** What it knows, in words. */
  knowledge: string;
  /** When it will talk about it; always when absent. */
  when?: Rule;
  /** The script lines it says on it (dialogue line ids: kept on rename). */
  lines: string[];
  /** What talking about it does: a flag set, an item given, a quest started. */
  effects?: Effect[];
}

export interface StockEntry {
  item: string;
  price: number;
  /** 0 for endless. */
  qty: number;
}

export interface NpcProfile {
  services: Service[];
  /** When it can be talked to at all; always when absent. */
  available?: Rule;
  /** The interaction prompt: “Talk to Mara”. */
  prompt: string;
  greeting: string;
  /** What it says when it isn’t available. */
  busy: string;
  topics: Topic[];
  /** The story states (quest flags) it reads or sets. */
  questFlags: string[];
  /** The scenes or dialogue nodes where the player can start talking to it. */
  entrances: string[];
  stock: StockEntry[];
  /** The item it trades in (coins); none for barter. */
  currency?: string;
}

export const defaultNpc = (name: string): NpcProfile => ({ services: ['talk'], prompt: `Talk to ${name}`, greeting: '', busy: '', topics: [], questFlags: [], entrances: [], stock: [] });

// ---------------------------------------------------------------- ally (§6.4)

export type Support = 'fight' | 'heal' | 'defend' | 'stayBack';
export const SUPPORTS: { id: Support; label: string }[] = [
  { id: 'fight', label: 'Fights beside the player' },
  { id: 'heal', label: 'Heals and supports' },
  { id: 'defend', label: 'Defends the player' },
  { id: 'stayBack', label: 'Stays out of fights' },
];

export interface AllyProfile {
  faction: string;
  /** When it joins; at once when absent. */
  recruit?: Rule;
  /** Trust it starts with and needs to join, 0–100. */
  trust: number;
  /** Metres it keeps behind the player. */
  followDistance: number;
  support: Support;
  sharesInventory: boolean;
  /** Talks while following. */
  talksWhileFollowing: boolean;
  dismissible: boolean;
  /** Stays in the party across scenes and saves. */
  persists: boolean;
}

export const defaultAlly = (): AllyProfile => ({ faction: '', trust: 50, followDistance: 2.5, support: 'fight', sharesInventory: false, talksWhileFollowing: true, dismissible: true, persists: true });

// ---------------------------------------------------------------- ambient extra (§6.5)

export type Loop = 'walk' | 'idle' | 'talk' | 'work' | 'flee';
export const LOOPS: { id: Loop; label: string }[] = [
  { id: 'walk', label: 'Walks about' },
  { id: 'idle', label: 'Idles' },
  { id: 'talk', label: 'Chats with others' },
  { id: 'work', label: 'Works' },
  { id: 'flee', label: 'Flees from danger' },
];

export interface ExtraProfile {
  loops: Loop[];
  /** Metres it wanders from where it is placed. */
  wanderRadius: number;
  /** Flees from fights, from the player, or never. */
  fleeFrom: 'combat' | 'player' | 'never';
  /** A one-line bark when the player passes. */
  bark: string;
}

export const defaultExtra = (): ExtraProfile => ({ loops: ['walk', 'idle', 'talk', 'flee'], wanderRadius: 6, fleeFrom: 'combat', bark: '' });

// ---------------------------------------------------------------- player (§6.1)

export interface PlayerProfile {
  /** How it improves: skill points, levelling up, or by the story alone. */
  upgrades: 'skillPoints' | 'levelUp' | 'story';
  /** Where it comes back after a failure. */
  respawn: 'checkpoint' | 'sceneStart' | 'gameOver';
  /** Lives before game over; 0 for unlimited. */
  lives: number;
  /** Keeps its inventory and skills between scenes and in saves. */
  persists: boolean;
  /** The controller scheme Play Mode and the engines map. */
  controls: 'thirdPerson' | 'firstPerson' | 'topDown' | 'sideOn';
}

export const defaultPlayer = (): PlayerProfile => ({ upgrades: 'skillPoints', respawn: 'checkpoint', lives: 0, persists: true, controls: 'thirdPerson' });

// ---------------------------------------------------------------- checks

const has = (project: Project, id: string | undefined, type: string) => !!id && project.objects[id]?.type === type;

export const npcProblems = (project: Project, npc: NpcProfile, opts: { hasTrade: boolean }): { severity: 'error' | 'warning'; text: string }[] => {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  if (!npc.services.length) out.push({ severity: 'warning', text: 'An interactive NPC with no services: give it Talks, Vendor, Quest giver or Information.' });
  if (npc.services.includes('vendor')) {
    if (!npc.stock.length) out.push({ severity: 'warning', text: 'A vendor with nothing to sell.' });
    if (!opts.hasTrade) out.push({ severity: 'warning', text: 'A vendor without the Trade ability: add it so the engines know to open a shop.' });
    if (npc.currency && !has(project, npc.currency, 'inventory')) out.push({ severity: 'error', text: 'Its currency item is no longer in the item library.' });
  }
  for (const s of npc.stock) if (!has(project, s.item, 'inventory')) out.push({ severity: 'error', text: 'An item it sells is no longer in the item library.' });
  if ((npc.services.includes('info') || npc.services.includes('questGiver')) && !npc.topics.length) out.push({ severity: 'warning', text: 'It gives information or quests but knows no topics yet.' });
  const lineIds = new Set(project.lines.map((l) => l.id));
  for (const t of npc.topics) {
    if (!t.name.trim()) out.push({ severity: 'error', text: 'A topic needs a name.' });
    const gone = t.lines.filter((l) => !lineIds.has(l)).length;
    if (gone) out.push({ severity: 'error', text: `${t.name || 'A topic'}: ${gone} of its lines ${gone === 1 ? 'is' : 'are'} no longer in the script.` });
  }
  for (const f of npc.questFlags) if (!has(project, f, 'state') && !has(project, f, 'quest')) out.push({ severity: 'error', text: 'A quest flag it uses is no longer in the story.' });
  for (const e of npc.entrances) if (!project.objects[e]) out.push({ severity: 'error', text: 'A dialogue entrance is no longer in the story.' });
  if (!npc.prompt.trim()) out.push({ severity: 'warning', text: 'No interaction prompt: the player won’t see what pressing interact does.' });
  return out;
};

export const allyProblems = (ally: AllyProfile): { severity: 'error' | 'warning'; text: string }[] => {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  if (ally.followDistance <= 0) out.push({ severity: 'warning', text: 'A follow distance of 0 walks into the player.' });
  if (ally.trust < 0 || ally.trust > 100) out.push({ severity: 'error', text: 'Trust is from 0 to 100.' });
  return out;
};

export const extraProblems = (extra: ExtraProfile): { severity: 'error' | 'warning'; text: string }[] =>
  extra.loops.length ? [] : [{ severity: 'warning', text: 'An ambient extra with no loops stands still.' }];
