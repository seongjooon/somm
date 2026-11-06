import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
// @ts-expect-error The generator is a standalone Node ESM script.
import { generateRules } from '../../scripts/gen-rules.mjs';

test('committed rules exactly match deterministic generator output', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = await readFile(new URL('./rules.generated.ts', import.meta.url), 'utf8');
  expect(await generateRules(root)).toBe(output);
});
