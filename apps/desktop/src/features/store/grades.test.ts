import { expect, test } from 'vitest';
import { cachedGrades } from './grades';

test('reads valid grades and ignores malformed reports and unknown grades', () => {
  expect(cachedGrades([
    { skill_id: 'one', report_json: '{"grade":"A"}' },
    { skill_id: 'two', report_json: '{"grade":"F"}' },
    { skill_id: 'bad', report_json: '{' },
    { skill_id: 'unknown', report_json: '{"grade":"Z"}' },
    { skill_id: 'null', report_json: 'null' },
  ])).toEqual({ one: 'A', two: 'F' });
});
test('returns no grades for empty rows', () => expect(cachedGrades([])).toEqual({}));
