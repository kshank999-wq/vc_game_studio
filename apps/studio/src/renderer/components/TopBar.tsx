import { useEffect, useState, type ReactNode } from 'react';
import type { ObjectType } from '../model/types';
import { Symbol } from './Symbol';
import type { SaveState } from '../use-studio';
import { PURCHASE_URL } from '../edition';
import { MenuBar, shortcutLabel, type Menu } from './menu/MenuBar';

export interface Crumb {
  label: string;
  onClick?: () => void;
  symbol?: ObjectType;
}

interface Props {
  menus: Menu[];
  /** In a window beside the main one: what it is for. */
  windowLabel?: string;
  projectName: string;
  /** The project file's name, when it has one. */
  fileName?: string;
  /** Inside a scene: where you are, each step back a link. On the story graph: none. */
  crumbs?: Crumb[];
  /** Controls for the current view (Scene / Mind map, Expand all). */
  viewControls?: ReactNode;
  onRename: (name: string) => void;
  /** Bumped by Project › Rename to start renaming. */
  renameRequest?: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit?: () => void;
  onBible: () => void;
  onEngine: () => void;
  onLevels: () => void;
  levelsOn?: boolean;
  /** The Note Sorter: raw notes into the game. */
  onNotes?: () => void;
  onPuzzles?: () => void;
  puzzlesOn?: boolean;
  /** Comments and changes (spec §16), with how many comments and tasks are open. */
  onComments?: () => void;
  openComments?: number;
  notesOn?: boolean;
  saveState: SaveState;
  issueCount: number;
  onIssues: () => void;
  onSearch: () => void;
  onPlay: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  edited: 'Edited',
  saving: 'Saving…',
  failed: 'Not saved',
  draft: 'Not saved',
  off: 'Saving is off',
};

const SAVE_HINT: Partial<Record<SaveState, string>> = {
  edited: 'Changes since the last save. File › Save (Ctrl+S)',
  failed: 'The last save did not work. Try File › Save As.',
  draft: 'Kept in this browser only. File › Save to keep it in a project file.',
};

export const TopBar = (props: Props) => {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (props.renameRequest) setEditing(true);
  }, [props.renameRequest]);
  return (
    <header className={`topbar${props.crumbs ? ' has-crumbs' : ''}`}>
      <div className="brand">VC GAME STUDIO</div>
      <MenuBar menus={props.menus} />
      {props.windowLabel && (
        <span className="window-chip" title="Works on the main window’s project; saving happens there">
          {props.windowLabel}
        </span>
      )}
      {props.crumbs ? (
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="crumb-project">{props.projectName}</span>
          {props.crumbs.map((c, i) => (
            <span key={i} className="crumb">
              <span className="crumb-sep">/</span>
              {c.onClick ? (
                <button className="crumb-link" onClick={c.onClick}>
                  {c.symbol && <Symbol type={c.symbol} size={12} />}
                  {c.label}
                </button>
              ) : (
                <span className="crumb-here">
                  {c.symbol && <Symbol type={c.symbol} size={12} />}
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      ) : (
        <div className="view-name">STORY GRAPH</div>
      )}
      {props.crumbs ? null : editing ? (
        <input
          className="project-name-input"
          aria-label="Project name"
          defaultValue={props.projectName}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            props.onRename(e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button className="project-name" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
          {props.projectName}
        </button>
      )}
      <div className="grow" />
      <button className="tb-btn search-btn" aria-label="Search" title="Search the project" onClick={props.onSearch}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span className="tb-label">Search</span>
        <kbd>{shortcutLabel('Mod+K')}</kbd>
      </button>
      {props.viewControls}
      {props.saveState === 'off' ? (
        <div className="preview-badge">
          <span className="preview-tag">PREVIEW</span>
          <span>Everything works except saving.</span>
          <a href={PURCHASE_URL} target="_blank" rel="noreferrer">
            Buy or subscribe
          </a>
        </div>
      ) : (
        <div className={`save-state save-${props.saveState}`} title={[props.fileName, SAVE_HINT[props.saveState]].filter(Boolean).join(' · ') || undefined}>
          <span className="save-dot" />
          {SAVE_LABEL[props.saveState]}
        </div>
      )}
      {props.issueCount > 0 && (
        <button className="tb-btn issues-btn" title="Show the next thing to look at" onClick={props.onIssues}>
          <span className="issue-dot" />
          {props.issueCount} to look at
        </button>
      )}
      <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M5 4L2 7l3 3" />
          <path d="M2 7h7a4 4 0 010 8H7" />
        </svg>
      </button>
      <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M11 4l3 3-3 3" />
          <path d="M14 7H7a4 4 0 000 8h2" />
        </svg>
      </button>
      {props.onFit && (
        <button className="tb-btn" title="Zoom to fit (Ctrl+0)" onClick={props.onFit}>
          Fit
        </button>
      )}
      {props.onComments && (
        <button className="tb-btn comments-btn" aria-label={`Comments and changes${props.openComments ? `, ${props.openComments} open` : ''}`} title="Comments, tasks and recent changes" onClick={props.onComments}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {!!props.openComments && <span className="comments-count">{props.openComments}</span>}
        </button>
      )}
      <button className="bible-btn" onClick={props.onBible}>
        GAME BIBLE
      </button>
      {props.onNotes && (
        <button className={`tb-btn levels-btn${props.notesOn ? ' on' : ''}`} title="Sort raw notes into the game: lore, characters, mechanics, scenes, levels" onClick={props.onNotes}>
          NOTES
        </button>
      )}
      {props.onPuzzles && (
        <button className={`tb-btn levels-btn${props.puzzlesOn ? ' on' : ''}`} title="Write puzzles, then build their steps: goals, requirements, clues, interactions" onClick={props.onPuzzles}>
          PUZZLES
        </button>
      )}
      <button className={`tb-btn levels-btn${props.levelsOn ? ' on' : ''}`} title="Lay out levels: rooms, doors, pickups, triggers (Ctrl+L)" onClick={props.onLevels}>
        LEVELS
      </button>
      <button className="tb-btn" aria-label="Play" title="Play the story through (F5)" onClick={props.onPlay}>
        ▶<span className="tb-label"> Play</span>
      </button>
      <button className="tb-btn" onClick={props.onEngine}>
        Engine ▸
      </button>
    </header>
  );
};
