import sample from '../../fixtures/index.sample.json';
import type { SkillMeta, SourceId } from '../types';

export interface SourceAdapter { id: SourceId; fetchIndex(): Promise<SkillMeta[]> }
export function createSampleSource(): SourceAdapter {
  return { id: 'sample', async fetchIndex() { return structuredClone(sample.skills) as SkillMeta[]; } };
}
export * from './rank';
export { fetchSkillFiles, readLocalSkill } from './fetch';
