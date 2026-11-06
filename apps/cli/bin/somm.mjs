#!/usr/bin/env node
import { nodeSupported } from './node-version.mjs';

if (!nodeSupported(process.versions.node)) {
  console.error(`somm requires Node.js 22.13.0+ (or 23.4.0+). You are running v${process.versions.node}. Update: https://nodejs.org`);
  process.exitCode = 1;
} else {
  await import('../dist/cli.js');
}
