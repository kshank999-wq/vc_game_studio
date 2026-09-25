import { useState, type ReactNode } from 'react';
import type { ObjectType } from '../model/types';
import { Symbol } from './Symbol';
import type { SaveState } from '../use-studio';
import { PURCHASE_URL } from '../edition';

export interface Crumb {
  label: string;
  onClick?: () => void;
  symbol?: ObjectType;
}

interface Props {
  projectName: string;
  /** Inside a scene: where you are, each step back a link. On the story graph: none. */
  crumbs?: Crumb[];
  /** Controls for the current view (Scene / Mind map, Expand all). */
  viewControls?: ReactNode;
  onRename: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit?: () => void;
  onBible: () => void;
  onEngine: () => void;
  saveState: SaveState;
  issueCount: number;
  onIssues: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  failed: 'Not saved',
  off: 'Saving is off',
};

export const TopBar = (props: Props) => {
  const [editing, setEditing] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">VC GAME STUDIO</div>
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
        <div className={`save-state save-${props.saveState}`}>
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
      <button className="bible-btn" onClick={props.onBible}>
        GAME BIBLE
      </button>
      <button className="tb-btn" onClick={props.onEngine}>
        Engine ▸
      </button>
    </header>
  );
};
