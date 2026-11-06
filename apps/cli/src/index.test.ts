import { afterEach, expect, test, vi } from 'vitest';
import * as search from './commands/search';
vi.mock('@somm/core/node', () => ({ createNodePlatform: vi.fn(async () => ({})) }));
vi.mock('./commands/search', () => ({ run: vi.fn(async () => 1) }));
const argv = process.argv;
const exitCode = process.exitCode;
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function invoke(args: string[]) {
  vi.resetModules();
  process.argv = ['node', 'somm', ...args];
  process.exitCode = 0;
  const out = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./index');
  return { out: out.mock.calls.map(([line]) => line), err: err.mock.calls, code: process.exitCode };
}
test('passes raw command flags through to search', async () => {
  const result = await invoke(['search', 'x', '--agent', 'claude']);
  expect(search.run).toHaveBeenCalledWith(['x', '--agent', 'claude'], expect.objectContaining({ json: false }));
  expect(result.code).toBe(1);
});
test('keeps json and other flags in command arguments', async () => {
  await invoke(['search', 'x', '--agent', 'claude', '--json']);
  expect(search.run).toHaveBeenCalledWith(['x', '--agent', 'claude', '--json'], expect.objectContaining({ json: true }));
});
test('prints a single JSON object for help', async () => {
  const result = await invoke(['--help', '--json']);
  expect(result.out).toHaveLength(1);
  expect(JSON.parse(result.out[0])).toEqual({ somm: 'help', usage: expect.stringContaining('Usage: somm') });
  expect(result.err).toEqual([]);
  expect(result.code).toBe(0);
});
test('prints a single JSON object for unknown commands', async () => {
  const result = await invoke(['unknown', '--json']);
  expect(result.out).toHaveLength(1);
  expect(JSON.parse(result.out[0])).toEqual({ somm: 'unknown command' });
  expect(result.err).toEqual([]);
  expect(result.code).toBe(1);
});
