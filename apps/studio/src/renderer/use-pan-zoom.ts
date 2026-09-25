import { useEffect, useRef } from 'react';
import { zoomAt, type View } from './view';

/**
 * Is this wheel event a mouse wheel (zoom) or a trackpad scroll (pan)? A mouse
 * wheel moves in whole notches on one axis; a trackpad sends small, often
 * fractional deltas on both.
 */
export const isMouseWheel = (e: WheelEvent): boolean =>
  e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);

const pixels = (e: WheelEvent, delta: number): number => (e.deltaMode === 1 ? delta * 33 : e.deltaMode === 2 ? delta * 800 : delta);

/**
 * The same pan and zoom everywhere a canvas appears: a mouse wheel zooms
 * around the pointer, a trackpad pans with two fingers and zooms with a pinch
 * (Ctrl + wheel), Shift + wheel pans sideways.
 */
export const useWheelPanZoom = (
  rootRef: React.RefObject<HTMLElement | null>,
  setView: (update: (view: View) => View) => void,
): void => {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dy = pixels(e, e.deltaY);
      const dx = pixels(e, e.deltaX);
      if (e.ctrlKey || e.metaKey) {
        // Pinch deltas are small; a Ctrl + mouse wheel notch is ~100.
        const factor = Math.exp(-dy * (Math.abs(dy) < 40 ? 0.01 : 0.0018));
        setView((v) => zoomAt(v, factor, sx, sy));
      } else if (e.shiftKey) {
        setView((v) => ({ ...v, panX: v.panX - (dx || dy) }));
      } else if (isMouseWheel(e)) {
        setView((v) => zoomAt(v, Math.exp(-dy * 0.0018), sx, sy));
      } else {
        setView((v) => ({ ...v, panX: v.panX - dx, panY: v.panY - dy }));
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [rootRef, setView]);
};

/**
 * Drag to pan: left button on empty canvas, middle button anywhere. Returns a
 * pointerdown handler; `onClick` runs when the press did not move (to clear a
 * selection, say).
 */
export const useDragPan = (view: View, setView: (update: (view: View) => View) => void, onClick?: () => void) => {
  const viewRef = useRef(view);
  viewRef.current = view;
  return (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, panX: viewRef.current.panX, panY: viewRef.current.panY };
    let moved = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setView((v) => ({ ...v, panX: start.panX + dx, panY: start.panY + dy }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) onClick?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
};
