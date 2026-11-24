import { expect, test } from 'vitest';
import { makeEnv } from '../runner/testkit.test';
import { loadCatalog } from './catalog';

const skill = (id: string) => ({ id, name: id, description: '', source: 'github', repoUrl: 'https://github.com/a/b', ref: 'main', path: '.', snapshots: [], agents: ['claude'] });
const data = (...ids: string[]) => JSON.stringify({ version: 1, skills: ids.map(skill) });
const fail = async () => { throw new Error('offline'); };
test('remote success replaces cache', async () => {
  const { p, db } = await makeEnv();
  expect((await loadCatalog(p, { fetchText: async () => data('a', 'b') })).origin).toBe('remote');
  expect(await db.select('SELECT * FROM skills_cache')).toHaveLength(2);
  await loadCatalog(p, { fetchText: async () => data('a') });
  expect(await db.select('SELECT * FROM skills_cache')).toHaveLength(1);
});
test('falls back to cache when remote fails', async () => {
  const { p } = await makeEnv();
  const remote = await loadCatalog(p, { fetchText: async () => data('a') });
  expect(await loadCatalog(p, { fetchText: fail })).toEqual({ skills: remote.skills, origin: 'cache' });
});
test('falls back to sample when no cache', async () => {
  const { p } = await makeEnv();
  const result = await loadCatalog(p, { fetchText: fail });
  expect(result.origin).toBe('sample'); expect(result.skills).toHaveLength(20);
});
test('invalid remote keeps previous cache', async () => {
  const { p } = await makeEnv();
  const remote = await loadCatalog(p, { fetchText: async () => data('a') });
  expect(await loadCatalog(p, { fetchText: async () => '{"version":2}' })).toEqual({ skills: remote.skills, origin: 'cache' });
});
test('remote list is returned even when the cache write fails', async () => {
  const { p } = await makeEnv();
  p.db = { ...p.db, async execute() { throw new Error('write failed'); } };
  expect(await loadCatalog(p, { fetchText: async () => data('a') })).toEqual({ skills: [skill('a')], origin: 'remote' });
});
