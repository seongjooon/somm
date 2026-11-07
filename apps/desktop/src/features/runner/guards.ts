import { hashFiles, scanSkill, skillTraits, type Platform, type ScanReport } from '@somm/core';
import type { Skill } from './service';

export function staticDenial(skill: Skill): 'grade' | 'traits' | undefined {
  const report = scanSkill(skill.files, { name: skill.meta.name });
  const traits = skillTraits(skill.files);
  if (!['A', 'B'].includes(report.grade)) return 'grade';
  if (traits.hasScripts || traits.hasHooks || traits.hasMcp) return 'traits';
}
export async function checkRunAllowed(p: Platform, skill: Skill): Promise<{ report: ScanReport; hash: string }> {
  if (staticDenial(skill)) throw new Error('Static check only');
  const report = scanSkill(skill.files, { name: skill.meta.name });
  const hash = await hashFiles(skill.files);
  const rows = await p.db.select<{ result_json: string }>('SELECT result_json FROM runs WHERE skill_id = ?', [skill.meta.name]);
  for (const row of rows) {
    const result = JSON.parse(row.result_json);
    if (!result || typeof result !== 'object' || !['A', 'B', 'C', 'D', 'F'].includes(result.grade)) throw new Error('Invalid previous result');
    if (result.grade === 'F') {
      const identity = result.meta?.identity;
      if (!identity || typeof identity.source !== 'string' || typeof identity.contentHash !== 'string' || (identity.source === skill.meta.id && identity.contentHash === hash)) throw new Error('This skill has a previous blocked result');
    }
  }
  return { report, hash };
}
