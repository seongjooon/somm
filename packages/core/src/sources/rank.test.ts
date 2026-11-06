import { expect, test } from 'vitest';
import type { SkillMeta } from '../types';
import { availableViews, dedupe, filterSkills, rank, searchSkills } from './index';

const today = '2026-11-06';
const item = (id: string, extra: Partial<SkillMeta> = {}): SkillMeta => ({
  id, name: id, description: '', source: 'sample', repoUrl: `https://example.com/${id}`,
  ref: 'main', path: 'skills/example', snapshots: [], agents: ['codex'], ...extra,
});
const ids = (items: SkillMeta[]) => items.map(i => i.id);
test('views require a baseline at or before the period start, never future snapshots', () => {
  const items = [item('a', { snapshots: ['04', '05', '06'].map(day => ({ date: `2026-11-${day}`, value: 10 })) })];
  expect(availableViews(items, today)).toEqual(['all-time', 'hot-day']);
  expect(availableViews([item('future', { snapshots: [{ date: '2026-11-07', value: 1 }] })], today)).toEqual(['all-time']);
  expect(availableViews([item('old', { snapshots: [{ date: '2025-11-06', value: 1 }, { date: today, value: 2 }] })], today)).toHaveLength(5);
});
test('all-time prefers installs including zero, normalizes within each source and does not mutate input', () => {
  const items = [item('a', { stars: 100 }), item('b', { stars: 500, installs: 0 }), item('c', { stars: 2, source: 'github' }), item('d', { stars: 1, source: 'github' })];
  expect(ids(rank(items, 'all-time', today))).toEqual(['a', 'c', 'd', 'b']);
  expect(ids(items)).toEqual(['a', 'b', 'c', 'd']);
});
test('weekly Hot uses nearest earlier baseline and latest snapshot no later than today', () => {
  const items = [
    item('a', { stars: 1000, snapshots: [{ date: '2026-10-29', value: 20 }, { date: today, value: 30 }] }),
    item('b', { snapshots: [{ date: '2026-10-30', value: 10 }, { date: today, value: 50 }, { date: '2026-11-07', value: 9999 }] }),
    item('c', { source: 'github', snapshots: [{ date: '2026-10-30', value: 0 }, { date: today, value: 2 }] }),
    item('missing', { stars: 10000 }),
  ];
  expect(ids(rank(items, 'hot-week', today))).toEqual(['b', 'c', 'a', 'missing']);
});
test('negative and missing growth is zero; dates cross UTC month and year boundaries', () => {
  const items = [item('a', { snapshots: [{ date: '2025-12-31', value: 5 }, { date: '2026-01-01', value: 3 }] }), item('b')];
  expect(ids(rank(items, 'hot-day', '2026-01-01'))).toEqual(['a', 'b']);
  expect(availableViews(items, '2026-01-01')).toEqual(['all-time', 'hot-day']);
});
test('dedupe combines repository/path and hash transitively and hides forks', () => {
  const a = item('a', { repoUrl: 'same', stars: 10, contentHash: 'hash' });
  const b = item('b', { repoUrl: 'same', stars: 20 });
  const c = item('c', { stars: 30, contentHash: 'hash' });
  expect(ids(dedupe([a, b, c, item('fork', { stars: 999, isFork: true }), item('other-path', { repoUrl: 'same', path: 'elsewhere' })]))).toEqual(['c', 'other-path']);
});
test('filters intersect and unknown grades pass minimum grade', () => {
  const items = ['a', 'b', 'c', 'd', 'f', 'unknown'].map(id => item(id, { category: 'dev', license: 'MIT' }));
  const grades = { a: 'A', b: 'B', c: 'C', d: 'D', f: 'F' } as const;
  expect(ids(filterSkills(items, { category: 'dev', agent: 'codex', source: 'sample', license: 'MIT', minGrade: 'B' }, grades))).toEqual(['a', 'b', 'unknown']);
  expect(filterSkills(items, { agent: 'claude' }, grades)).toEqual([]);
  expect(filterSkills(items, { category: 'other' }, grades)).toEqual([]);
});
test('search is case insensitive, name before description, blank query preserves order', () => {
  const items = [item('description', { description: 'Review code' }), item('Code Review'), item('other')];
  expect(ids(searchSkills(items, ' REVIEW '))).toEqual(['Code Review', 'description']);
  expect(searchSkills(items, '  ')).toEqual(items);
});

test('one old observation cannot enable Hot', () => { expect(availableViews([item('old', { snapshots: [{ date: '2025-01-01', value: 1 }] })], today)).toEqual(['all-time']); });
