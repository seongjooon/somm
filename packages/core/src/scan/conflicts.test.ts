import { expect, test } from 'vitest';
import { detectConflicts } from './conflicts';
import { scanSkill } from './index';

const traits = { hasScripts: false, hasHooks: false, hasMcp: false, commands: ['/review'] };
test('reports name, command, and methodology overlaps', () => {
  const target = { name: 'superpowers', traits, text: 'A methodology' };
  const conflicts = detectConflicts(target, [{ ...target }, { name: 'gstack', traits, text: 'development workflow' }]);
  expect(conflicts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'name', with: 'superpowers' }),
    expect.objectContaining({ kind: 'command', with: 'gstack', detail: expect.stringContaining('/review') }),
    expect.objectContaining({ kind: 'role', with: 'gstack', detail: expect.stringContaining('methodology') }),
  ]));
});
test('supports custom role groups and avoids one-sided keyword matches', () => {
  const target = { name: 'one', traits: { ...traits, commands: [] }, text: 'Code review' };
  const rules = [{ group: 'review', names: [], keywords: ['code review'] }];
  expect(detectConflicts(target, [{ ...target, name: 'two', text: 'CODE REVIEW' }], rules)).toHaveLength(1);
  expect(detectConflicts(target, [{ ...target, name: 'two', text: 'preview' }], rules)).toEqual([]);
  expect(detectConflicts(target, [{ ...target, name: 'two' }], [])).toEqual([]);
});
test.each(['superpower', 'superpowerrs', 'superpowezs'])('flags distance-one impersonation: %s', name => {
  expect(scanSkill([], { name, knownNames: ['superpowers'], rules: [] }).findings).toEqual([
    expect.objectContaining({ ruleId: 'typosquat', severity: 'high' }),
  ]);
});
test('uses bundled names but permits an explicit empty override', () => {
  expect(scanSkill([], { name: 'superpower', rules: [] }).grade).toBe('C');
  expect(scanSkill([], { name: 'superpower', knownNames: [], rules: [] }).grade).toBe('A');
  expect(scanSkill([], { name: 'superpowers', rules: [] }).grade).toBe('A');
  expect(scanSkill([], { name: 'unrelated', rules: [] }).grade).toBe('A');
});
