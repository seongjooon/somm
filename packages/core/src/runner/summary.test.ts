import { expect, test } from 'vitest';
import type { ArmMetrics } from '../types';
import { compare, summarize } from './summary';

const arm = (o: Partial<ArmMetrics> = {}): ArmMetrics => ({
  ok: true, tokensIn: 100, tokensOut: 10, durationMs: 1000, tests: { passed: 3, failed: 0 },
  diff: { files: 1, added: 2, removed: 0, patch: '' }, inventory: { skills: [], plugins: [], mcp: [] }, canaryHits: [], ...o,
});
test('summarize with failed iterations averages only successes', () => {
  const s = summarize([arm({ tokensIn: 100 }), arm({ tokensIn: 300 }), arm({ ok: false, tokensIn: 9999, error: 'boom' })]);
  expect(s).toMatchObject({ okCount: 2, total: 3, mean: { tokensIn: 200 } });
  expect(s.stdev?.tokensIn).toBeCloseTo(141.42, 1);
});
test('single run has no stdev; null tests give null means', () => {
  const s = summarize([arm({ tests: null })]);
  expect(s.stdev).toBeUndefined();
  expect(s.mean.passed).toBeNull();
});
test('all failed gives zero okCount', () => {
  expect(summarize([arm({ ok: false })])).toMatchObject({ okCount: 0, total: 1, mean: { tokensIn: 0, passed: null } });
});
test('compare gives delta percent, null when base is zero, skips null tests', () => {
  const a = summarize([arm({ tokensIn: 100, tests: null })]), b = summarize([arm({ tokensIn: 150, tests: null, diff: { files: 2, added: 0, removed: 0, patch: '' } })]);
  const rows = compare(a, b);
  expect(rows.find(r => r.metric === 'tokensIn')).toEqual({ metric: 'tokensIn', a: 100, b: 150, deltaPct: 50 });
  expect(rows.some(r => r.metric === 'passed')).toBe(false);
  const z = compare(summarize([arm({ tokensOut: 0 })]), summarize([arm({ tokensOut: 5 })]));
  expect(z.find(r => r.metric === 'tokensOut')?.deltaPct).toBeNull();
});
