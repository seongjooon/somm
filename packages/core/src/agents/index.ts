import type { Platform } from '../platform';
import type { AgentId } from '../types';
import { detect, listPlugins } from './detect';
import { enumerateSkills } from './enumerate';
import { installation } from './install';
import { parseLine } from './parse';
import { buildRun } from './run';
import type { AgentAdapter } from './types';
export * from './types';
export { backupDir } from './files';

export function createAgents(p: Platform): Record<AgentId, AgentAdapter> {
  function create(id: AgentId): AgentAdapter {
    let bin = id as string;
    return {
      id, ...installation(p, id),
      async detect() {
        const result = await detect(p, id);
        if (result.binPath) bin = result.binPath;
        return result;
      },
      buildRun: req => buildRun(p, id, bin, req),
      parseLine: line => parseLine(id, line),
      listPlugins: () => listPlugins(p, id),
      enumerateSkills: armDir => enumerateSkills(p, id, armDir),
    };
  }
  return { claude: create('claude'), codex: create('codex') };
}
export { readInstallMarker, type InstallMarker } from './marker';
export { restoreBackup } from './restore';
