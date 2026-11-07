import { expect, test } from 'vitest';
import { createActionLock } from './action-lock';

test('rejects overlapping actions and unlocks after success or failure', async () => {
  const changes: boolean[] = [];
  const lock = createActionLock(busy => changes.push(busy));
  let release!: () => void;
  let executions = 0;
  const first = lock.run(async () => { executions++; await new Promise<void>(resolve => { release = resolve; }); });
  await lock.run(async () => { executions++; });
  expect(executions).toBe(1);
  release(); await first;
  await expect(lock.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  await lock.run(async () => { executions++; });
  expect(executions).toBe(2);
  expect(changes).toEqual([true, false, true, false, true, false]);
});
