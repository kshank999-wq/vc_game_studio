import { decodeMesh } from '../../model/level/models';

/**
 * Reading what the designer brings in (spec V2 §10): pictures to trace over,
 * kept small enough to live in the project, and the pictures an imported
 * model is shown by in the library and on the map.
 */

/** The longest side a reference picture is kept at. */
export const MAX_REFERENCE_PX = 1600;

const asDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

export const asArrayBuffer = (file: Blob): Promise<ArrayBuffer> =>
  typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as ArrayBuffer);
        r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
        r.readAsArrayBuffer(file);
      });

/**
 * A picture as a data URL, scaled down to MAX_REFERENCE_PX on its longest
 * side, and its size as it was (so metres per pixel means the original's pixels).
 */
export const readImage = async (file: Blob): Promise<{ image: string; pixels: { w: number; h: number } }> => {
  const url = await asDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That file is not a picture this browser can read.'));
    i.src = url;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const k = Math.min(1, MAX_REFERENCE_PX / Math.max(w, h, 1));
  if (k >= 1 && url.length < 1_500_000) return { image: url, pixels: { w, h } };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { image: url, pixels: { w, h } };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL('image/jpeg', 0.82), pixels: { w, h } };
};

/**
 * Two small pictures of a model's kept shape (in its unit box, stretched to
 * its size): a three-quarter view for the library and the plan from above for
 * the map. Faces are drawn back to front and shaded by how they face the light.
 * Undefined where there is no canvas.
 */
export const modelPictures = (mesh: string, size: { w: number; d: number; h: number }, color = '#a59c86'): { thumbnail?: string; plan?: string } => {
  const unit = decodeMesh(mesh);
  if (!unit.length || typeof document === 'undefined') return {};
  const draw = (px: number, project: (x: number, y: number, z: number) => [number, number, number], aspect: number, transparent: boolean): string | undefined => {
    const canvas = document.createElement('canvas');
    canvas.width = aspect >= 1 ? px : Math.max(8, Math.round(px * aspect));
    canvas.height = aspect >= 1 ? Math.max(8, Math.round(px / aspect)) : px;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return undefined;
    }
    if (!ctx) return undefined;
    if (!transparent) {
      ctx.fillStyle = '#16140f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tris: { pts: [number, number][]; depth: number; light: number }[] = [];
    const s = [size.w, size.h, size.d];
    const big = Math.max(...s);
    for (let i = 0; i + 8 < unit.length; i += 9) {
      const p = [0, 1, 2].map((c) => project((unit[i + c * 3]! * s[0]!) / big, (unit[i + c * 3 + 1]! * s[1]!) / big, (unit[i + c * 3 + 2]! * s[2]!) / big));
      const [a, b, c] = p as [[number, number, number], [number, number, number], [number, number, number]];
      // The face's normal in view space, for its shade.
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      const light = Math.abs((n[0]! * -0.4 + n[1]! * -0.6 + n[2]! * 0.7) / len);
      tris.push({ pts: [a, b, c].map((q) => [q[0], q[1]] as [number, number]), depth: (a[2] + b[2] + c[2]) / 3, light });
    }
    tris.sort((x, y) => x.depth - y.depth);
    const W = canvas.width;
    const H = canvas.height;
    // The plan fills its canvas edge to edge; the thumbnail sits inside a margin.
    const kx = transparent ? W : Math.min(W, H) * 0.8;
    const ky = transparent ? H : Math.min(W, H) * 0.8;
    const base = parseInt(color.slice(1), 16);
    const [r0, g0, b0] = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    for (const t of tris) {
      const k = 0.45 + 0.55 * t.light;
      ctx.fillStyle = `rgb(${Math.round(r0 * k)},${Math.round(g0 * k)},${Math.round(b0 * k)})`;
      ctx.beginPath();
      t.pts.forEach(([x, y], j) => (j ? ctx!.lineTo(W / 2 + x * kx, H / 2 + y * ky) : ctx!.moveTo(W / 2 + x * kx, H / 2 + y * ky)));
      ctx.closePath();
      ctx.fill();
    }
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  };
  // Three-quarter: turned 35° about up, tipped 30° towards the viewer; y down the canvas.
  const ca = Math.cos(0.6);
  const sa = Math.sin(0.6);
  const cb = Math.cos(0.52);
  const sb = Math.sin(0.52);
  const thumbnail = draw(
    96,
    (x, y, z) => {
      const rx = x * ca - z * sa;
      const rz = x * sa + z * ca;
      return [rx, -(y * cb - rz * sb), y * sb + rz * cb];
    },
    1,
    false,
  );
  // From above: x east, z south, height towards the viewer; stretched over the footprint on the map.
  const big = Math.max(size.w, size.h, size.d);
  const plan = draw(
    128,
    (x, y, z) => [(x * big) / size.w, (z * big) / size.d, y],
    size.w / size.d,
    true,
  );
  return { ...(thumbnail ? { thumbnail } : {}), ...(plan ? { plan } : {}) };
};
