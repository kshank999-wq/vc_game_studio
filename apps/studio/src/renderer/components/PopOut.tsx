import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel pulled out into a window of its own, to put on another screen. The
 * window is a child of this one: the panel goes on running here (one project,
 * one undo history, live as you edit), only drawn over there, with this
 * window's styles and theme copied across and kept in step. Closing the
 * window docks the panel again; so does closing or reloading this one.
 */
export const PopOut = ({ id, title, width = 420, height = 760, className, onClose, onBlocked, onWindow, children }: { id: string; title: string; width?: number; height?: number; className?: string; onClose: () => void; onBlocked?: () => void; onWindow?: (w: Window | null) => void; children: ReactNode }) => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const win = useRef<Window | null>(null);
  const closing = useRef(onClose);
  closing.current = onClose;
  const told = useRef(onWindow);
  told.current = onWindow;
  useEffect(() => {
    const left = Math.max(0, (window.screenX ?? 0) + (window.outerWidth ?? 1200) - width - 40);
    const top = Math.max(0, (window.screenY ?? 0) + 60);
    const w = window.open('', `vcgs-panel-${id}`, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!w) {
      onBlocked?.();
      closing.current();
      return;
    }
    win.current = w;
    const doc = w.document;
    doc.title = `${title} — VC Game Studio`;
    // This window's styles, its fonts and theme, and any added later (lazy views bring their own).
    // The rules themselves go across (a blank window doesn't load this one's stylesheet files);
    // a sheet whose rules can't be read (the web fonts) goes across as a link.
    const inline = (sheet: CSSStyleSheet | null) => {
      try {
        const rules = sheet?.cssRules;
        if (!rules) return false;
        const st = doc.createElement('style');
        st.textContent = Array.from(rules, (r) => r.cssText).join('\n');
        doc.head.appendChild(st);
        return true;
      } catch {
        return false;
      }
    };
    const copy = (node: Node) => {
      if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
        const asLink = () => {
          const l = doc.createElement('link');
          l.rel = 'stylesheet';
          l.href = node.href;
          doc.head.appendChild(l);
        };
        if (node.sheet) {
          if (!inline(node.sheet)) asLink();
        } else node.addEventListener('load', () => inline(node.sheet) || asLink(), { once: true });
      } else if (node instanceof HTMLStyleElement) {
        const st = doc.createElement('style');
        st.textContent = node.textContent;
        doc.head.appendChild(st);
      }
    };
    doc.head.innerHTML = '<meta charset="utf-8" />';
    document.head.childNodes.forEach(copy);
    const headWatch = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(copy)));
    headWatch.observe(document.head, { childList: true });
    const syncTheme = () => {
      const src = document.documentElement;
      const dst = doc.documentElement;
      for (const a of [...dst.attributes]) dst.removeAttribute(a.name);
      for (const a of [...src.attributes]) dst.setAttribute(a.name, a.value);
      doc.body.className = document.body.className;
    };
    syncTheme();
    const themeWatch = new MutationObserver(syncTheme);
    themeWatch.observe(document.documentElement, { attributes: true });
    themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    doc.body.style.margin = '0';
    doc.body.innerHTML = '';
    const root = doc.createElement('div');
    root.className = `popout-root${className ? ` ${className}` : ''}`;
    doc.body.appendChild(root);
    setHost(root);
    told.current?.(w);
    // Shortcuts pressed over there (Delete, undo, the tools) reach the studio here, as if pressed here;
    // typing in a field stays in the field.
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && typeof el.tagName === 'string' && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
    };
    const forward = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      const copy = new KeyboardEvent(e.type, { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true });
      if (!window.dispatchEvent(copy)) e.preventDefault();
    };
    w.addEventListener('keydown', forward);
    w.addEventListener('keyup', forward);
    // Closed over there: back in here.
    const gone = () => closing.current();
    w.addEventListener('pagehide', gone);
    const poll = window.setInterval(() => w.closed && gone(), 500);
    const leave = () => w.close();
    window.addEventListener('pagehide', leave);
    return () => {
      told.current?.(null);
      w.removeEventListener('keydown', forward);
      w.removeEventListener('keyup', forward);
      window.clearInterval(poll);
      headWatch.disconnect();
      themeWatch.disconnect();
      window.removeEventListener('pagehide', leave);
      w.removeEventListener('pagehide', gone);
      if (!w.closed) w.close();
      win.current = null;
    };
    // The window is made once per pop-out.
  }, []);
  return host ? createPortal(children, host) : null;
};
