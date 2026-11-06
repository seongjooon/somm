import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { nodeFs as fs } from '../node/fs';
import { nodeProc } from '../node/proc';
import type { Platform } from '../platform';
import { detectTestCommand, parseTestOutput } from './tests';

let root: string, p: Platform;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-tests-'));
  p = { fs, proc: nodeProc, home: root, dataDir: root, env: {}, db: { async select() { return []; }, async execute() {} } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const nodeTest = `ℹ tests 3\nℹ suites 0\nℹ pass 3\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 102.5`;
const unittestOk = `...\n----------------------------------------------------------------------\nRan 3 tests in 0.000s\n\nOK`;
test.each([
  ['vitest', ' Test Files  1 passed (1)\n      Tests  11 passed (11)\n', { passed: 11, failed: 0 }],
  ['vitest failing', '      Tests  2 failed | 9 passed (11)', { passed: 9, failed: 2 }],
  ['vitest ansi', '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[90m (4)\u001b[39m', { passed: 4, failed: 0 }],
  ['jest', 'Tests:       1 failed, 4 passed, 5 total\nTime: 1s', { passed: 4, failed: 1 }],
  ['node --test (demo ts-mini)', nodeTest, { passed: 3, failed: 0 }],
  ['node --test failing', 'ℹ pass 2\nℹ fail 1', { passed: 2, failed: 1 }],
  ['pytest', '========== 1 failed, 2 passed in 0.12s ==========', { passed: 2, failed: 1 }],
  ['pytest all passed', '============ 3 passed in 0.01s ============', { passed: 3, failed: 0 }],
  ['unittest (demo py-mini)', unittestOk, { passed: 3, failed: 0 }],
  ['unittest failing', 'Ran 5 tests in 0.1s\n\nFAILED (failures=1, errors=1)', { passed: 3, failed: 2 }],
  ['cargo sums crates', 'test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured\ntest result: FAILED. 1 passed; 2 failed; 0 ignored', { passed: 4, failed: 2 }],
  ['go -v', '--- PASS: TestA (0.00s)\n    --- PASS: TestA/sub (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL', { passed: 2, failed: 1 }],
])('parses %s', (_n, out, want) => { expect(parseTestOutput(out)).toEqual(want); });
test('unrecognized output is null', () => {
  expect(parseTestOutput('hello world')).toBeNull();
  expect(parseTestOutput('ok  \texample.com/x\t0.1s')).toBeNull();
});

const demo = (name: string) => resolve(__dirname, '../../../../demos', name);
test('detects demo commands', async () => {
  expect(await detectTestCommand(p, demo('ts-mini'))).toEqual(['npm', 'test']);
  expect(await detectTestCommand(p, demo('py-mini'))).toEqual(['python3', '-m', 'unittest']);
});
test('lockfile picks package manager', async () => {
  await fs.writeText(`${root}/package.json`, '{"scripts":{"test":"vitest"}}');
  await fs.writeText(`${root}/pnpm-lock.yaml`, '');
  expect(await detectTestCommand(p, root)).toEqual(['pnpm', 'test']);
});
test('venv python and pytest markers', async () => {
  await fs.writeText(`${root}/pytest.ini`, '[pytest]');
  await fs.mkdirp(`${root}/.venv/bin`);
  expect(await detectTestCommand(p, root)).toEqual([`${root}/.venv/bin/python`, '-m', 'pytest']);
});
test('cargo, go and none', async () => {
  await fs.writeText(`${root}/Cargo.toml`, '');
  expect(await detectTestCommand(p, root)).toEqual(['cargo', 'test']);
  await fs.remove(`${root}/Cargo.toml`);
  await fs.writeText(`${root}/go.mod`, '');
  expect(await detectTestCommand(p, root)).toEqual(['go', 'test', '-v', './...']);
  await fs.remove(`${root}/go.mod`);
  expect(await detectTestCommand(p, root)).toBeNull();
});
