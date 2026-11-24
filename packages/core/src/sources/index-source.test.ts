import { expect, test } from 'vitest';
import { INDEX_BYTE_LIMIT, parseIndex } from './index-source';

const ok = { id: 'x', name: 'x', description: '', source: 'github', repoUrl: 'https://github.com/a/b', ref: 'main', path: '.', snapshots: [], agents: ['claude'] };
const input = (skills: unknown[]) => JSON.stringify({ version: 1, generatedAt: '2026-11-24T00:00:00Z', skills });
test('parses version 1 and legacy sample shape', () => {
  expect(parseIndex(input([ok]))).toHaveLength(1);
  expect(parseIndex(JSON.stringify({ _note: 'x', skills: [ok] }))).toHaveLength(1);
});
test('rejects unknown version', () => expect(() => parseIndex(JSON.stringify({ version: 2, skills: [] }))).toThrow());
test('rejects oversized or non-JSON input', () => {
  expect(() => parseIndex('x'.repeat(INDEX_BYTE_LIMIT + 1))).toThrow();
  expect(() => parseIndex('not json')).toThrow();
});
test('drops unsafe entries only', () => {
  expect(parseIndex(input([ok, { ...ok, repoUrl: 'http://example.com' }, { ...ok, path: 'a/../b' }, { ...ok, ref: '-x' }]))).toEqual([ok]);
});
test('keeps grade and public traits, strips unknown trait keys', () => {
  expect(parseIndex(input([{ ...ok, grade: 'A', traits: { hasScripts: true, hasHooks: false, hasMcp: false, commands: ['rm'] } }]))[0]).toMatchObject({ grade: 'A', traits: { hasScripts: true, hasHooks: false, hasMcp: false } });
  expect(parseIndex(input([{ ...ok, traits: { hasScripts: true, hasHooks: false, hasMcp: false, commands: ['rm'] } }]))[0].traits).not.toHaveProperty('commands');
});
