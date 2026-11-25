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
  it('community skips a failing repo and keeps the rest', async () => {
    const base = fake(['SKILL.md'], [repos[0], { ...repos[0], name: 'bad' }]);
    const gh: GitHubClient = { async getJson<T>(path: string): Promise<T> {
      if (path.startsWith('/search/code')) return { items: [{ repository: { full_name: 'test/missing' } }] } as T;
      if (path === '/repos/test/missing' || path.includes('/repos/test/bad/git/trees/')) throw new Error('unavailable');
      return base.getJson<T>(path);
    } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await communityCandidates(gh, '2026-11-25');
      expect(result.map(x => x.repo)).toEqual(['good']);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.map(call => String(call[0]))).toEqual(expect.arrayContaining([expect.stringContaining('test/missing'), expect.stringContaining('test/bad')]));
    } finally { warn.mockRestore(); }
  });
  it('incomplete search results are used, not fatal', async () => {
    const base = fake(['SKILL.md'], [repos[0]]);
    const gh: GitHubClient = { async getJson<T>(path: string): Promise<T> {
      if (path.startsWith('/search/repositories')) return { items: [repos[0]], incomplete_results: true } as T;
      return base.getJson<T>(path);
    } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await communityCandidates(gh, '2026-11-25')).map(x => x.repo)).toEqual(['good']);
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
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
