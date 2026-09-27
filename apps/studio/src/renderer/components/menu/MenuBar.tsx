import { useEffect, useRef, useState } from 'react';

export type MenuItem =
  | { kind?: 'item'; label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; checked?: boolean; submenu?: MenuItem[]; hint?: string }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string };

export interface Menu {
  label: string;
  items: MenuItem[];
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut as this platform writes it: "Mod+Shift+S" → ⇧⌘S on a Mac, Ctrl+Shift+S elsewhere. */
export const shortcutLabel = (shortcut: string): string =>
  isMac
    ? shortcut
        .replace('Mod+Shift+', '⇧⌘')
        .replace('Mod+', '⌘')
        .replace('Shift+', '⇧')
        .replace('Alt+', '⌥')
    : shortcut.replace('Mod+', 'Ctrl+');

const enabledIndexes = (items: MenuItem[]) =>
  items.flatMap((item, i) => ((item.kind ?? 'item') === 'item' && !(item as { disabled?: boolean }).disabled ? [i] : []));

const List = ({ items, onDone, depth = 0, label }: { items: MenuItem[]; onDone: () => void; depth?: number; label: string }) => {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (depth > 0) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [depth]);
  const focusAt = (from: number, step: 1 | -1) => {
    const order = enabledIndexes(items);
    if (!order.length) return;
    const at = order.indexOf(from);
    const next = order[(at + step + order.length) % order.length] ?? order[0]!;
    ref.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  };
  return (
    <div ref={ref} className={`menu-list${depth ? ' submenu' : ''}`} role="menu" aria-label={label}>
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={i} className="menu-sep" role="separator" />;
        if (item.kind === 'heading') return <div key={i} className="menu-heading">{item.label}</div>;
        const hasSub = !!item.submenu?.length;
        return (
          <div key={i} className="menu-entry" onPointerEnter={() => setOpen(hasSub ? i : null)}>
            <button
              data-index={i}
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? open === i : undefined}
              disabled={item.disabled || (item.submenu && !hasSub)}
              title={item.hint}
              onClick={() => {
                if (hasSub) {
                  setOpen(open === i ? null : i);
                  return;
                }
                onDone();
                item.onClick?.();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  focusAt(i, 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  focusAt(i, -1);
                } else if (e.key === 'ArrowRight' && hasSub) {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(i);
                } else if (e.key === 'ArrowLeft' && depth > 0) {
                  // The parent list closes this one (see below); the menu bar stays on this menu.
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              <span className="menu-check" aria-hidden="true">
                {item.checked ? '✓' : ''}
              </span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{shortcutLabel(item.shortcut)}</span>}
              {hasSub && <span className="menu-arrow" aria-hidden="true">▸</span>}
            </button>
            {hasSub && open === i && (
              <div
                onKeyDownCapture={(e) => {
                  if (e.key !== 'ArrowLeft') return;
                  setOpen(null);
                  ref.current?.querySelector<HTMLButtonElement>(`[data-index="${i}"]`)?.focus();
                }}
              >
                <List items={item.submenu!} onDone={onDone} depth={depth + 1} label={item.label} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * The studio's menu bar: File, Edit, View, Project, Help. Click a title to
 * open it; while one is open, pointing at another title opens that one.
 * Arrow keys move through items and between menus, Escape closes.
 */
export const MenuBar = ({ menus }: { menus: Menu[] }) => {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
        ref.current?.querySelectorAll<HTMLButtonElement>('.menu-title')[open]?.focus();
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    ref.current?.querySelector<HTMLButtonElement>('.menu-dropdown button:not(:disabled)')?.focus();
  }, [open]);

  const move = (step: 1 | -1) => setOpen((o) => (o === null ? o : (o + step + menus.length) % menus.length));

  return (
    <div ref={ref} className="menubar" role="menubar" aria-label="Menu">
      {menus.map((menu, i) => (
        <div key={menu.label} className="menu-root">
          <button
            className={`menu-title${open === i ? ' open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onPointerDown={(e) => {
              e.preventDefault();
              setOpen(open === i ? null : i);
            }}
            onPointerEnter={() => open !== null && open !== i && setOpen(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(i);
              }
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <div
              className="menu-dropdown"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  move(1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  move(-1);
                }
              }}
            >
              <List items={menu.items} onDone={() => setOpen(null)} label={menu.label} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
