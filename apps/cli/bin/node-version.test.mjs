import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { nodeSupported } from './node-version.mjs';

test('supports Node versions with unflagged sqlite', () => {
  for (const [version, expected] of [['22.12.9', false], ['22.13.0', true], ['23.3.0', false], ['23.4.0', true], ['26.13.0', true], ['20.18.0', false]]) {
    assert.equal(nodeSupported(version), expected, version);
  }
});
