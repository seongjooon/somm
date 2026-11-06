import { parse } from 'yaml';
import type { Severity } from '../types';
import { securityYaml } from './rules.generated';

export interface Rule {
  id: string; severity: Severity; pattern: string; flags?: string; files?: string[]; message: string;
}
export function compileRule(rule: Rule): RegExp {
  try { return new RegExp(rule.pattern, rule.flags); }
  catch { throw new Error(`Invalid regular expression in rule ${rule.id}`); }
}
export function loadRules(yamlTexts: string[] = securityYaml): Rule[] {
  return yamlTexts.flatMap(text => {
    const values: unknown = parse(text);
    if (!Array.isArray(values)) throw new Error('Security rules must be a YAML array');
    return values.map((value: unknown) => {
      const rule = value as Rule | null;
      if (!rule || typeof rule.id !== 'string' || !['low', 'medium', 'high', 'critical'].includes(rule.severity)
        || typeof rule.pattern !== 'string' || typeof rule.message !== 'string'
        || (rule.flags !== undefined && typeof rule.flags !== 'string')
        || (rule.files !== undefined && (!Array.isArray(rule.files) || !rule.files.every(f => typeof f === 'string')))) {
        throw new Error(`Invalid security rule ${rule?.id ?? '<unknown>'}`);
      }
      compileRule(rule);
      return rule;
    });
  });
}

// Globs use * within a path segment, ** across segments, and ? for one character.
export function fileMatches(path: string, glob: string): boolean {
  let pattern = '^';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { pattern += '(?:.*/)?'; i++; }
      else pattern += '.*';
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`).test(path);
}
