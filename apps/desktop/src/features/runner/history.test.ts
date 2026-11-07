import { expect, it } from 'vitest';
import { tokenHistory } from './history';
it('extracts valid token totals and ignores malformed metrics', () => {
  expect(tokenHistory([{ metrics_json: '{"tokensIn":100,"tokensOut":20}' }, { metrics_json: '{}' }, { metrics_json: 'broken' }, { metrics_json: '{"tokensIn":-1,"tokensOut":5}' }])).toEqual([120]);
});
