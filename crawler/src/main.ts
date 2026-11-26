import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodePlatform } from '@somm/core/node';
import { DEFAULT_INDEX_URL, parseIndex, type SkillMeta } from '@somm/core';
import { createGitHubClient } from './github';
import { officialCandidates } from './sources/official';
import { communityCandidates } from './sources/community';
import { collapseCopies, enrich, skillId, officialIds } from './enrich';
import { merge } from './merge';
import type { Candidate } from './types';

async function previousFile(url: string): Promise<string | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Fetching ${url}: HTTP ${response.status}`);
  return response.text();
}
async function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[index + 1];
  };
  const out = option('--out', 'out');
  const maxRepos = Number(option('--max-community-repos', 'Infinity'));
  if (!(maxRepos >= 0) || (Number.isFinite(maxRepos) && !Number.isInteger(maxRepos))) throw new Error('Invalid community repo limit');
  const today = new Date().toISOString().slice(0, 10);
  const [indexText, failuresText] = await Promise.all([previousFile(DEFAULT_INDEX_URL), previousFile(new URL('failures.json', DEFAULT_INDEX_URL).href)]);
  const previous = indexText ? parseIndex(indexText) : [];
  const failureDays = failuresText ? JSON.parse(failuresText) as Record<string, number> : {};
  if (!failureDays || typeof failureDays !== 'object' || Array.isArray(failureDays) || Object.values(failureDays).some(n => !Number.isInteger(n) || n < 0)) throw new Error('Invalid failures.json');
  if (!process.env.SOMM_DATA_DIR) process.env.SOMM_DATA_DIR = await mkdtemp(join(tmpdir(), 'somm-crawl-'));
  const platform = await createNodePlatform();
  const gh = createGitHubClient(process.env.GITHUB_TOKEN);
  const sourcesFailed: string[] = [];
  let official: Candidate[] = [], community: Candidate[] = [];
  try { official = await officialCandidates(gh); } catch (error) { sourcesFailed.push('official'); console.warn('Official source failed:', error); }
  const officialIdsResult = officialIds(official);
  const resolvedIds = new Map(official.map((c, i) => [c, officialIdsResult[i]]));
  try { community = await communityCandidates(gh, today, maxRepos); } catch (error) { console.warn('Community discovery failed:', error); }
  const candidates = [...official, ...community];
  const fresh: SkillMeta[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < candidates.length) {
      const c = candidates[next++];
      try { const item = await enrich(platform, c); item.id = resolvedIds.get(c) ?? item.id; fresh.push(item); } catch (error) { console.warn(`Skipping ${skillId(c)}:`, error); }
    }
  }));
  const result = merge({ today, previous, fresh: collapseCopies(fresh), failureDays, sourcesFailed });
  if (!result.publish) { console.error(`Publish blocked: ${result.reason}`); process.exitCode = 1; return; }
  const json = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), skills: result.skills }, null, 2);
  if (parseIndex(json).length !== result.skills.length) throw new Error('Output index failed validation');
  await mkdir(join(out, 'snapshots'), { recursive: true });
  await Promise.all([writeFile(join(out, 'index.json'), json), writeFile(join(out, 'failures.json'), JSON.stringify(result.failureDays, null, 2)), writeFile(join(out, 'snapshots', `${today}.json`), json)]);
  console.log(`Published ${result.skills.filter(s => s.source !== 'github').length} official and ${result.skills.filter(s => s.source === 'github').length} community skills`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
