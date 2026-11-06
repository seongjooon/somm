import { expect, test } from 'vitest';
import { skillTraits } from './traits';

const traits = (...paths: string[]) => skillTraits(paths.map(path => ({ path, contents: '' })));
test('clean markdown has no executable traits', () => {
  expect(traits('SKILL.md')).toEqual({ hasScripts: false, hasHooks: false, hasMcp: false, commands: [] });
});
test.each(['scripts/run', 'a.sh', 'src/a.py', 'a.js', 'a.ts'])('detects script %s', path => {
  expect(traits(path).hasScripts).toBe(true);
});
test('detects configuration paths and deduplicates slash commands', () => {
  expect(traits('hooks/run', '.mcp.json', 'commands/review.md', 'nested/commands/review.md')).toEqual({
    hasScripts: false, hasHooks: true, hasMcp: true, commands: ['/review'],
  });
});
test('detects nested JSON keys without mistaking prose or string values for keys', () => {
  expect(skillTraits([{ path: 'config.json', contents: '{"plugin":{"hooks":{},"mcpServers":{}}}' }])).toMatchObject({ hasHooks: true, hasMcp: true });
  expect(skillTraits([{ path: 'SKILL.md', contents: 'hooks mcpServers' }, { path: 'config.json', contents: '{"description":"hooks mcpServers"}' }])).toMatchObject({ hasHooks: false, hasMcp: false });
});
test('tolerates malformed JSON and normalizes relative paths', () => {
  expect(skillTraits([{ path: 'bad.json', contents: '{' }])).toEqual(traits('SKILL.md'));
  expect(traits('./commands/review.md', 'scripts\\run').commands).toEqual(['/review']);
  expect(traits('scripts\\run').hasScripts).toBe(true);
});
