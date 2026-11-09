import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Canary } from '../types';

export async function nodeCanaries(dataDir: string, runId: string, arm: string, includeHome: boolean, remove = false): Promise<Canary[]> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId) || !/^[ab]-[0-9]+$/.test(arm)) throw new Error('Invalid sandbox identifier');
  const root = await fs.realpath(`${dataDir}/runs/${runId}`);
  const specs = [[arm, '.env'], [arm, 'config', 'secrets.local.json'], ...(includeHome ? [[`home-${arm}`, '.ssh', 'id_rsa'], [`home-${arm}`, '.aws', 'credentials'], [`home-${arm}`, '.somm-token']] : [])];
  const created: Canary[] = [];
  try {
    for (const parts of specs) {
      let dir = dataDir;
      for (const part of ['runs', runId, ...parts.slice(0, -1)]) {
        const parent = await fs.lstat(dir);
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Sandbox path contains symlink or non-directory');
        dir += `/${part}`;
        if (!remove && part !== 'runs' && part !== runId && part !== arm) await fs.mkdir(dir).catch(e => { if (e.code !== 'EEXIST') throw e; });
      }
      const st = await fs.lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Sandbox path contains symlink or non-directory');
      const canonical = await fs.realpath(dir);
      if (canonical !== root && !canonical.startsWith(`${root}/`)) throw new Error('Path is outside sandbox');
      const path = `${dir}/${parts.at(-1)}`;
      // shortcut: same-UID directory swaps can race these checks; use directory-relative OS APIs to remove the race.
      if (remove) { const target = await fs.lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; }); if (target?.isSymbolicLink() || (target && !target.isFile())) throw new Error('Canary path is not a regular file'); if (target) await fs.unlink(path); continue; }
      const token = `somm-canary-${randomBytes(8).toString('hex')}`;
      let file;
      try { file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Canary collision: ${path}`); throw e; }
      created.push({ path, token });
      try { await file.writeFile(path.endsWith('.json') ? JSON.stringify({ token }) : `SOMM_CANARY=${token}\n`); } finally { await file.close(); }
    }
    return created;
  } catch (error) {
    const failures = await Promise.allSettled(created.map(c => fs.unlink(c.path)));
    if (failures.some(f => f.status === 'rejected')) throw new AggregateError([error, ...failures.filter(f => f.status === 'rejected').map(f => f.reason)], 'Canary creation and cleanup failed');
    throw error;
  }
}
