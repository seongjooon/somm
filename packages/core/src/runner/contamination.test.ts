import { expect, test } from 'vitest';
import { contamination } from './contamination';
import type { Inventory } from '../types';
const inv = (...skills: string[]): Inventory => ({ skills, plugins: [], mcp: [] });
test('clean when B differs only by target', () => {
  expect(contamination(inv('x'), inv('x', 't'), 't', [])).toMatchObject({ status: 'clean', common: ['x'], extras: [], targetInResidue: false });
});
test('contaminated when A has target', () => {
  expect(contamination(inv('t'), inv('t'), 't', []).status).toBe('contaminated');
});
test('extras listed when B has more than target', () => {
  const c = contamination(inv(), inv('t', 'y'), 't', []);
  expect(c).toMatchObject({ status: 'contaminated', extras: ['y'] });
});
test('A-only skills contaminate', () => {
  expect(contamination(inv('z'), inv('t'), 't', [])).toMatchObject({ status: 'contaminated', extras: ['z'] });
});
test('target in residue is always contaminated; residue sorted and deduped', () => {
  const c = contamination(inv('x'), inv('x', 't'), 't', ['x', 't', 'x']);
  expect(c).toMatchObject({ status: 'contaminated', targetInResidue: true, residue: ['t', 'x'] });
});
test('residue kept when clean', () => {
  expect(contamination(inv('x'), inv('x', 't'), 't', ['x'])).toMatchObject({ status: 'clean', residue: ['x'] });
});
