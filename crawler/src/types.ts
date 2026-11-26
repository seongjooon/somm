export interface Candidate {
  source: 'claude-official' | 'codex-official' | 'github';
  owner: string;
  repo: string;
  commit: string;
  path: string;
  stars: number;
  license?: string;
  pushedAt: string;
  description?: string;
}

export interface Repository {
  name: string;
  owner: { login: string };
  default_branch: string;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  license?: { spdx_id: string } | null;
  description?: string | null;
}
