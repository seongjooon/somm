import type { SkillMeta } from '../types';
import { validate } from './fetch';

export const DEFAULT_INDEX_URL = 'https://seongjooon.github.io/somm-index/index.json';
export const INDEX_TIMEOUT_MS = 15_000;
export const INDEX_BYTE_LIMIT = 20 * 1024 * 1024;
export function validSkillMeta(meta: SkillMeta): boolean {
  try {
    if (!meta || typeof meta !== 'object' || !['id', 'name', 'description', 'source', 'repoUrl', 'ref', 'path'].every(k => typeof (meta as unknown as Record<string, unknown>)[k] === 'string') || !meta.id || !meta.name || !Array.isArray(meta.snapshots) || !Array.isArray(meta.agents)) return false;
    validate(meta);
    return true;
  } catch { return false; }
}
export function parseIndex(text: string): SkillMeta[] {
  if (new TextEncoder().encode(text).length > INDEX_BYTE_LIMIT) throw new Error('Index too large');
  const index = JSON.parse(text);
  if (!index || typeof index !== 'object' || !Array.isArray(index.skills) || (index.version !== undefined && index.version !== 1)) throw new Error('Invalid index');
  return index.skills.filter(validSkillMeta).map((meta: SkillMeta) => {
    const { grade, traits, ...fields } = meta;
    const rest: SkillMeta = fields;
    if (grade && ['A', 'B', 'C', 'D'].includes(grade)) rest.grade = grade;
    if (traits && typeof traits === 'object' && typeof traits.hasScripts === 'boolean' && typeof traits.hasHooks === 'boolean' && typeof traits.hasMcp === 'boolean') {
      rest.traits = { hasScripts: traits.hasScripts, hasHooks: traits.hasHooks, hasMcp: traits.hasMcp };
    }
    return rest;
  });
}
