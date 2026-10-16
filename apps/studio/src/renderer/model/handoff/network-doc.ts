import type { IrLevel } from './levels';
import type { StreamingEngine } from './streaming-doc';

/** How each engine builds what the plan says. */
const howTo = (engine: StreamingEngine): { spawns: string; shared: string; perPlayer: string; server: string; local: string } => {
  switch (engine) {
    case 'unreal':
      return {
        spawns: 'One `APlayerStart` each, its **Player Start Tag** set to the team; pick by tag in the game mode’s `ChoosePlayerStart`.',
        shared: '`bReplicates = true`, state changed only where `HasAuthority()`, kept in replicated properties (`ReplicatedUsing` to show the change).',
        perPlayer: 'Not replicated: each client spawns its own, or keep its state in the player’s `PlayerState`.',
        server: 'Spawned by the game mode on the server only (`bNetLoadOnClient = false` when placed).',
        local: '`bReplicates = false`: loaded with the level on every machine.',
      };
    case 'unity':
      return {
        spawns: 'One spawn point each with the team on it; pick in `ConnectionApprovalCallback` (Netcode for GameObjects) and set the response’s position and rotation.',
        shared: 'A `NetworkObject` with its state in `NetworkVariable`s, changed on the server (`IsServer`) and through `ServerRpc`s.',
        perPlayer: 'A plain GameObject each client keeps, or a `NetworkObject` spawned with `SpawnWithOwnership` per client.',
        server: 'Only in the server’s scene, or disabled where `!IsServer`.',
        local: 'A plain GameObject in the scene: nothing to sync.',
      };
    case 'godot':
      return {
        spawns: 'One `Marker3D` each in group `vcgs_spawn_<team>` (or `vcgs_spawn`); the server picks one for each peer that joins.',
        shared: 'Authority on the server (peer 1); a `MultiplayerSynchronizer` for its state, a `MultiplayerSpawner` when it comes and goes.',
        perPlayer: 'Not synchronized: each peer keeps its own, or `set_multiplayer_authority` to the peer it belongs to.',
        server: 'Runs only where `multiplayer.is_server()`; freed on clients.',
        local: 'Part of the level scene on every peer: nothing to sync.',
      };
    case 'json':
      return {
        spawns: 'Pick a start of the player’s team as they join.',
        shared: 'The server holds its state and sends every change to every player.',
        perPlayer: 'Each player has their own copy and state.',
        server: 'On the server only.',
        local: 'Built on every machine: nothing to send.',
      };
  }
};

/**
 * NETWORKING.md (spec §19 network spawn and replication metadata): each
 * planned level's players, teams, starts and what the network does with its
 * items, with how to build that in the engine. Null when no level has a plan.
 */
export const networkMarkdown = (ir: { levels: readonly IrLevel[] }, engine: StreamingEngine, nameOf: (level: IrLevel) => string): string | null => {
  const levels = ir.levels.filter((l) => l.network);
  if (!levels.length) return null;
  const how = howTo(engine);
  const out = ['# Networking', '', 'How many play each map at once, in which teams, where they come in, and what every player has to see the same, as planned in VC Game Studio. The studio plans it; build the networking in the engine.', ''];
  for (const l of levels) {
    const n = l.network!;
    const names = new Map(l.items.map((i) => [i.guid, i.export_name]));
    const list = (ids: readonly string[]) => (ids.length ? ids.map((id) => `\`${names.get(id) ?? id}\``).join(', ') : '—');
    out.push(`## ${l.name} · ${nameOf(l)}`, '', `Up to **${n.players}** ${n.players === 1 ? 'player' : 'players'}${n.teams.length ? `, in teams ${n.teams.map((t) => `**${t}**`).join(', ')}` : ', no teams'}.`, '');
    out.push('### Player starts', '', how.spawns, '');
    if (n.teams.length) for (const t of [...n.teams, null]) {
      const at = n.spawns.filter((s) => s.team === t).map((s) => s.guid);
      if (t !== null || at.length) out.push(`- ${t ?? 'No team'}: ${list(at)}`);
    }
    else out.push(`- ${list(n.spawns.map((s) => s.guid))}`);
    out.push('', '### What the network does with each thing', '', '| | How | Items |', '|---|---|---|');
    out.push(`| Shared | ${how.shared} | ${list(n.shared)} |`, `| Each player’s own | ${how.perPlayer} | ${list(n.per_player)} |`, `| Server only | ${how.server} | ${list(n.server)} |`, `| Local | ${how.local} | everything else |`, '');
  }
  return `${out.join('\n')}\n`;
};
