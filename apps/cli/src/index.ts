#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as search from './commands/search';
import * as scan from './commands/scan';
import * as list from './commands/list';
import * as test from './commands/test';
import * as install from './commands/install';
import * as remove from './commands/remove';
const commands = { search, scan, list, test, install, remove };
const { values, positionals } = parseArgs({
  options: { help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' } },
  allowPositionals: true,
});
if (values.help || !positionals.length) {
  console.log('Usage: somm <search|scan|list|test|install|remove> [args] [--json]');
} else {
  const name = positionals[0] as keyof typeof commands;
  if (!(Object.hasOwn(commands, name))) {
    console.error('// somm: unknown command');
    process.exitCode = 1;
  } else {
    // T3 injects the platform before commands need I/O.
    process.exitCode = await commands[name].run(positionals.slice(1), {
      platform: undefined!, out: console.log, err: console.error,
      json: values.json === true, confirm: async () => false,
    });
  }
}
