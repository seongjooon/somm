import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Fs } from '../platform';
import { nodeCanaries } from './canaries';
export const nodeFs: Fs = {
  fileSize: async p => (await fs.lstat(p)).size,
  createCanaries: (dataDir, runId, arm, home) => nodeCanaries(dataDir, runId, arm, home),
  async removeCanaries(dataDir, runId, arm, home) { await nodeCanaries(dataDir, runId, arm, home, true); },
  async snapshotSandboxGitConfig(dataDir, base) {
    if (!base.startsWith(`${dataDir}/`) || base.slice(dataDir.length + 1).split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid sandbox base');
    const dirs = [dataDir];
    for (const part of `${base.slice(dataDir.length + 1)}/.git`.split('/')) dirs.push(`${dirs[dirs.length - 1]}/${part}`);
    const identities = await Promise.all(dirs.map(async dir => {
      const s = await fs.lstat(dir);
      if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Sandbox path contains symlink or non-directory');
      return { dev: s.dev, ino: s.ino };
    }));
    const validate = async () => {
      for (let i = 0; i < dirs.length; i++) {
        const s = await fs.lstat(dirs[i]);
        if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== identities[i].dev || s.ino !== identities[i].ino) throw new Error('Sandbox directory changed');
      }
    };
    const config = `${base}/.git/config`;
    const handle = await fs.open(config, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let contents: Buffer;
    try { if (!(await handle.stat()).isFile()) throw new Error('Sandbox git config is not a regular file'); contents = await handle.readFile(); } finally { await handle.close(); }
    await validate();
    return { async restore() {
      await validate();
      if ((await fs.lstat(config)).isSymbolicLink()) throw new Error('Sandbox git config is a symlink');
      const temp = `${base}/.git/.somm-config-${randomUUID()}`;
      const tempHandle = await fs.open(temp, 'wx', 0o600);
      // shortcut: same-UID directory swaps can race path operations; use directory-relative OS APIs for stronger isolation.
      try { await tempHandle.writeFile(contents); await tempHandle.close(); await validate(); await fs.rename(temp, config); }
      finally { await tempHandle.close().catch(() => {}); await validate().then(() => fs.rm(temp, { force: true })).catch(() => {}); }
    }, async dispose() {} };
  },
  readBytes: async p => new Uint8Array(await fs.readFile(p)),
  writeBytes: (p, bytes) => fs.writeFile(p, bytes),
  async exists(p) {
    try { await fs.lstat(p); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  },
  async isSymlink(p) { return (await fs.lstat(p)).isSymbolicLink(); },
  readText: p => fs.readFile(p, 'utf8'),
  writeText: (p, s) => fs.writeFile(p, s, 'utf8'),
  async readDir(p) { return (await fs.readdir(p, { withFileTypes: true })).map(e => ({ name: e.name, isDir: e.isDirectory(), isSymlink: e.isSymbolicLink() })); },
  async mkdirp(p) { await fs.mkdir(p, { recursive: true }); },
  remove: p => fs.rm(p, { recursive: true, force: true }),
  readlink: fs.readlink,
  rename: fs.rename,
  symlink: fs.symlink,
};
