import { expect, test } from 'vitest';
import { resolveDataDir, hashFiles } from './index';
test('resolves the shared data directory', () => {
  expect(resolveDataDir({ SOMM_DATA_DIR: '/x' }, '/h')).toBe('/x');
  expect(resolveDataDir({}, '/h')).toBe('/h/Library/Application Support/io.github.seongjooon.somm');
});
test('hashes sorted paths and detects a byte change', async () => {
  const files = [{ path: 'b', contents: 'B' }, { path: 'a', contents: 'A' }];
  expect(await hashFiles(files)).toBe(await hashFiles([...files].reverse()));
  expect(await hashFiles(files)).not.toBe(await hashFiles([{ path: 'b', contents: 'C' }, files[1]]));
  expect(await hashFiles(files)).toMatch(/^[a-f0-9]{64}$/);
});

test('falls back when the data directory environment variable is empty', () => {
  expect(resolveDataDir({ SOMM_DATA_DIR: '' }, '/h')).toBe('/h/Library/Application Support/io.github.seongjooon.somm');
});
