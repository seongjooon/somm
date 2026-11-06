import { expect, test } from 'vitest';
import { finalGrade, installGate, staticGrade } from './grade';
import type { Finding, Severity } from '../types';

const finding = (severity: Severity): Finding => ({ ruleId: 'test', severity, file: 'SKILL.md', line: 1, message: 'test' });
test.each([[0, 'A'], [1, 'B'], [3, 'B'], [4, 'C'], [10, 'C'], [11, 'D']])('grades score %i as %s', (count, grade) => {
  expect(staticGrade(Array.from({ length: Number(count) }, () => finding('low')))).toEqual({ score: count, grade });
});
test('weights severity and never assigns F statically', () => {
  expect(staticGrade([finding('medium')])).toEqual({ grade: 'B', score: 3 });
  expect(staticGrade([finding('high')])).toEqual({ grade: 'C', score: 8 });
  expect(staticGrade(Array.from({ length: 3 }, () => finding('critical')))).toEqual({ grade: 'D', score: 60 });
});
test('gates installation and reserves F for canary evidence', () => {
  expect(installGate('A', false)).toBe('direct');
  expect(installGate('B', false)).toBe('direct');
  for (const grade of ['C', 'D'] as const) {
    expect(installGate(grade, false)).toBe('after-test');
    expect(installGate(grade, true)).toBe('direct');
    expect(finalGrade(grade, [])).toBe(grade);
  }
  expect(finalGrade('A', ['~/.ssh'])).toBe('F');
  expect(installGate('F', false)).toBe('blocked');
  expect(installGate('F', true)).toBe('blocked');
});
