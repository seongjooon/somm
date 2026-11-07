import { createSampleSource, type RunResult } from '@somm/core';
import type { Service } from './service';
export let previewResult: RunResult | undefined;
export async function createFakeService(): Promise<Service> {
  return {
    async load(id) {
      const meta = (await createSampleSource().fetchIndex()).find(s => s.id === id);
      if (!meta) throw new Error('Skill not found');
      return { meta, files: [{ path: 'SKILL.md', contents: `# ${meta.name}\n${meta.description}` }] };
    },
    async history() { return []; },
    async propose() { return ['Add a focused test', 'Improve error handling', 'Refactor a small module']; },
    async run(req, onEvent) {
      const metric = (tokens: number) => ({ ok: true, tokensIn: tokens, tokensOut: 150, durationMs: 2200, tests: { passed: 4, failed: 0 }, diff: { files: 1, added: 3, removed: 1, patch: '-old\n+new' }, inventory: { skills: [], plugins: [], mcp: [] }, canaryHits: [] });
      onEvent('a-0', { kind: 'text', text: 'Running baseline in the demo sandbox.', raw: null });
      onEvent('b-0', { kind: 'text', text: 'Running with the skill.', raw: null });
      const count = req.options.runs === 'thorough' ? 3 : 1;
      previewResult = { runId: 'preview', a: Array.from({ length: count }, () => metric(1000)), b: Array.from({ length: count }, () => metric(800)), contamination: { status: 'clean', common: [], extras: [], residue: [], targetInResidue: false }, verdict: { line: 'The skill reduced input tokens in this example.', rating: 'recommend' }, grade: 'A', tag: '// somm: pairs well', confidence: count === 1 ? 'low' : 'normal', warnings: [], meta: { identity: { source: req.skill.meta.id, contentHash: 'preview' }, skill: req.skill.meta.name, agent: req.options.agent, auth: req.options.auth, runs: req.options.runs, task: req.task, startedAt: '', finishedAt: '' } };
      return { id: 'preview', cleanupFailed: false, recoveryPath: undefined };
    },
  };
}
