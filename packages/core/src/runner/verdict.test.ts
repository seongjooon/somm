import { expect, test } from 'vitest';
import { parseTasks, parseVerdict, proposeTasksPrompt, sommTag, verdictPrompt } from './verdict';

test.each([
  ['recommend', 'A', '// somm: pairs well'],
  ['conditional', 'B', '// somm: needs to breathe'],
  ['not-recommended', 'A', '// somm: corked'],
  ['recommend', 'F', '// somm: corked'],
  [null, 'A', '// somm: needs to breathe'],
] as const)('sommTag %s + %s', (rating, grade, tag) => { expect(sommTag(rating, grade)).toBe(tag); });

test('parseVerdict extracts JSON from prose and fences', () => {
  expect(parseVerdict('Sure!\n```json\n{"line":"Faster.","rating":"recommend"}\n```')).toEqual({ line: 'Faster.', rating: 'recommend' });
  expect(parseVerdict('{"line":"Meh","rating":"conditional"} done')).toEqual({ line: 'Meh', rating: 'conditional' });
  expect(parseVerdict('{"line":"No","rating":"not-recommended"}').rating).toBe('not-recommended');
});
test('parseVerdict throws on bad shapes', () => {
  expect(() => parseVerdict('no json')).toThrow();
  expect(() => parseVerdict('{"line":"x","rating":"great"}')).toThrow();
  expect(() => parseVerdict('{"rating":"recommend"}')).toThrow();
});
test('parseTasks needs exactly three', () => {
  expect(parseTasks('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  expect(parseTasks('1. Fix x\n2) Add y\n- Do z')).toEqual(['Fix x', 'Add y', 'Do z']);
  expect(() => parseTasks('["a","b"]')).toThrow();
  expect(() => parseTasks('1. a\n2. b\n3. c\n4. d')).toThrow();
});
test('prompts include their inputs', () => {
  const skill = { id: 'i', name: 'tdd', description: 'Write tests first', source: 'sample', repoUrl: '', ref: '', path: '', snapshots: [], agents: [] } as const;
  const p = proposeTasksPrompt(skill, ['src/a.ts', 'README.md']);
  expect(p).toContain('tdd'); expect(p).toContain('src/a.ts');
  const v = verdictPrompt({ skill: 'tdd', rows: [{ metric: 'tokensIn', a: 1, b: 2, deltaPct: 100 }], diffA: 'DIFF-A', diffB: 'DIFF-B' });
  expect(v).toContain('DIFF-A'); expect(v).toContain('tokensIn'); expect(v).toContain('recommend');
});
