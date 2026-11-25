import type { Platform } from '../platform';
import type { SkillMeta } from '../types';
import { createSampleSource } from './index';
import { DEFAULT_INDEX_URL, INDEX_TIMEOUT_MS, parseIndex } from './index-source';

export interface CatalogOptions { url?: string; fetchText?: (url: string) => Promise<string> }
export async function loadCatalog(p: Platform, options: CatalogOptions = {}): Promise<{ skills: SkillMeta[]; origin: 'remote' | 'cache' | 'sample' }> {
  try {
    const fetchText = options.fetchText ?? (async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`Index request failed: ${response.status}`);
      return response.text();
    });
    const skills = parseIndex(await fetchText(options.url ?? DEFAULT_INDEX_URL));
    const now = new Date().toISOString();
    // Pooled connections lack transactions; a failed prune leaves a superset until the next successful load.
    try {
      await p.db.execute(`INSERT OR REPLACE INTO skills_cache (id, json, fetched_at)
      SELECT json_extract(value, '$.id'), value, ? FROM json_each(?)`, [now, JSON.stringify(skills)]);
      await p.db.execute('DELETE FROM skills_cache WHERE id NOT IN (SELECT json_extract(value, \'$.id\') FROM json_each(?))', [JSON.stringify(skills)]);
    } catch { /* The fetched list remains usable without a cache update. */ }
    return { skills, origin: 'remote' };
  } catch {
    try {
      const rows = await p.db.select<{ json: string }>('SELECT json FROM skills_cache');
      const entries = rows.flatMap(row => {
        try { return [JSON.parse(row.json)]; } catch { return []; }
      });
      const skills = parseIndex(JSON.stringify({ skills: entries }));
      if (skills.length) return { skills, origin: 'cache' };
    } catch { /* An unreadable cache falls back to the sample. */ }
    return { skills: await createSampleSource().fetchIndex(), origin: 'sample' };
  }
}
