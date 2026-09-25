import { contentBounds, laneRows, nodeBox, spineSequence } from './model/layout';
import type { Project } from './model/types';

/**
 * Presentation state (HANDOFF: ViewState). Nothing here changes the story.
 * Screen = world × zoom + pan, in canvas pixels.
 */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Room the sticky track headers take on the left of the canvas. */
export const HEADER_W = 130;
const MARGIN = 48;

export const zoomAt = (view: View, factor: number, sx: number, sy: number): View => {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return { zoom, panX: sx - (sx - view.panX) * k, panY: sy - (sy - view.panY) * k };
};

/** Fit a world box into the canvas, clear of the track headers. */
const fitBox = (box: { x: number; y: number; w: number; h: number }, width: number, height: number, maxZoom = 1): View => {
  const usableW = Math.max(100, width - HEADER_W - MARGIN * 2);
  const usableH = Math.max(100, height - MARGIN * 2);
  const zoom = clampZoom(Math.min(maxZoom, usableW / Math.max(1, box.w), usableH / Math.max(1, box.h)));
  return {
    zoom,
    panX: HEADER_W + MARGIN + (usableW - box.w * zoom) / 2 - box.x * zoom,
    panY: MARGIN + (usableH - box.h * zoom) / 2 - box.y * zoom,
  };
};

export const fitView = (project: Project, width: number, height: number): View =>
  fitBox(contentBounds(project), width, height);

/** Zoom to spine (spec §24): the whole spine across the canvas, the band a third of the way down. */
export const spineView = (project: Project, width: number, height: number): View => {
  const rows = laneRows(project);
  const ids = spineSequence(project);
  const first = ids[0] ? nodeBox(project, ids[0], rows) : null;
  const last = ids.length ? nodeBox(project, ids[ids.length - 1]!, rows) : null;
  const x = first?.x ?? 0;
  const w = last && first ? last.x + last.w - first.x : 600;
  const fitted = fitBox({ x, y: 0, w, h: 150 }, width, height);
  return { ...fitted, panY: height * 0.36 - 75 * fitted.zoom };
};
