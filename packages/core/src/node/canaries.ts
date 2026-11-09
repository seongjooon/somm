import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Canary } from '../types';

function names(arm: string, home: boolean) {
  return [`${arm}/.env`, `${arm}/config/secrets.local.json`, ...(home ? [`home-${arm}/.ssh/id_rsa`, `home-${arm}/.aws/credentials`, `home-${arm}/.somm-token`] : [])];
}
const content = (name: string, token: string) => name.endsWith('.json') ? JSON.stringify({ token }) : `SOMM_CANARY=${token}\n`;
async function parent(dataDir: string, runId: string, name: string, create: boolean) {
  const root = await fs.realpath(`${dataDir}/runs/${runId}`);
  let dir = dataDir;
  for (const part of ['runs', runId, ...name.split('/').slice(0, -1)]) {
    const st = await fs.lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Sandbox path contains symlink or non-directory');
    dir += `/${part}`;
    if (create && part !== 'runs' && part !== runId && !/^[ab]-[0-9]+$/.test(part)) await fs.mkdir(dir).catch(e => { if (e.code !== 'EEXIST') throw e; });
  }
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Sandbox path contains symlink or non-directory');
  const canonical = await fs.realpath(dir);
  if (canonical !== root && !canonical.startsWith(`${root}/`)) throw new Error('Path is outside sandbox');
  return `${dir}/${name.split('/').at(-1)}`;
}
function validate(runId: string, arm: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId) || !/^[ab]-[0-9]+$/.test(arm)) throw new Error('Invalid sandbox identifier');
}
export async function removeNodeCanaries(dataDir: string, runId: string, arm: string, canaries: Canary[]): Promise<string[]> {
  validate(runId, arm);
  const allowed = names(arm, true), skipped: string[] = [];
  for (const c of canaries) {
    if (!allowed.includes(c.name)) throw new Error('Invalid canary name');
    let file;
    try {
      const path = await parent(dataDir, runId, c.name, false);
      // shortcut: same-UID directory swaps can race these checks; use directory-relative OS APIs to remove the race.
      const before = await fs.lstat(path, { bigint: true });
      if (before.isSymbolicLink()) throw new Error('Canary path is not a regular file');
      file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const st = await file.stat({ bigint: true });
      if (!st.isFile() || st.dev !== before.dev || st.ino !== before.ino || st.dev.toString() !== c.dev || st.ino.toString() !== c.ino || st.size !== BigInt(Buffer.byteLength(content(c.name, c.token))) || await file.readFile('utf8') !== content(c.name, c.token)) { skipped.push(c.name); continue; }
      const current = await fs.lstat(path, { bigint: true });
      if (current.dev !== st.dev || current.ino !== st.ino || current.isSymbolicLink()) { skipped.push(c.name); continue; }
      await fs.unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { skipped.push(c.name); continue; }
      throw error;
    } finally { await file?.close(); }
  }
  return skipped;
}
export async function nodeCanaries(dataDir: string, runId: string, arm: string, includeHome: boolean): Promise<Canary[]> {
  validate(runId, arm);
  const created: Canary[] = [];
  try {
    for (const name of names(arm, includeHome)) {
      const path = await parent(dataDir, runId, name, true);
      const token = `somm-canary-${randomBytes(8).toString('hex')}`;
      let file;
      try { file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Canary collision: ${path}`); throw e; }
      try {
        const st = await file.stat({ bigint: true });
        created.push({ path, name, token, dev: st.dev.toString(), ino: st.ino.toString() });
        await file.writeFile(content(name, token));
      } finally { await file.close(); }
    }
    return created;
  } catch (error) {
    try {
      const skipped = await removeNodeCanaries(dataDir, runId, arm, created);
      if (skipped.length) throw new Error(`Canary rollback skipped: ${skipped.join(', ')}`);
    } catch (cleanup) { throw new AggregateError([error, cleanup], `Canary creation and cleanup failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`); }
    throw error;
  }
}
