import type { Grade } from '@somm/core';

export const previewGrades: Record<string, Grade> = {};
export function cachedGrades(rows: { skill_id: string; report_json: string }[]): Record<string, Grade> {
  const grades: Record<string, Grade> = {};
  for (const row of rows) {
    try {
      const grade: unknown = JSON.parse(row.report_json)?.grade;
      if (typeof grade === 'string' && ['A', 'B', 'C', 'D', 'F'].includes(grade)) grades[row.skill_id] = grade as Grade;
    } catch { /* Ignore malformed cached reports. */ }
  }
  return grades;
}
