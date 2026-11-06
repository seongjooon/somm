import * as fs from 'node:fs/promises';
import type { Fs } from '../platform';
export const nodeFs: Fs = {
  readBytes: async p => new Uint8Array(await fs.readFile(p)),
  writeBytes: (p, bytes) => fs.writeFile(p, bytes),
  async exists(p) {
    try { await fs.lstat(p); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  },
  readText: p => fs.readFile(p, 'utf8'),
  writeText: (p, s) => fs.writeFile(p, s, 'utf8'),
  async readDir(p) { return (await fs.readdir(p, { withFileTypes: true })).map(e => ({ name: e.name, isDir: e.isDirectory(), isSymlink: e.isSymbolicLink() })); },
  async mkdirp(p) { await fs.mkdir(p, { recursive: true }); },
  remove: p => fs.rm(p, { recursive: true, force: true }),
  readlink: fs.readlink,
  rename: fs.rename,
  symlink: fs.symlink,
};
