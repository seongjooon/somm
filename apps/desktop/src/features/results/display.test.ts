import { expect, it } from 'vitest';
import type { RunResult } from '@somm/core';
import { formatPercentage, formatValue, runDescription } from './display';
it('labels failed Thorough as Thorough with actual successful and attempted arm counts', () => {
  const result = { meta: { runs: 'thorough' }, confidence: 'low', a: [{ ok: true }, { ok: false }], b: [{ ok: true }] } as RunResult;
  expect(runDescription(result)).toBe('Thorough · low confidence · Baseline 1/2 successful · With Skill 1/1 successful');
});

it('formats quick values as integers and thorough statistics and percentages with one decimal', () => {
  expect(formatValue(1000)).toBe('1000');
  expect(formatValue(1234.6)).toBe('1235');
  expect(formatValue(1000.25, true, 2.56)).toBe('1000.3 ± 2.6');
  expect(formatValue(1000.25, true)).toBe('1000.3');
  expect(formatPercentage(12.34)).toBe('12.3%');
  expect(formatPercentage(null)).toBe('—');
});
