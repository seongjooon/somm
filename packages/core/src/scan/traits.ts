import type { SkillFile, SkillTraits } from '../types';

export function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}
function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([name, child]) => name === key || hasKey(child, key));
}
export function skillTraits(files: SkillFile[]): SkillTraits {
  const traits: SkillTraits = { hasScripts: false, hasHooks: false, hasMcp: false, commands: [] };
  const commands = new Set<string>();
  for (const file of files) {
    const path = normalizedPath(file.path);
    traits.hasScripts ||= /(?:^|\/)scripts\//.test(path) || /\.(?:sh|py|js|ts)$/i.test(path);
    traits.hasHooks ||= /(?:^|\/)hooks\//.test(path);
    traits.hasMcp ||= /(?:^|\/)\.mcp\.json$/.test(path);
    const command = /(?:^|\/)commands\/([^/]+)\.md$/i.exec(path);
    if (command) commands.add(`/${command[1]}`);
    if (/\.json$/i.test(path)) {
      try {
        const config: unknown = JSON.parse(file.contents);
        traits.hasHooks ||= hasKey(config, 'hooks');
        traits.hasMcp ||= hasKey(config, 'mcpServers');
      } catch { /* Invalid JSON is still scanned as text by the rule engine. */ }
    }
  }
  traits.commands = [...commands].sort();
  return traits;
}
