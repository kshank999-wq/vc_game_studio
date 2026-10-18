import type { ReactNode } from 'react';
import { Text } from '../defense/fields';

/** Parts every module's own workspace shares: a pane's heading, and the concept step. */

export const Intro = ({ title, children }: { title: string; children: ReactNode }) => (
  <header className="dfn-intro">
    <h2>{title}</h2>
    <p>{children}</p>
  </header>
);

export interface Concept {
  premise?: string;
  theme?: string;
  platform?: 'mobile' | 'pc' | 'console' | 'web';
  notes?: string;
}

export const ConceptPane = ({ concept, set, premiseHint, themeHint, notesHint }: { concept: Concept; set: (patch: Partial<Concept>) => void; premiseHint: string; themeHint: string; notesHint: string }) => (
  <div className="dfn-pane narrow">
    <Intro title="Concept">What the game is, in a few lines. Keep it rough: you will come back to it.</Intro>
    <Text label="Premise" area value={concept.premise ?? ''} placeholder={premiseHint} onCommit={(v) => set({ premise: v })} />
    <Text label="Theme and look" value={concept.theme ?? ''} placeholder={themeHint} onCommit={(v) => set({ theme: v })} />
    <label className="dfn-text">
      <span>Platform</span>
      <select className="inp small" value={concept.platform ?? 'mobile'} aria-label="Platform" onChange={(e) => set({ platform: e.target.value as Concept['platform'] })}>
        <option value="mobile">Phone and tablet</option>
        <option value="pc">PC</option>
        <option value="console">Console</option>
        <option value="web">Web</option>
      </select>
    </label>
    <Text label="Notes" area value={concept.notes ?? ''} placeholder={notesHint} onCommit={(v) => set({ notes: v })} />
  </div>
);

/** A module workspace's tabs down the side, one a step, and what to look at under them. */
export const StepTabs = <T extends string>({ label, tabs, tab, onTab, issues }: { label: string; tabs: readonly { id: T; label: string }[]; tab: T; onTab: (t: T) => void; issues: readonly { severity: string; message: string }[] }) => (
  <nav className="dfn-tabs" aria-label={label}>
    {tabs.map((t, i) => (
      <button key={t.id} className={`dfn-tab${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
        <span className="dfn-tab-num">{i + 1}</span> {t.label}
      </button>
    ))}
    {issues.length ? (
      <div className="dfn-issues" role="status">
        <h4>To look at</h4>
        <ul>
          {issues.map((x, i) => (
            <li key={i} className={x.severity}>
              {x.message}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </nav>
);
