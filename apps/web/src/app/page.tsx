import Link from 'next/link';
import { DEVICES_PER_LICENSE } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const FEATURES: { title: string; body: string; accent: string }[] = [
  {
    title: 'An infinite story spine',
    body: 'Lay the whole game out as a track: acts, scenes, subplot and character lanes. Open a scene into a node map, or play it as a timeline.',
    accent: 'var(--gold)',
  },
  {
    title: 'A Game Bible behind every view',
    body: 'Characters, items, lore, skills, equipment, recipes, quests and encounters, each with states and rules the whole game reads.',
    accent: 'var(--c-skill)',
  },
  {
    title: 'Levels in 2D and 3D',
    body: 'From world map to room: draw floors, doors and volumes, place what the story needs, and walk it in a graybox.',
    accent: 'var(--c-scene)',
  },
  {
    title: 'A Puzzle Creator that checks itself',
    body: 'Steps, gates, clues and staged hints, keypads, dials and circuits, and a solver that says whether the player can finish it.',
    accent: 'var(--c-puzzle)',
  },
  {
    title: 'Play it before it exists',
    body: 'Play-through and Play Mode run the game as written: choices, inventory, saves, and the paths you expect players to take.',
    accent: 'var(--c-object)',
  },
  {
    title: 'Straight into your engine',
    body: 'Export to Godot 4, Unity or Unreal Engine 5: state, rules, quests, puzzles and levels as working code, and your own code kept on re-export.',
    accent: 'var(--gold-hi)',
  },
];

export default function Home() {
  return (
    <>
      <div className="hero">
        <div className="eyebrow">For Mac and Windows</div>
        <h1>
          From story <span>to engine.</span>
        </h1>
        <p className="lede">
          VC Game Studio is a desktop app for designing games visually — the story, the world, the levels and the puzzles — and
          handing the whole thing to Godot, Unity or Unreal as code that runs. Your projects are files on your own computer.
        </p>
        <div className="actions">
          <Link className="button" href="/pricing">
            See plans
          </Link>
          <a className="button secondary" href="/preview">
            Try it in your browser
          </a>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          The browser preview is the whole app; it just does not save. Subscribe to download it and keep your work.
        </p>
      </div>

      <section id="features">
        <h2>What is in it</h2>
        <div className="grid three">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="panel feature" style={{ ['--accent' as string]: feature.accent }}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="panel grid two" style={{ alignItems: 'center' }}>
          <div>
            <h2>Two plans, one account</h2>
            <p className="muted">
              VC Game Writer is the whole design tool. VC Game Studio adds the engine handoff. Monthly or yearly; each license
              runs on {DEVICES_PER_LICENSE} computers, Mac or Windows. Already a VC Writer customer? Sign in with the same
              account.
            </p>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Link className="button" href="/pricing">
              Pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
