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

test('pins length-prefixed binary hash format and equates UTF-8 strings with bytes', async () => {
  const files = [{ path: 'a', contents: 'abc' }, { path: 'b', contents: new Uint8Array([0, 255, 1]) }];
  expect(await hashFiles(files)).toBe('050c52e2abf78808d590d300b3e2cbd34e00732bf49a63ca7e113659fc1b3dc7');
  expect(await hashFiles(files)).toBe(await hashFiles([{ path: 'a', contents: new TextEncoder().encode('abc') }, files[1]]));
});
