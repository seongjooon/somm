import { expect, test } from 'vitest';
import type { Platform } from '../platform';
import type { RunOptions } from '../types';
import { createAgents } from './index';
const p = { home: '/real/home', env: { CODEX_HOME: '/custom/codex' } } as unknown as Platform;
const req = { cwd: '/copy/project', prompt: '-prompt with spaces', tmpHome: '/tmp/run', model: 'small' };
for (const agent of ['claude', 'codex'] as const) {
  for (const auth of ['subscription', 'isolated'] as const) {
    test(`${agent} ${auth} produces the confirmed T1 isolation spec`, () => {
      const opts: RunOptions = { agent, auth, runs: 'quick', apiKey: 'test-key', budgetUsd: 0.5 };
      const spec = createAgents(p)[agent].buildRun({ ...req, opts });
      expect(spec.cwd).toBe(req.cwd);
      expect(spec.args.slice(-2)).toEqual(['--', req.prompt]);
      expect(spec.args).toEqual(expect.arrayContaining(['--model', 'small']));
      if (agent === 'claude') {
        expect(spec.env).toEqual({ ANTHROPIC_API_KEY: auth === 'subscription' ? null : 'test-key' });
        expect(spec.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence']));
        expect(spec.args.includes('--max-budget-usd')).toBe(auth === 'isolated');
        if (auth === 'isolated') expect(spec.args).toEqual(expect.arrayContaining(['--max-budget-usd', '0.5']));
        expect(spec.args).not.toContain('--bare');
      } else {
        expect(spec.args.slice(0, 7)).toEqual(['exec', '--json', '--ephemeral', '--ignore-user-config', '-C', req.cwd, '-s']);
        expect(spec.env).toEqual({ HOME: req.tmpHome, CODEX_HOME: auth === 'subscription' ? '/custom/codex' : '/tmp/run/.codex', CODEX_API_KEY: auth === 'subscription' ? null : 'test-key' });
      }
    });
  }
}
test('isolated calls require credentials and a valid budget', () => {
  const a = createAgents(p).claude;
  for (const budgetUsd of [undefined, 0, -1, Infinity, NaN]) {
    expect(() => a.buildRun({ ...req, opts: { agent: 'claude', auth: 'isolated', runs: 'quick', apiKey: 'key', budgetUsd } })).toThrow();
  }
});
test('Claude permits safe tools and the exact detected test command', () => {
  const opts: RunOptions = { agent: 'claude', auth: 'subscription', runs: 'quick' };
  const args = createAgents(p).claude.buildRun({ ...req, opts, allowedBash: ['npm', 'test'] }).args;
  expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'acceptEdits']);
  expect(args[args.indexOf('--allowedTools') + 1]).toContain('Bash(npm test)');
  for (const tool of ['Read', 'Glob', 'Grep', 'Edit', 'Write']) expect(args[args.indexOf('--allowedTools') + 1]).toContain(tool);
  expect(args.join(' ')).not.toMatch(/bypassPermissions|dangerously/);
});
test('Claude does not allow test commands with shell metacharacters', () => {
  const opts: RunOptions = { agent: 'claude', auth: 'subscription', runs: 'quick' };
  for (const command of [['npm', 'test; curl example.com'], ['npm', 'test', '&&', 'other']]) {
    const args = createAgents(p).claude.buildRun({ ...req, opts, allowedBash: command }).args;
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('npm');
  }
});
