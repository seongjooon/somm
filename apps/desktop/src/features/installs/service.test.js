import { expect, test } from 'vitest';

test('real service lists and removes broken and unreadable active skills', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { DatabaseSync } = await import('node:sqlite');
  const { nodeFs } = await import('../../../../../packages/core/src/node/fs');
  const { nodeProc } = await import('../../../../../packages/core/src/node/proc');
  const { migrate } = await import('@somm/core');
  const { realService } = await import('./service');
  const home = await mkdtemp(`${tmpdir()}/somm 한글 space-`);
  const db = new DatabaseSync(':memory:');
  try {
    const root = `${home}/.claude/skills`;
    await mkdir(`${root}/empty`, { recursive: true });
    await mkdir(`${root}/unreadable`, { recursive: true });
    await writeFile(`${root}/unreadable/SKILL.md`, 'content');
    await symlink(`${home}/missing`, `${root}/broken`);
    const p = { home, dataDir: `${home}/data`, env: {}, proc: nodeProc,
      fs: { ...nodeFs, async readBytes(path) { if (path.includes('/unreadable/')) throw new Error('permission denied'); return nodeFs.readBytes(path); } },
      db: { async select(sql, args = []) { return db.prepare(sql).all(...args); }, async execute(sql, args = []) { db.prepare(sql).run(...args); } },
    };
    await migrate(p.db);
    const service = realService(p);
    const items = await service.list();
    expect(items.map(item => item.name).sort()).toEqual(['broken', 'empty', 'unreadable']);
    expect(items.every(item => item.hash === '')).toBe(true);
    const inspection = await service.conflicts(items);
    expect(inspection.unreadable.sort()).toEqual(items.map(item => item.dir).sort());
    for (const item of items) await service.uninstall(item);
    expect(await service.list()).toEqual([]);
  } finally { db.close(); await rm(home, { recursive: true, force: true }); }
});
