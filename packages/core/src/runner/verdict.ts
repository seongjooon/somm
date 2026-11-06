import type { Grade, Rating, SkillMeta, SommTag, Verdict } from '../types';
import type { compare } from './summary';

const RATINGS: Rating[] = ['recommend', 'conditional', 'not-recommended'];

// A missing verdict (null) is treated as conditional: the run finished but no recommendation was made.
export function sommTag(rating: Rating | null, grade: Grade): SommTag {
  if (grade === 'F' || rating === 'not-recommended') return '// somm: corked';
  return rating === 'recommend' ? '// somm: pairs well' : '// somm: needs to breathe';
}

function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const open = fenced.search(/[[{]/);
  if (open < 0) return null;
  const close = Math.max(fenced.lastIndexOf('}'), fenced.lastIndexOf(']'));
  return close > open ? fenced.slice(open, close + 1) : null;
}

export function parseVerdict(text: string): Verdict {
  const json = extractJson(text);
  let v: unknown;
  try { v = JSON.parse(json ?? ''); } catch { throw new Error('Verdict is not valid JSON'); }
  const { line, rating } = (v ?? {}) as Record<string, unknown>;
  if (typeof line !== 'string' || !line.trim() || !RATINGS.includes(rating as Rating)) throw new Error('Verdict needs a line and a valid rating');
  return { line: line.trim(), rating: rating as Rating };
}

export function proposeTasksPrompt(skill: SkillMeta, tree: string[]): string {
  return [
    `You help evaluate the agent skill "${skill.name}": ${skill.description}`,
    'Propose exactly 3 small, self-contained coding tasks in the project below that would show whether this skill helps.',
    'Each task must be doable in a few minutes and verifiable. Reply with only a JSON array of 3 strings.',
    'Project files:', ...tree.slice(0, 200),
  ].join('\n');
}

export function parseTasks(text: string): string[] {
  let tasks: string[] | null = null;
  const json = extractJson(text);
  try { const v = JSON.parse(json ?? ''); if (Array.isArray(v) && v.every(x => typeof x === 'string')) tasks = v; } catch { /* fall back to lines */ }
  tasks ??= text.split('\n').map(l => /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
  tasks = tasks.map(t => t.trim()).filter(Boolean);
  if (tasks.length !== 3) throw new Error(`Expected exactly 3 tasks, got ${tasks.length}`);
  return tasks;
}

export function verdictPrompt(input: { skill: string; rows: ReturnType<typeof compare>; diffA: string; diffB: string }): string {
  const rows = input.rows.map(r => `${r.metric}: A=${r.a} B=${r.b} delta=${r.deltaPct === null ? 'n/a' : r.deltaPct.toFixed(1) + '%'}`);
  return [
    `Arm A ran without the skill "${input.skill}"; arm B ran with it. Compare the results and judge whether the skill is worth installing.`,
    'Metrics:', ...rows, '--- diff A ---', input.diffA.slice(0, 6000), '--- diff B ---', input.diffB.slice(0, 6000),
    'Reply with only JSON: {"line": "<one sentence>", "rating": "recommend" | "conditional" | "not-recommended"}',
  ].join('\n');
}
