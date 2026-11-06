import { parse } from 'yaml';
import type { SkillTraits } from '../types';
import { conflictsYaml } from './rules.generated';

export interface ConflictRule { group: string; names: string[]; keywords: string[] }
export interface Conflict { kind: 'name' | 'command' | 'role'; with: string; detail: string }
interface Skill { name: string; traits: SkillTraits; text: string }
const defaults = parse(conflictsYaml) as ConflictRule[];
const normalize = (value: string) => value.toLowerCase();
function inGroup(skill: Skill, rule: ConflictRule): boolean {
  return rule.names.some(name => normalize(name) === normalize(skill.name))
    || rule.keywords.some(keyword => normalize(skill.text).includes(normalize(keyword)));
}
export function detectConflicts(target: Skill, installed: Skill[], rules: ConflictRule[] = defaults): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const skill of installed) {
    if (normalize(target.name) === normalize(skill.name)) {
      conflicts.push({ kind: 'name', with: skill.name, detail: `Same skill name: ${target.name}` });
    }
    for (const command of new Set(target.traits.commands)) {
      if (skill.traits.commands.includes(command)) {
        conflicts.push({ kind: 'command', with: skill.name, detail: `Shared command: ${command}` });
      }
    }
    for (const rule of rules) {
      if (inGroup(target, rule) && inGroup(skill, rule)) {
        conflicts.push({ kind: 'role', with: skill.name, detail: `Overlapping role: ${rule.group}` });
      }
    }
  }
  return conflicts;
}
