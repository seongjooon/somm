import type { AgentEvent, AgentId } from '../types';

type ObjectValue = Record<string, any>;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
const names = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(x => typeof x?.name === 'string' ? [x.name] : []) : [];
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
function error(raw: ObjectValue, message: string): AgentEvent {
  const code = /authentication_failed|not logged in|401|unauthorized|authentication|invalid.api.key/i.test(message) ? 'auth'
    : /budget|max_budget/i.test(message) ? 'budget' : 'other';
  return { kind: 'error', error: { code, message }, raw };
}
export function parseLine(id: AgentId, line: string): AgentEvent | null {
  let raw: ObjectValue;
  try { raw = JSON.parse(line); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (id === 'claude') return claude(raw);
  return codex(raw);
}
function claude(raw: ObjectValue): AgentEvent | null {
  if (raw.type === 'system' && raw.subtype === 'init') return {
    kind: 'init', inventory: { skills: strings(raw.skills), plugins: names(raw.plugins), mcp: names(raw.mcp_servers) }, raw,
  };
  if (raw.error) return error(raw, typeof raw.error === 'string' ? raw.error : String(raw.result ?? 'Agent error'));
  if (raw.type === 'result') {
    if (raw.is_error) return error(raw, String(raw.result ?? raw.subtype ?? 'Agent error'));
    const u = raw.usage;
    if (u && typeof u === 'object') return { kind: 'usage', usage: {
      input: number(u.input_tokens) + number(u.cache_creation_input_tokens) + number(u.cache_read_input_tokens), output: number(u.output_tokens),
    }, raw };
    return { kind: 'done', raw };
  }
  if (raw.type === 'assistant' || raw.type === 'user') {
    const blocks: unknown = raw.message?.content;
    if (!Array.isArray(blocks)) return null;
    // A single event retains the complete raw message; tool inputs include every block.
    const tools = blocks.filter(b => b?.type === 'tool_use' || b?.type === 'tool_result');
    if (tools.length) return { kind: 'tool', tool: {
      name: tools.map(b => b.name ?? b.tool_use_id ?? 'tool_result').join(', '),
      input: JSON.stringify(tools.map(b => b.input ?? b.content)),
      output: tools.some(b => b.type === 'tool_result') ? JSON.stringify(tools.map(b => b.content)) : undefined,
    }, raw };
    const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n');
    if (text) return { kind: 'text', text, raw };
  }
  return null;
}
function codex(raw: ObjectValue): AgentEvent | null {
  if (raw.type === 'error' || raw.type === 'turn.failed' || raw.item?.type === 'error') {
    return error(raw, String(raw.error?.message ?? raw.item?.message ?? raw.message ?? 'Agent error'));
  }
  if (raw.type === 'turn.completed' && raw.usage) return { kind: 'usage', usage: {
    // cached and reasoning counts are subsets of input/output, respectively.
    input: number(raw.usage.input_tokens), output: number(raw.usage.output_tokens),
  }, raw };
  if (raw.type === 'item.completed' || raw.type === 'item.started' || raw.type === 'item.updated') {
    const item = raw.item;
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'agent_message' || item.type === 'reasoning') return { kind: 'text', text: String(item.text ?? ''), raw };
    if (['command_execution', 'mcp_tool_call', 'file_change', 'web_search'].includes(item.type)) return {
      kind: 'tool', tool: { name: item.type, input: JSON.stringify(item), output: item.aggregated_output }, raw,
    };
  }
  return null;
}
