import { expect, it } from 'vitest';
import { createSampleSource, hashFiles, type Platform } from '@somm/core';
import { checkRunAllowed, staticDenial } from './guards';
import type { Skill } from './service';
async function skill(): Promise<Skill> { return { meta: (await createSampleSource().fetchIndex())[0], files: [{ path: 'SKILL.md', contents: '# Safe' }] }; }
function platform(rows: unknown[]): Platform { return { db: { select: async () => rows } } as unknown as Platform; }
it('rejects matching or legacy F history and malformed history before agent use', async () => {
  const s = await skill(), hash = await hashFiles(s.files);
  for (const record of [{ grade: 'F', meta: { identity: { source: s.meta.id, contentHash: hash } } }, { grade: 'F' }, { grade: 'F', meta: { identity: {} } }, null]) {
    await expect(checkRunAllowed(platform([{ result_json: JSON.stringify(record) }]), s)).rejects.toThrow();
  }
  await expect(checkRunAllowed(platform([{ result_json: '{' }]), s)).rejects.toThrow();
  await expect(checkRunAllowed(platform([{ result_json: JSON.stringify({ grade: 'F', meta: { identity: { source: 'other', contentHash: hash } } }) }]), s)).resolves.toBeDefined();
});
it('explains static Lite restrictions before running', async () => {
  const s = await skill(); s.files.push({ path: 'scripts/do.sh', contents: 'echo hi' });
  expect(staticDenial(s)).toBe('traits');
  await expect(checkRunAllowed(platform([]), s)).rejects.toThrow('Static check only');
});
