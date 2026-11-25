import type { GitHubClient } from '../github';
import type { Candidate, Repository } from '../types';
import { repositoryCandidates } from './official';

export const COMMUNITY_TOPICS = ['agent-skills', 'claude-skills', 'codex-skills', 'claude-code-skills'];

export async function communityCandidates(gh: GitHubClient, today: string): Promise<Candidate[]> {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const date = cutoff.toISOString().slice(0, 10);
  const repos = new Map<string, Repository>();
  const add = (repo: Repository) => repos.set(`${repo.owner.login}/${repo.name}`.toLowerCase(), repo);
  async function search<T>(query: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await gh.getJson<{ items: T[]; incomplete_results?: boolean }>(`${query}&per_page=100&page=${page}`);
      if (response.incomplete_results) console.warn(`Incomplete GitHub search: ${query}`);
      items.push(...response.items);
      if (response.items.length < 100) break;
    }
    return items;
  }
  for (const topic of COMMUNITY_TOPICS) {
    for (const repo of await search<Repository>(`/search/repositories?q=topic:${topic}+stars:>=50+fork:false+archived:false+pushed:>=${date}`)) add(repo);
  }
  const code = await search<{ repository: { full_name: string } }>(`/search/code?q=filename:SKILL.md`);
  for (const item of code) {
    const name = item.repository.full_name;
    if (!repos.has(name.toLowerCase())) {
      try { add(await gh.getJson<Repository>(`/repos/${name}`)); }
      catch (error) { console.warn(`Skipping ${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  const result: Candidate[] = [];
  for (const [name, repo] of repos) {
    if (name === 'anthropics/skills' || name === 'openai/skills' || repo.stargazers_count < 50 || repo.archived || repo.fork || !repo.pushed_at || repo.pushed_at < date) continue;
    try { result.push(...await repositoryCandidates(gh, repo, 'github')); }
    catch (error) { console.warn(`Skipping ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}
