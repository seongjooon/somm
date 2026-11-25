import type { GitHubClient } from '../github';
import type { Candidate, Repository } from '../types';

export async function repositoryCandidates(gh: GitHubClient, repository: Repository, source: Candidate['source']): Promise<Candidate[]> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const base = `/repos/${owner}/${repo}`;
  const { sha } = await gh.getJson<{ sha: string }>(`${base}/commits/${encodeURIComponent(repository.default_branch)}`);
  const tree = await gh.getJson<{ tree: { path: string; type: string }[]; truncated?: boolean }>(`${base}/git/trees/${sha}?recursive=1`);
  if (tree.truncated) throw new Error(`GitHub tree truncated: ${owner}/${repo}`);
  return tree.tree.filter(item => item.type === 'blob' && (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md'))).map(item => ({
    source, owner, repo, commit: sha, path: item.path === 'SKILL.md' ? '.' : item.path.slice(0, -'/SKILL.md'.length),
    stars: repository.stargazers_count, pushedAt: repository.pushed_at,
    ...(repository.license?.spdx_id ? { license: repository.license.spdx_id } : {}),
    ...(repository.description ? { description: repository.description } : {}),
  }));
}

export async function officialCandidates(gh: GitHubClient): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (const [owner, source] of [['anthropics', 'claude-official'], ['openai', 'codex-official']] as const) {
    const repo = await gh.getJson<Repository>(`/repos/${owner}/skills`);
    result.push(...await repositoryCandidates(gh, repo, source));
  }
  return result;
}
