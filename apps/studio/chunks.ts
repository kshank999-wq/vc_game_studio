import type { PreRenderedChunk } from 'rollup';

/**
 * How the renderer is split. React and React DOM sit in a chunk of their own:
 * they change far less often than the app, so a new version of the app leaves
 * them cached. The rest is split where the app loads it on demand
 * (src/renderer/views.ts).
 */
export const vendorChunks = (id: string): string | undefined =>
  /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined;

/**
 * The handoff model's chunk comes from model/handoff/index.ts, so it would be
 * called "index" beside the entry. Name it for what it is. (Only the file name
 * changes; grouping it with manualChunks would drag shared code into it and
 * load it up front.)
 */
export const chunkFileNames = (chunk: PreRenderedChunk): string =>
  /[\\/]model[\\/]handoff[\\/]index\.ts$/.test(chunk.facadeModuleId ?? '') ? 'assets/handoff-[hash].js' : 'assets/[name]-[hash].js';
