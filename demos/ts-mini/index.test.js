import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum, average, formatPrice } from './index.js';
test('sum handles empty and negative values', () => { assert.equal(sum([]), 0); assert.equal(sum([-2, 3]), 1); });
test('average handles empty input', () => { assert.equal(average([]), 0); assert.equal(average([2, 4]), 3); });
test('prices have two decimal places', () => assert.equal(formatPrice(1.5), '$1.50'));
