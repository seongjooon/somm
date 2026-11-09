import { skillText } from '../types';
import { parse } from 'yaml';
import type { Platform } from '../platform';
import type { SkillMeta, SkillFile } from '../types';

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
const FILE_LIMIT = 1024 * 1024, TOTAL_LIMIT = 10 * FILE_LIMIT;
async function readTree(dir: string, p: Platform, prefix = '', total = { bytes: 0 }): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  for (const entry of (await p.fs.readDir(join(dir, prefix))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isSymlink || entry.name === '.git' || entry.name === '.somm-ready') continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDir) files.push(...await readTree(dir, p, path, total));
    else {
      const file = join(dir, path);
      const check = (size: number) => {
        if (size > FILE_LIMIT) throw new Error('Skill file size limit exceeded (1 MiB)');
        if (total.bytes + size > TOTAL_LIMIT) throw new Error('Skill total size limit exceeded (10 MiB)');
      };
      // A file can grow after this check, so readBytes cannot guarantee an allocation cap.
      check(await p.fs.fileSize(file));
      const bytes = await p.fs.readBytes(file);
      check(bytes.byteLength);
      total.bytes += bytes.byteLength;
      const contents = skillText(bytes) ?? bytes;
      files.push({ path, contents });
    }
  }
  return files;
}
export async function readLocalSkill(dir: string, p: Platform): Promise<{ name: string; files: SkillFile[] }> {
  const files = await readTree(dir, p);
  const skill = files.find(f => f.path === 'SKILL.md');
  if (!skill) throw new Error('Skill directory must contain a regular SKILL.md');
  if (typeof skill.contents !== 'string') throw new Error('SKILL.md must be UTF-8 text');
  const frontmatter = skill.contents.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const name: unknown = frontmatter ? parse(frontmatter[1])?.name : undefined;
  return { name: typeof name === 'string' && name.trim() ? name.trim() : dir.replace(/\/+$/, '').split('/').pop()!, files };
}
function validate(meta: SkillMeta, allowLocal = false) {
  if (meta.path !== '.' && (!meta.path || meta.path.startsWith('/') || /[\\\0\r\n]/.test(meta.path)
    || meta.path.split('/').some(s => !s || s === '.' || s === '..' || s === '.git' || s.startsWith('-')))) {
    throw new Error('Invalid repository skill path');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(meta.ref) || meta.ref.includes('..')) throw new Error('Invalid repository ref');
  if (!(allowLocal && meta.repoUrl.startsWith('/')) && !/^https:\/\/[^\s]+$/.test(meta.repoUrl)) throw new Error('Unsupported repository URL');
  if (/[\0\r\n]/.test(meta.repoUrl)) throw new Error('Invalid repository URL');
}
async function skillDir(root: string, path: string, p: Platform) {
  let dir = root;
  for (const name of path === '.' ? [] : path.split('/')) {
    const entry = (await p.fs.readDir(dir)).find(e => e.name === name);
    if (!entry?.isDir || entry.isSymlink) throw new Error('Skill path is missing or contains a symlink');
    dir = join(dir, name);
  }
  return dir;
}
// Generations are immutable dirs `<key>-<13-digit ms>-<hex>`, visible only once `.somm-ready` is renamed in.
// Readers take the highest ready id, so a refresh that started earlier can never win by finishing later.
const READY = '.somm-ready', GRACE_MS = 10 * 60_000;
async function readyGenerations(cacheDir: string, key: string, p: Platform) {
  const pattern = new RegExp(`^${key}-(\\d{13})-[a-f0-9]{16}$`);
  const names = (await p.fs.readDir(cacheDir).catch(() => [])).filter(e => e.isDir && !e.isSymlink && pattern.test(e.name))
    .map(e => e.name).sort().reverse();
  const ready: string[] = [];
  for (const name of names) if (await p.fs.exists(join(cacheDir, name, READY))) ready.push(name);
  return ready;
}
// Delete a generation only after a newer one has been published for longer than any read should take.
async function prune(cacheDir: string, key: string, p: Platform) {
  let newerSince = Infinity;
  // Each older generation uses the next-newer generation's publication time as its grace anchor.
  for (const name of await readyGenerations(cacheDir, key, p)) {
    const publishedAt = Number(await p.fs.readText(join(cacheDir, name, READY)).catch(() => NaN)) || Date.now();
    if (Date.now() - newerSince > GRACE_MS) await p.fs.remove(join(cacheDir, name));
    newerSince = publishedAt;
  }
  const pattern = new RegExp(`^${key}-(\\d{13})-[a-f0-9]{16}$`);
  for (const entry of await p.fs.readDir(cacheDir)) {
    const match = pattern.exec(entry.name);
    if (!match || !entry.isDir || entry.isSymlink || Date.now() - Number(match[1]) <= GRACE_MS) continue;
    const dir = join(cacheDir, entry.name);
    if (!await p.fs.exists(join(dir, READY))) await p.fs.remove(dir);
  }
}
async function fetchUncached(meta: SkillMeta, p: Platform, refresh = false, allowLocal = false): Promise<SkillFile[]> {
  validate(meta, allowLocal);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify([meta.repoUrl, meta.ref, meta.path])));
  const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const cacheDir = join(p.dataDir, 'cache');
  if (!refresh) {
    const [latest] = await readyGenerations(cacheDir, key, p);
    if (latest) return (await readLocalSkill(await skillDir(join(cacheDir, latest), meta.path, p), p)).files;
  }
  const { git } = await p.proc.which(['git']);
  if (!git) throw new Error('git is required to fetch skills');
  await p.fs.mkdirp(cacheDir);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
  const stage = join(cacheDir, `${key}-${String(Date.now()).padStart(13, '0')}-${random}`);
  let published = false;
  const run = async (args: string[], cwd?: string) => {
    const result = await p.proc.run(git, ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', ...args],
      { cwd, env: { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    if (result.code !== 0) throw new Error(`Git skill fetch failed (${args[0]})`);
  };
  try {
    const commit = /^[a-f0-9]{40}$/i.test(meta.ref);
    await run(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--no-checkout',
      ...(commit ? [] : ['--branch', meta.ref]), '--', meta.repoUrl, stage]);
    if (commit) await run(['fetch', '--depth', '1', 'origin', meta.ref], stage);
    if (meta.path === '.') await run(['sparse-checkout', 'disable'], stage);
    else await run(['sparse-checkout', 'set', '--cone', '--', meta.path], stage);
    await run(['checkout', '--detach', commit ? 'FETCH_HEAD' : 'HEAD'], stage);
    const files = (await readLocalSkill(await skillDir(stage, meta.path, p), p)).files;
    await p.fs.writeText(join(stage, '.git', READY), String(Date.now()));
    await p.fs.rename(join(stage, '.git', READY), join(stage, READY));
    published = true;
    await prune(cacheDir, key, p).catch(() => undefined);
    return files;
  } finally {
    if (!published) await p.fs.remove(stage);
  }
}

const pending = new WeakMap<Platform, Map<string, Promise<SkillFile[]>>>();
// Cached refs are immutable until explicitly refreshed; failed refresh retains the prior cache.
export function fetchSkillFiles(meta: SkillMeta, p: Platform, options: { refresh?: boolean; allowLocal?: boolean } = {}): Promise<SkillFile[]> {
  let requests = pending.get(p);
  if (!requests) { requests = new Map(); pending.set(p, requests); }
  const key = JSON.stringify([meta.repoUrl, meta.ref, meta.path, !!options.allowLocal]);
  const existing = requests.get(key);
  if (existing) return options.refresh ? existing.catch(() => undefined).then(() => fetchSkillFiles(meta, p, options)) : existing;
  const request = fetchUncached(meta, p, options.refresh, options.allowLocal).finally(() => requests!.delete(key));
  requests.set(key, request);
  return request;
}
