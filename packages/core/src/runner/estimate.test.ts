import { expect, test } from 'vitest';
import { estimateUsage } from './estimate';
const sub = { agent: 'claude', auth: 'subscription' } as const;
test('quick with custom task is 3 calls', () => {
  expect(estimateUsage({ ...sub, runs: 'quick' }, true, [])).toMatchObject({ agentCalls: 3, abRuns: 2, warnThorough: false });
});
test('quick with proposed task is 4 calls', () => {
  expect(estimateUsage({ ...sub, runs: 'quick' }, false, []).agentCalls).toBe(4);
});
test('thorough with proposed task is 8 calls and 6 runs', () => {
  expect(estimateUsage({ ...sub, runs: 'thorough' }, false, [])).toMatchObject({ agentCalls: 8, abRuns: 6, warnThorough: true });
});
test('warnThorough only for subscription thorough', () => {
  const iso = { agent: 'claude', auth: 'isolated', runs: 'thorough', apiKey: 'k', budgetUsd: 0.5 } as const;
  expect(estimateUsage(iso, true, []).warnThorough).toBe(false);
});
test('isolated max usd is budget times calls; avgTokens from history', () => {
  const e = estimateUsage({ agent: 'codex', auth: 'isolated', runs: 'quick', apiKey: 'k', budgetUsd: 0.5 }, false, [100, 200]);
  expect(e.maxUsd).toBe(2);
  expect(e.avgTokens).toBe(150);
  expect(estimateUsage({ ...sub, runs: 'quick' }, true, []).avgTokens).toBeUndefined();
});
