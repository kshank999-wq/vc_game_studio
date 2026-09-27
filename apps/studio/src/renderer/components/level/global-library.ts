import { useSyncExternalStore } from 'react';
import type { AssetDefinition } from '../../model/level/types';

/**
 * "My library" (spec §4.4): project assets promoted to this computer, for use
 * in any project. Kept in local storage; a project that uses one keeps its
 * own copy when it is placed, so the file still opens elsewhere.
 */

const KEY = 'vcgs.library.v1';
const listeners = new Set<() => void>();
let cache: AssetDefinition[] | null = null;

const read = (): AssetDefinition[] => {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    cache = Array.isArray(parsed) ? (parsed as AssetDefinition[]).filter((a) => a && typeof a.id === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
};

const write = (assets: AssetDefinition[]) => {
  cache = assets;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(assets));
  } catch {
    // Not kept past this session.
  }
  for (const l of listeners) l();
};

export const globalAssets = (): AssetDefinition[] => read();

export const promoteAsset = (asset: AssetDefinition): void => {
  const copy: AssetDefinition = { ...asset, id: asset.id.replace(/^project\./, 'global.'), source: 'global' };
  write([...read().filter((a) => a.id !== copy.id), copy]);
};

export const forgetAsset = (id: string): void => write(read().filter((a) => a.id !== id));

export const useGlobalAssets = (): AssetDefinition[] =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
