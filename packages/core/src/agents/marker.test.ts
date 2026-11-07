import { expect, test } from 'vitest';
import type { InstalledSkill } from '../types';
import type { Platform } from '../platform';
import { readInstallMarker } from './marker';

test('reads a valid marker and ignores missing or malformed markers', async () => {
  let text = JSON.stringify({ source: 'sample:one', hash: 'abc', installedAt: 'today' });
  let exists = true;
  const p = { fs: { exists: async () => exists, readText: async () => text } } as unknown as Platform;
  const item = { dir: '/skill' } as InstalledSkill;
  expect(await readInstallMarker(p, item)).toEqual({ source: 'sample:one', hash: 'abc', installedAt: 'today' });
  text = '{';
  expect(await readInstallMarker(p, item)).toBeNull();
  text = JSON.stringify({ hash: 4 });
  expect(await readInstallMarker(p, item)).toBeNull();
  exists = false;
  expect(await readInstallMarker(p, item)).toBeNull();
});
