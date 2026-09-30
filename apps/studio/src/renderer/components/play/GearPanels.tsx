import { craftCheck, describeRecipe, recipesOf } from '../../model/crafting';
import { describeStats, equipCheck, equipmentList, equipmentOf, isEquipped, statTotal, usesLeft, useCheck } from '../../model/equipment';
import type { PlayWorld } from '../../model/play';
import { describeCost, kindOf, learnCheck, skillsOf, treeOf } from '../../model/skills';
import type { Project } from '../../model/types';
import { Symbol } from '../Symbol';

/*
 * The player's gear, skills and recipes (spec §8), to equip, use, learn and
 * craft: the same panels in the story play-through and in Level Play Mode.
 */

/** Crafting (spec §8): each recipe, with Craft, or what is missing. */
export const CraftSection = ({ project, world, onCraft }: { project: Project; world: PlayWorld; onCraft: (id: string) => void }) => {
  const all = recipesOf(project);
  if (!all.length) return null;
  return (
    <section aria-label="Crafting">
      <h3>Crafting</h3>
      {all.map((o) => {
        const why = craftCheck(project, world, o.id);
        return (
          <div key={o.id} className="play-row play-gear-row">
            <span className="play-skill-name">
              <Symbol type="inventory" size={11} /> <span className="muted">{describeRecipe(project, o)}</span>
            </span>
            <button className="tb-btn small" disabled={!!why} title={why || `Craft ${o.name}`} aria-label={`Craft ${o.name}`} onClick={() => onCraft(o.id)}>
              Craft
            </button>
            {why && <span className="pref-hint play-skill-needs">{why}</span>}
          </div>
        );
      })}
    </section>
  );
};

/** Weapons and equipment (spec §8): what is in each slot, and every item of equipment carried, to equip, put away or use (or why not). */
export const GearSection = ({ project, world, onGear }: { project: Project; world: PlayWorld; onGear: (id: string, act: 'equip' | 'unequip' | 'use') => void }) => {
  const all = equipmentList(project);
  if (!all.length) return null;
  const carried = all.filter((o) => (world.items[o.id] ?? 0) > 0);
  const slots = Object.entries(world.equipped ?? {}).filter(([, id]) => project.objects[id]);
  const stats = [...new Set(Object.values(world.equipped ?? {}).flatMap((id) => equipmentOf(project.objects[id])?.stats.map((s) => s.name) ?? []))];
  return (
    <section aria-label="Equipment">
      <h3>Equipment</h3>
      <p className="pref-hint">
        {slots.length ? slots.map(([slot, id]) => `${slot}: ${project.objects[id]!.name}`).join(' · ') : 'Nothing equipped.'}
        {stats.length > 0 && ` · ${stats.map((s) => `${s} ${statTotal(project, world, s)}`).join(' · ')}`}
      </p>
      {!carried.length && <p className="pref-hint">No equipment carried.</p>}
      {carried.map((o) => {
        const e = equipmentOf(o)!;
        const on = isEquipped(world, o.id);
        const why = on ? useCheck(project, world, o.id) : equipCheck(project, world, o.id);
        const left = usesLeft(project, world, o.id);
        return (
          <div key={o.id} className={`play-row play-gear-row${on ? ' on' : ''}`}>
            <span className="play-skill-name">
              <Symbol type="inventory" size={11} /> {o.name}
              <span className="muted">
                {' '}
                · {e.slot}
                {e.stats.length ? ` · ${describeStats(e)}` : ''}
                {e.ammo ? ` · ${world.items[e.ammo] ?? 0} ${project.objects[e.ammo]?.name ?? ''}` : ''}
                {Number.isFinite(left) ? ` · ${left} ${left === 1 ? 'use' : 'uses'} left` : ''}
              </span>
            </span>
            <span className="play-gear-actions">
              {on ? (
                <>
                  <button className="tb-btn small" disabled={!!why} title={why || `Use ${o.name}`} aria-label={`Use ${o.name}`} onClick={() => onGear(o.id, 'use')}>
                    Use
                  </button>
                  <button className="tb-btn small" aria-label={`Put away ${o.name}`} onClick={() => onGear(o.id, 'unequip')}>
                    Put away
                  </button>
                </>
              ) : (
                <button className="tb-btn small" disabled={!!why} title={why || `Equip ${o.name}`} aria-label={`Equip ${o.name}`} onClick={() => onGear(o.id, 'equip')}>
                  Equip
                </button>
              )}
            </span>
            {why && on && <span className="pref-hint play-skill-needs">{why}</span>}
          </div>
        );
      })}
    </section>
  );
};

/** The skills, abilities and upgrades (spec §8), by tree: each rank learned of how many, its cost, and Learn (or why not). */
export const SkillsSection = ({ project, world, onLearn }: { project: Project; world: PlayWorld; onLearn: (id: string) => void }) => {
  const skills = skillsOf(project);
  if (!skills.length) return null;
  const trees = [...new Set(skills.map((o) => treeOf(o) || 'No tree'))];
  return (
    <section aria-label="Skills">
      <h3>Skills</h3>
      {trees.map((tree) => (
        <div key={tree} className="play-skill-tree">
          {trees.length > 1 || tree !== 'No tree' ? <span className="pref-hint">{tree}</span> : null}
          {skills
            .filter((o) => (treeOf(o) || 'No tree') === tree)
            .map((o) => {
              const check = learnCheck(project, world, o.id);
              return (
                <div key={o.id} className={`play-row play-skill-row${check.rank ? ' learned' : ''}`}>
                  <span className="play-skill-name">
                    <Symbol type="skill" size={11} /> {o.name}
                    <span className="muted">
                      {' '}
                      · {kindOf(o)} · {check.rank}/{check.ranks}
                    </span>
                  </span>
                  <button className="tb-btn small" disabled={!check.ok} aria-label={`Learn ${o.name}`} title={check.ok ? `Costs ${describeCost(project, o)}` : check.needs} onClick={() => onLearn(o.id)}>
                    {check.ok ? `Learn · ${describeCost(project, o)}` : check.rank >= check.ranks ? 'Learned' : 'Learn'}
                  </button>
                  {!check.ok && check.rank < check.ranks && <span className="pref-hint play-skill-needs">{check.needs}</span>}
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
};
