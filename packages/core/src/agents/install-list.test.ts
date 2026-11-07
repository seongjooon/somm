import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import type { Platform } from '../platform';
import { installation } from './install';

test('lists recoverable entries while hiding restore staging and hidden non-skill directories', async () => {
  const home = await mkdtemp(`${tmpdir()}/somm 한글 home `);
  const p: Platform = { home, dataDir: `${home}/data`, env: {}, fs: nodeFs, proc: nodeProc,
    db: { async select() { return []; }, async execute() {} } };
  try {
    const a = installation(p, 'claude');
    const root = a.skillDir('global');
    for (const name of ['.somm-restore-staging', '.hidden-junk', '.hidden-skill', 'missing']) await nodeFs.mkdirp(`${root}/${name}`);
    await nodeFs.writeText(`${root}/.hidden-skill/SKILL.md`, 'hidden skill');
    await nodeFs.writeText(`${root}/.somm-restore-staging/SKILL.md`, 'staging');
    await nodeFs.writeText(`${root}/.DS_Store`, 'noise');
    await nodeFs.symlink('missing-target', `${root}/broken`);
    await nodeFs.symlink('missing-target', `${root}/.hidden-broken`);
    const entries = await a.listInstalled();
    expect(entries.map(e => e.name).sort()).toEqual(['.hidden-broken', '.hidden-skill', 'broken', 'missing']);
    expect(entries.find(e => e.name === 'missing')).toMatchObject({ hash: '', isSymlink: false });
    expect(entries.find(e => e.name === 'broken')).toMatchObject({ hash: '', isSymlink: true });
    expect(entries.find(e => e.name === '.hidden-skill')?.hash).toMatch(/^[a-f0-9]{64}$/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
