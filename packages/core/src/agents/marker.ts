import type { Platform } from '../platform';
import type { InstalledSkill } from '../types';

export interface InstallMarker { source?: string; hash: string; installedAt: string }

export async function readInstallMarker(p: Platform, item: InstalledSkill): Promise<InstallMarker | null> {
  const path = `${item.dir}/.somm.json`;
  if (!await p.fs.exists(path)) return null;
  const text = await p.fs.readText(path);
  try {
    const marker: unknown = JSON.parse(text);
    if (!marker || typeof marker !== 'object') return null;
    const { source, hash, installedAt } = marker as Record<string, unknown>;
    if (typeof hash !== 'string' || !hash || typeof installedAt !== 'string' || (source !== undefined && typeof source !== 'string')) return null;
    return { source, hash, installedAt };
  } catch { return null; }
}
