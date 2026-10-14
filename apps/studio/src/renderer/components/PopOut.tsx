import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel pulled out into a window of its own, to put on another screen. The
 * window is a child of this one: the panel goes on running here (one project,
 * one undo history, live as you edit), only drawn over there, with this
 * window's styles and theme copied across and kept in step. Closing the
 * window docks the panel again; so does closing or reloading this one.
 */
export const PopOut = ({ id, title, width = 420, height = 760, className, onClose, onBlocked, children }: { id: string; title: string; width?: number; height?: number; className?: string; onClose: () => void; onBlocked?: () => void; children: ReactNode }) => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const win = useRef<Window | null>(null);
  const closing = useRef(onClose);
  closing.current = onClose;
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
    const copy = (node: Node) => {
      if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = node.href;
        doc.head.appendChild(l);
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
    // Closed over there: back in here.
    const gone = () => closing.current();
    w.addEventListener('pagehide', gone);
    const poll = window.setInterval(() => w.closed && gone(), 500);
    const leave = () => w.close();
    window.addEventListener('pagehide', leave);
    return () => {
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
