import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { parseLine } from './parse';
async function fixture(name: string) { return (await readFile(new URL(`../../fixtures/agent-events/${name}.jsonl`, import.meta.url), 'utf8')).trim().split('\n'); }
test('Claude fixture counts result usage once, including caches, and captures inventory', async () => {
  const events = (await fixture('claude-stream')).map(line => parseLine('claude', line)).filter(e => e !== null);
  expect(events.filter(e => e.usage).map(e => e.usage)).toEqual([{ input: 15735, output: 4 }]);
  expect(events.find(e => e.inventory)?.inventory).toMatchObject({ skills: expect.arrayContaining(['somm-probe']), plugins: expect.any(Array), mcp: [] });
  expect(events.find(e => e.inventory)?.inventory?.skills).toHaveLength(18);
  expect(events.find(e => e.inventory)?.inventory?.plugins).toHaveLength(4);
});
test('Codex fixture counts token subsets only once and does not invent inventory', async () => {
  const events = (await fixture('codex-exec')).map(line => parseLine('codex', line)).filter(e => e !== null);
  expect(events.filter(e => e.usage).map(e => e.usage)).toEqual([{ input: 18071, output: 63 }]);
  expect(events.some(e => e.inventory)).toBe(false);
  const event = parseLine('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 10 } }));
  expect(event?.usage).toEqual({ input: 100, output: 20 });
});
for (const agent of ['claude', 'codex'] as const) {
  test(`${agent} recognizes recorded auth failures and ignores non-events`, async () => {
    const errors = (await fixture(`${agent}-auth-error`)).map(l => parseLine(agent, l)).filter(e => e?.kind === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(e => e?.error?.code === 'auth')).toBe(true);
    for (const line of ['plain text', '', 'null', '[]', '1', '{"type":"future-event"}']) expect(parseLine(agent, line)).toBeNull();
  });
}
test('tool events preserve inputs and outputs for canary observation', () => {
  expect(parseLine('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { path: '.env' } }] } }))?.tool?.input).toContain('.env');
  expect(parseLine('codex', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat .env', aggregated_output: 'CANARY' } }))?.tool).toMatchObject({ name: 'command_execution', output: 'CANARY' });
});
