import { expect, test } from 'vitest';
import { latestRequest } from './request';

test('only the latest request remains current, including after cleanup', () => {
  const requests = latestRequest();
  const first = requests.start();
  const second = requests.start();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  requests.cancel();
  expect(second()).toBe(false);
});
