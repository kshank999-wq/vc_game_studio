import { contentBounds, laneRows, nodeBox, spanRange } from '../../model/layout';
import type { Project } from '../../model/types';
import type { View } from '../../view';

const MINI_W = 160;
const MINI_H = 100;

/** The whole story at a glance, with the view's rectangle; click to jump there. */
export const Minimap = ({ project, view, width, height, onJump }: {
  project: Project;
  view: View;
  width: number;
  height: number;
  onJump: (x: number, y: number) => void;
}) => {
  const rows = laneRows(project);
  const content = contentBounds(project);
  const viewport = { x: -view.panX / view.zoom, y: -view.panY / view.zoom, w: width / view.zoom, h: height / view.zoom };
  const pad = 120;
  const minX = Math.min(content.x - pad, viewport.x);
  const maxX = Math.max(content.x + content.w + pad, viewport.x + viewport.w);
  const minY = Math.min(content.y - pad, viewport.y);
  const maxY = Math.max(content.y + content.h + pad, viewport.y + viewport.h);
  const k = Math.min(MINI_W / (maxX - minX), MINI_H / (maxY - minY));
  const mx = (x: number) => (x - minX) * k;
  const my = (y: number) => (y - minY) * k;
  return (
    <div
      className="minimap"
      aria-label="Minimap"
      onPointerDown={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onJump((e.clientX - rect.left) / k + minX, (e.clientY - rect.top) / k + minY);
      }}
    >
      {rows.map((row) => {
        const range = row.lane.kind === 'subplot' ? spanRange(project, row.lane) : null;
        if (row.lane.kind === 'subplot' && !range) return null;
        const style = {
          top: my(row.top),
          height: Math.max(2, row.height * k),
          '--lane': row.lane.color,
          ...(range ? { left: mx(range.from), width: Math.max(2, (range.to - range.from) * k), right: 'auto' } : {}),
        } as React.CSSProperties;
        return <div key={row.lane.id} className={`mini-track mini-${row.lane.kind}`} style={style} />;
      })}
      {Object.keys(project.placements).map((id) => {
        const box = nodeBox(project, id, rows);
        const object = project.objects[id];
        if (!box || !object) return null;
        return (
          <div
            key={id}
            className={`mini-node mini-${object.type}`}
            style={{ left: mx(box.x), top: my(box.y), width: Math.max(2, box.w * k), height: Math.max(2, box.h * k) }}
          />
        );
      })}
      <div className="mini-viewport" style={{ left: mx(viewport.x), top: my(viewport.y), width: viewport.w * k, height: viewport.h * k }} />
    </div>
  );
};
