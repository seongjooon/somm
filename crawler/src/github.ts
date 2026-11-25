export interface GitHubClient { getJson<T>(path: string): Promise<T> }

export function createGitHubClient(token: string | undefined, options: { minIntervalMs?: number; fetchImpl?: typeof fetch } = {}): GitHubClient {
  const { minIntervalMs = 2500, fetchImpl = fetch } = options;
  let next = 0;
  let queue: Promise<void> = Promise.resolve();
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));
  async function request(path: string): Promise<Response> {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (next > Date.now()) await wait(next - Date.now());
      next = Date.now() + minIntervalMs;
      return await fetchImpl(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } finally { release(); }
  }
  return { async getJson<T>(path: string): Promise<T> {
    let response = await request(path);
    if (response.status === 403 || response.status === 429) {
      const retry = response.headers.get('retry-after');
      const reset = response.headers.get('x-ratelimit-reset');
      const retryTime = retry ? (Number.isFinite(Number(retry)) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : reset ? Number(reset) * 1000 : Date.now();
      if (Number.isFinite(retryTime)) await wait(retryTime - Date.now());
      response = await request(path);
    }
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
    return await response.json() as T;
  } };
}
