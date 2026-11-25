import { describe, it, expect, vi, afterEach } from 'vitest';
import repos from '../../fixtures/repositories.json';
import { officialCandidates } from './official';
import { communityCandidates } from './community';
import { createGitHubClient, type GitHubClient } from '../github';

const sha = 'a'.repeat(40);
function fake(paths: string[], search = repos): GitHubClient {
  return { async getJson<T>(path: string): Promise<T> {
    if (path.startsWith('/search/repositories')) return { items: search } as T;
    if (path.startsWith('/search/code')) return { items: [] } as T;
    if (path.includes('/git/trees/')) return { tree: paths.map(path => ({ path, type: 'blob' })) } as T;
    if (path.includes('/commits/')) return { sha } as T;
    return { ...repos[0], owner: { login: path.split('/')[2] }, name: path.split('/')[3] } as T;
  } };
}

describe('sources', () => {
  it('official finds SKILL.md dirs and pins commit', async () => {
    const result = await officialCandidates(fake(['skills/.curated/yeet/SKILL.md', 'skills/.system/skill-installer/SKILL.md', 'README.md']));
    expect(result.filter(x => x.source === 'codex-official').map(x => [x.path, x.commit])).toEqual([['skills/.curated/yeet', sha], ['skills/.system/skill-installer', sha]]);
  });
  it('community applies thresholds', async () => {
    const result = await communityCandidates(fake(['skills/a/SKILL.md']), '2026-11-25');
    expect(result.map(x => x.repo)).toEqual(['good']);
  });
  it('community skips official repos and keeps copies', async () => {
    const result = await communityCandidates(fake(['skills/a/SKILL.md', '.openclaw/skills/a/SKILL.md']), '2026-11-25');
    expect(result.map(x => x.path)).toEqual(['skills/a', '.openclaw/skills/a']);
  });
  it('root SKILL.md uses dot path', async () => {
    const result = await communityCandidates(fake(['SKILL.md']), '2026-11-25');
    expect(result[0].path).toBe('.');
  });
});

afterEach(() => vi.useRealTimers());
it('client waits between requests and retries once on 429', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } })).mockResolvedValueOnce(new Response('{"ok":true}'));
  const gh = createGitHubClient(undefined, { minIntervalMs: 2500, fetchImpl });
  await gh.getJson('/first');
  const pending = gh.getJson('/second');
  await vi.advanceTimersByTimeAsync(2499);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2500);
  expect(await pending).toEqual({ ok: true });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
