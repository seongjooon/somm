import { skillText } from '../types';
import type { Finding, ScanReport, SkillFile } from '../types';
import { staticGrade } from './grade';
import { secretPostLines } from './shell-flow';
import { compileRule, fileMatches, loadRules, type Rule } from './rules';
import { knownNamesText } from './rules.generated';
import { normalizedPath } from './traits';

export { loadRules, type Rule } from './rules';
export { staticGrade, finalGrade, installGate, type InstallGate } from './grade';
export { skillTraits } from './traits';
export { detectConflicts, type ConflictRule, type Conflict } from './conflicts';

function distanceOne(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) === 1;
}

export function scanSkill(files: SkillFile[], ctx: { name: string; knownNames?: string[]; rules?: Rule[] }): ScanReport {
  const findings: Finding[] = [];
  const rules = (ctx.rules ?? loadRules()).map(rule => ({ rule, regex: compileRule(rule) }));
  for (const file of files) {
    const text = skillText(file.contents);
    const asset = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp[34]|wav|ogg|zip|docx|pptx|xlsx)$/i.test(file.path);
    const codeDir = /(?:^|\/)(?:scripts|hooks|commands)\//i.test(normalizedPath(file.path));
    if (text === undefined) {
      if (asset && !codeDir) {
        findings.push({ ruleId: 'unscannable-asset', severity: 'medium', file: file.path, line: 1, message: 'Binary asset cannot be inspected; review before installing.' });
      } else {
        findings.push({ ruleId: 'unscannable-code', severity: 'critical', file: file.path, line: 1, message: 'Executable or configuration content cannot be inspected as UTF-8; testing is required before installation.' });
      }
      continue;
    }
    if (asset) findings.push({ ruleId: 'disguised-asset', severity: text.startsWith('#!') ? 'critical' : 'high', file: file.path, line: 1, message: 'Text content is disguised as a binary asset.' });
    const path = normalizedPath(file.path);
    const applicable = rules.filter(({ rule }) => !rule.files || rule.files.some(glob => fileMatches(path, glob)));
    const lines = text.split(/\r\n|\n|\r/);
    for (const [index, line] of lines.entries()) {
      for (const { rule, regex } of applicable) {
        regex.lastIndex = 0;
        if (regex.test(line)) findings.push({ ruleId: rule.id, severity: rule.severity, file: file.path, line: index + 1, message: rule.message });
      }

    }
    const exfiltration = applicable.find(({ rule }) => rule.id === 'secret-exfiltration');
    if (exfiltration) for (const line of secretPostLines(lines)) {
      if (!findings.some(f => f.file === file.path && f.line === line && f.ruleId === exfiltration.rule.id)) {
        findings.push({ ruleId: exfiltration.rule.id, severity: exfiltration.rule.severity,
          file: file.path, line, message: exfiltration.rule.message });
      }
    }
  }
  const knownNames = ctx.knownNames ?? knownNamesText.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  for (const known of new Set(knownNames)) {
    if (distanceOne(ctx.name.toLowerCase(), known.toLowerCase())) {
      findings.push({ ruleId: 'typosquat', severity: 'high', file: 'SKILL.md', line: 1, message: `Skill name resembles known skill: ${known}` });
    }
  }
  return { ...staticGrade(findings), findings };
}
