import { expect, test } from 'vitest';
import type { SkillMeta } from '@somm/core';
import { merge } from './merge';
const skill = (id: string): SkillMeta => ({ id, name: id, description: '', source: 'github', repoUrl: 'https://github.com/a/b.git', ref: 'main', path: id, stars: 5, snapshots: [], agents: ['claude'] });
const input = { today: '2026-11-26', failureDays: {}, sourcesFailed: [] as string[] };
test('merge carries forward missing skills and drops after 7 days', () => {
  const previous = [skill('a'), skill('b'), skill('c')];
  const result = merge({ ...input, previous, fresh: [], failureDays: { a: 6, b: 2 } });
  expect(result.skills.map(s => s.id)).toEqual(['b', 'c']);
  expect(result.failureDays).toEqual({ b: 3, c: 1 });
  expect(merge({ ...input, previous, fresh: [skill('a')], failureDays: { a: 6 } }).failureDays.a).toBe(0);
});
test('merge appends snapshot and trims to 400 days', () => {
  const previous = [{ ...skill('a'), snapshots: [{ date: '2025-01-01', value: 1 }, { date: '2026-11-26', value: 2 }] }];
  expect(merge({ ...input, previous, fresh: [skill('a')] }).skills[0].snapshots).toEqual([{ date: '2026-11-26', value: 5 }]);
});
test('merge blocks publish on source failure or >20% drop', () => {
  const previous = Array.from({ length: 100 }, (_, i) => skill(String(i)));
  const failureDays = Object.fromEntries(previous.map(s => [s.id, 6]));
  expect(merge({ ...input, previous, fresh: previous.slice(0, 79), failureDays }).publish).toBe(false);
  expect(merge({ ...input, previous, fresh: previous.slice(0, 80), failureDays }).publish).toBe(true);
  expect(merge({ ...input, previous: [], fresh: [], sourcesFailed: ['official'] }).publish).toBe(false);
});
