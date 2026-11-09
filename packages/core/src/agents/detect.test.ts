import { expect, test, vi } from 'vitest';
import type { Platform, ProcResult } from '../platform';
import { createAgents } from './index';
function fake(agent: 'claude' | 'codex', status: ProcResult | Error, installed = true) {
  const run = vi.fn(async (_bin: string, args: string[]) => {
    if (args[0] === '--version') return { code: 0, stdout: `${agent} 2.1.318`, stderr: '' };
    if (status instanceof Error) throw status;
    return status;
  });
  const p = { home: '/home/test', env: {}, proc: { which: async () => ({ [agent]: installed ? `/bin/${agent}` : null }), run } } as unknown as Platform;
  return { a: createAgents(p)[agent], run };
}
for (const agent of ['claude', 'codex'] as const) {
  test(`${agent} absent, version, logout, unsupported and spawn failure`, async () => {
    const absent = fake(agent, { code: 0, stdout: '', stderr: '' }, false);
    expect(await absent.a.detect()).toEqual({ installed: false, loggedIn: false });
    expect(absent.run).not.toHaveBeenCalled();
    const loggedOut = fake(agent, { code: 1, stdout: agent === 'claude' ? '{"loggedIn":false}' : '', stderr: 'Not logged in' });
    expect(await loggedOut.a.detect()).toEqual({ installed: true, binPath: `/bin/${agent}`, version: '2.1.318', loggedIn: false });
    expect(loggedOut.run).toHaveBeenLastCalledWith(`/bin/${agent}`, agent === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status']);
    const unsupported = await fake(agent, { code: 1, stdout: '', stderr: 'unknown subcommand' }).a.detect();
    expect(unsupported.loggedIn).toBe('unknown');
    expect(unsupported.loginError).toBeUndefined();
    expect((await fake(agent, new Error('spawn failed')).a.detect()).loginError).toBe(`${agent} login check failed (/bin/${agent}): could not start`);
    const loggedIn = fake(agent, { code: 0, stdout: agent === 'claude' ? '{"loggedIn":true,"email":"private@example.test","orgName":"Secret Org"}' : '', stderr: '' });
    const result = await loggedIn.a.detect();
    expect(result.loggedIn).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private@example|Secret Org/);
    expect(loggedIn.a.buildRun({ cwd: '/project', tmpHome: '/tmp/test', prompt: 'hello', opts: { agent, auth: 'subscription', runs: 'quick' } }).bin).toBe(`/bin/${agent}`);
  });
}
test('plugin listing supports both CLI response shapes', async () => {
  expect(await fake('claude', { code: 0, stdout: '[{"id":"one"}]', stderr: '' }).a.listPlugins()).toEqual(['one']);
  expect(await fake('codex', { code: 0, stdout: '{"installed":[{"name":"two"}],"available":[{"name":"skip"}]}', stderr: '' }).a.listPlugins()).toEqual(['two']);
});
test('plugin listing removes duplicates in first-seen order', async () => {
  expect(await fake('claude', { code: 0, stdout: '[{"id":"one","scope":"user"},{"id":"two"},{"id":"one","scope":"project"}]', stderr: '' }).a.listPlugins()).toEqual(['one', 'two']);
});
test.each(['claude', 'codex'] as const)('%s installation-only detection avoids all agent processes and retains binary', async agent => {
  const present = fake(agent, new Error('must not execute'));
  expect(await present.a.detect({ installationOnly: true })).toEqual({ installed: true, binPath: `/bin/${agent}`, loggedIn: 'unknown' });
  expect(present.run).not.toHaveBeenCalled();
  expect(present.a.buildRun({ cwd: '/project', tmpHome: '/tmp/test', prompt: 'test', opts: { agent, auth: 'isolated', runs: 'quick', apiKey: 'fake-key', budgetUsd: 1 } }).bin).toBe(`/bin/${agent}`);
  const missing = fake(agent, new Error('must not execute'), false);
  expect((await missing.a.detect({ installationOnly: true })).installed).toBe(false);
  expect(missing.run).not.toHaveBeenCalled();
});
test('installation-only detection propagates binary discovery errors', async () => {
  const p = { proc: { which: async () => { throw new Error('discovery failed'); } } } as unknown as Platform;
  await expect(createAgents(p).claude.detect({ installationOnly: true })).rejects.toThrow('discovery failed');
});

test.each(['claude', 'codex'] as const)('%s plugin errors include the binary path', async agent => {
  await expect(fake(agent, { code: 2, stdout: '', stderr: '' }).a.listPlugins()).rejects.toThrow(`${agent} plugin listing failed (/bin/${agent}): exit code 2`);
  await expect(fake(agent, new Error('spawn failed')).a.listPlugins()).rejects.toThrow(`${agent} plugin listing failed (/bin/${agent}): could not start`);
});

test('Claude malformed login output stays silent without leaking input', async () => {
  for (const code of [0, 1]) {
    const result = await fake('claude', { code, stdout: '{"secret":"sk-test-SECRET', stderr: '' }).a.detect();
    expect(result.loggedIn).toBe('unknown');
    expect(result.loginError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sk-test-SECRET');
  }
});
test.each(['claude', 'codex'] as const)('%s malformed plugin output does not leak input', async agent => {
  await expect(fake(agent, { code: 0, stdout: '{"secret":"sk-test-SECRET', stderr: '' }).a.listPlugins())
    .rejects.toThrow(`${agent} plugin listing failed (/bin/${agent}): invalid output`);
});
