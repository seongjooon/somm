import { expect, it } from 'vitest';
import type { RunResult } from '@somm/core';
import { runDescription } from './display';
it('labels failed Thorough as Thorough with actual successful and attempted arm counts', () => {
  const result = { meta: { runs: 'thorough' }, confidence: 'low', a: [{ ok: true }, { ok: false }], b: [{ ok: true }] } as RunResult;
  expect(runDescription(result)).toBe('Thorough · low confidence · Baseline 1/2 successful · With Skill 1/1 successful');
});
