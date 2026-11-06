#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as search from './commands/search';
import * as scan from './commands/scan';
import * as list from './commands/list';
import * as test from './commands/test';
import * as install from './commands/install';
import * as remove from './commands/remove';
const commands = { search, scan, list, test, install, remove };
const argv = process.argv.slice(2);
const { values, tokens } = parseArgs({
  args: argv,
  options: { help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' } },
  allowPositionals: true, strict: false, tokens: true,
});
const command = tokens.find(token => token.kind === 'positional');
const usage = 'Usage: somm <search|scan|list|test|install|remove> [args] [--json]';
if (values.help || !command) {
  console.log(values.json ? JSON.stringify({ somm: 'help', usage }) : usage);
} else {
  const name = command.value as keyof typeof commands;
  if (!Object.hasOwn(commands, name)) {
    if (values.json) console.log(JSON.stringify({ somm: 'unknown command' }));
    else console.error('// somm: unknown command');
    process.exitCode = 1;
  } else {
    const { createNodePlatform } = await import('@somm/core/node');
    process.exitCode = await commands[name].run(argv.slice(command.index + 1), {
      platform: await createNodePlatform(), out: console.log, err: console.error,
      json: values.json === true, confirm: async () => false,
    });
  }
}
