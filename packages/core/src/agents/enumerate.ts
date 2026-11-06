import { parse } from 'yaml';
import type { Platform } from '../platform';
import type { AgentId } from '../types';
import { entries, join, parent } from './files';

export async function enumerateSkills(p: Platform, id: AgentId, armDir: string): Promise<string[]> {
  if (!armDir.startsWith('/') || armDir.split('/').includes('..')) throw new Error('Absolute arm directory required');
  const roots = [join(armDir, id === 'claude' ? '.claude/skills' : '.agents/skills')];
  if (id === 'codex') {
    const ancestors: string[] = [];
    let dir = armDir;
    while (!await p.fs.exists(join(dir, '.git')) && parent(dir) !== dir) {
      dir = parent(dir);
      ancestors.push(join(dir, '.agents/skills'));
    }
    if (await p.fs.exists(join(dir, '.git'))) roots.push(...ancestors);
    const codexHome = p.env.CODEX_HOME || join(p.home, '.codex');
    roots.push(join(codexHome, 'skills'), join(codexHome, 'skills/.system'));
  }
  const names = new Set<string>();
  for (const root of new Set(roots)) {
    for (const e of await entries(p, root)) {
      if (e.name.startsWith('.') || !(e.isDir || e.isSymlink)) continue;
      const dir = join(root, e.name);
      if (!await p.fs.exists(join(dir, 'SKILL.md'))) continue;
      if (id === 'codex' && await p.fs.exists(join(dir, 'agents/openai.yaml'))) {
        const config = parse(await p.fs.readText(join(dir, 'agents/openai.yaml')));
        if (config?.policy?.allow_implicit_invocation === false) continue;
      }
      const text = await p.fs.readText(join(dir, 'SKILL.md'));
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const name: unknown = frontmatter ? parse(frontmatter[1])?.name : undefined;
      names.add(typeof name === 'string' && name.trim() ? name : e.name);
    }
  }
  return [...names].sort();
}
