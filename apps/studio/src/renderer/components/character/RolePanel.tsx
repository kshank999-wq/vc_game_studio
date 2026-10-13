import { patchRole, promoteExtra, type CharacterProfile } from '../../model/character/profile';
import { LOOPS, SUPPORTS, type ExtraProfile, type PlayerProfile, type Support } from '../../model/character/roles';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { RuleEditor } from '../rules/RuleEditor';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  id: string;
  profile: CharacterProfile;
  onCommit: (p: Project) => void;
  onSay: (t: string) => void;
}

/**
 * Role settings (spec §6.1, §6.4, §6.5): the player's progression, respawn
 * and controls; an ally's recruitment, following and support; an ambient
 * extra's loops, with a way to promote it to a full NPC in place. Each
 * shows while the character has the role.
 */
export const RolePanel = ({ project, id, profile, onCommit, onSay }: Props) => {
  const { roles } = profile;
  const player = (patch: Partial<PlayerProfile>) => onCommit(patchRole(project, id, 'player', patch));
  const extra = (patch: Partial<ExtraProfile>) => onCommit(patchRole(project, id, 'extra', patch));
  const ally = profile.ally;
  return (
    <div className="cc-role-settings">
      {!roles.some((r) => r === 'player' || r === 'ally' || r === 'extra') && (
        <p className="cc-note">The Player, Ally and Ambient extra roles have settings here. An interactive NPC’s are under Dialogue; an enemy’s under AI and Variants.</p>
      )}
      {roles.includes('player') && (
        <section className="pz-sec" aria-label="Player">
          <span className="pz-label">Player</span>
          <div className="cc-stats">
            <Select label="Improves by" value={profile.player.upgrades} options={[['skillPoints', 'Skill points'], ['levelUp', 'Levelling up'], ['story', 'The story alone']]} onChange={(v) => player({ upgrades: v as PlayerProfile['upgrades'] })} />
            <Select label="After a failure" value={profile.player.respawn} options={[['checkpoint', 'Back at the last checkpoint'], ['sceneStart', 'Back at the scene’s start'], ['gameOver', 'Game over']]} onChange={(v) => player({ respawn: v as PlayerProfile['respawn'] })} />
            <NumberField label="Lives (0 unlimited)" unit="" min={0} max={99} step={1} value={profile.player.lives} onCommit={(v) => player({ lives: v })} />
            <Select label="Controls" value={profile.player.controls} options={[['thirdPerson', 'Third person'], ['firstPerson', 'First person'], ['topDown', 'Top down'], ['sideOn', 'Side on']]} onChange={(v) => player({ controls: v as PlayerProfile['controls'] })} />
          </div>
          <label className="cc-check">
            <input type="checkbox" checked={profile.player.persists} onChange={(e) => player({ persists: e.target.checked })} /> Keeps inventory and skills between scenes and in saves
          </label>
          <p className="pref-hint">Its starting abilities and gear are on the Profile view; its skill trees are the game’s skills in the Bible. Play Mode’s key and gamepad mapping is in Levels › Play.</p>
        </section>
      )}
      {roles.includes('ally') && (
        <section className="pz-sec" aria-label="Ally">
          <span className="pz-label">Ally</span>
          <div className="cc-stats">
            <Field label="Faction" value={ally.faction} placeholder="The Order" onCommit={(v) => onCommit(patchRole(project, id, 'ally', { faction: v.trim() }))} />
            <NumberField label="Trust to start" unit="/100" min={0} max={100} step={5} value={ally.trust} onCommit={(v) => onCommit(patchRole(project, id, 'ally', { trust: v }))} />
            <NumberField label="Follow distance" unit="m" min={0} max={50} step={0.5} value={ally.followDistance} onCommit={(v) => onCommit(patchRole(project, id, 'ally', { followDistance: v }))} />
            <Select label="In a fight" value={ally.support} options={SUPPORTS.map((s) => [s.id, s.label])} onChange={(v) => onCommit(patchRole(project, id, 'ally', { support: v as Support }))} />
          </div>
          <RuleEditor project={project} rule={ally.recruit} label="Joins when" onChange={(r) => onCommit(patchRole(project, id, 'ally', { recruit: r }))} />
          {(
            [
              ['sharesInventory', 'Shares its inventory with the player'],
              ['talksWhileFollowing', 'Talks while following'],
              ['dismissible', 'Can be dismissed'],
              ['persists', 'Stays in the party across scenes and saves'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="cc-check">
              <input type="checkbox" checked={ally[k]} onChange={(e) => onCommit(patchRole(project, id, 'ally', { [k]: e.target.checked }))} /> {label}
            </label>
          ))}
          <p className="pref-hint">Its combat AI (perception, tactics, the state machine) is on the AI view.</p>
        </section>
      )}
      {roles.includes('extra') && (
        <section className="pz-sec" aria-label="Ambient extra">
          <div className="cc-sec-head">
            <span className="pz-label">Ambient extra</span>
            <button
              className="tb-btn small"
              onClick={() => {
                onCommit(promoteExtra(project, id));
                onSay('Promoted to an interactive NPC: same id, so every placement stays. Its dialogue settings are under Dialogue.');
              }}
            >
              Promote to an interactive NPC
            </button>
          </div>
          <div className="cc-states" role="group" aria-label="Loops">
            {LOOPS.map((l) => (
              <label key={l.id} className={`cc-state-chip${profile.extra.loops.includes(l.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={profile.extra.loops.includes(l.id)} onChange={() => extra({ loops: profile.extra.loops.includes(l.id) ? profile.extra.loops.filter((x) => x !== l.id) : [...profile.extra.loops, l.id] })} /> {l.label}
              </label>
            ))}
          </div>
          <div className="cc-stats">
            <NumberField label="Wanders up to" unit="m" min={0} max={500} step={0.5} value={profile.extra.wanderRadius} onCommit={(v) => extra({ wanderRadius: v })} />
            <Select label="Flees from" value={profile.extra.fleeFrom} options={[['combat', 'Fights'], ['player', 'The player'], ['never', 'Nothing']]} onChange={(v) => extra({ fleeFrom: v as ExtraProfile['fleeFrom'] })} />
            <Field label="Bark as the player passes" value={profile.extra.bark} placeholder="Mind the water." onCommit={(v) => extra({ bark: v.trim() })} />
          </div>
          <p className="pref-hint">Extras keep to lightweight loops, without full dialogue or combat, so crowds stay cheap.</p>
        </section>
      )}
    </div>
  );
};

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) => (
  <label className="pz-field">
    <span className="pz-label">{label}</span>
    <select className="inp small" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </label>
);
