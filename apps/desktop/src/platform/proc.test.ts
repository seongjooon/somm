import { expect, test, vi, beforeEach } from 'vitest';
const bridge = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: unknown }) => void>(), invoke: vi.fn(), stop: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (name: string, fn: (event: { payload: unknown }) => void) => { bridge.listeners.set(name, fn); return bridge.stop; } }));
import { tauriProc } from './proc';
beforeEach(() => { bridge.listeners.clear(); bridge.invoke.mockReset(); bridge.stop.mockClear(); });
test('waits for cancellation cleanup before rejecting', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const killed = new Promise<void>(resolve => { release = resolve; });
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === 'spawn_agent') {
      queueMicrotask(() => { controller.abort(); bridge.listeners.get('proc://exit')!({ payload: { id: args.id, code: 1 } }); });
    }
    if (command === 'kill_agent') await killed;
  });
  let settled = false;
  const result = tauriProc.run('/usr/bin/node', [], { signal: controller.signal });
  const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  void result.catch(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  const premature = settled;
  release();
  await checked;
  expect(premature).toBe(false);
  expect(bridge.stop).toHaveBeenCalledTimes(2);
});
test('preserves complete and partial output and removes listeners on spawn errors', async () => {
  const onLine = vi.fn();
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === 'spawn_agent') {
      bridge.listeners.get('proc://line')!({ payload: { id: args.id, stream: 'stdout', line: 'hello', terminated: true } });
      bridge.listeners.get('proc://line')!({ payload: { id: args.id, stream: 'stderr', line: 'partial', terminated: false } });
      bridge.listeners.get('proc://exit')!({ payload: { id: args.id, code: 0 } });
    }
  });
  expect(await tauriProc.run('/usr/bin/node', [], { onLine })).toEqual({ code: 0, stdout: 'hello\n', stderr: 'partial' });
  expect(onLine.mock.calls).toEqual([['stdout', 'hello'], ['stderr', 'partial']]);
  bridge.invoke.mockRejectedValueOnce(new Error('spawn failed'));
  await expect(tauriProc.run('/usr/bin/node', [])).rejects.toThrow('spawn failed');
  expect(bridge.stop).toHaveBeenCalledTimes(4);
});
