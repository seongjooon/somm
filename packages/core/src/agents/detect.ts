import type { Platform } from '../platform';
import type { AgentId } from '../types';
import type { DetectResult } from './types';

export async function detect(p: Platform, id: AgentId, options?: { installationOnly?: boolean }): Promise<DetectResult> {
  const binPath = (await p.proc.which([id]))[id];
  if (!binPath) return { installed: false, loggedIn: false };
  const result: DetectResult = { installed: true, binPath, loggedIn: 'unknown' };
  if (options?.installationOnly) return result;
  try {
    const version = await p.proc.run(binPath, ['--version']);
    if (version.code === 0) result.version = version.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
  } catch { /* Login status remains useful when version probing fails. */ }
  let status;
  try {
    status = await p.proc.run(binPath, id === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status']);
  } catch {
    result.loginError = `${id} login check failed (${binPath}): could not start`;
    return result;
  }
  if (id === 'claude') {
    try {
      // Only the boolean escapes this scope; status can contain account identifiers.
      const loggedIn: unknown = JSON.parse(status.stdout).loggedIn;
      if (status.code === 1 || loggedIn === false) result.loggedIn = false;
      else if (status.code === 0 && loggedIn === true) result.loggedIn = true;
    } catch { /* Unsupported or invalid status output remains unknown. */ }
  } else if (status.code === 0 || status.code === 1) {
    if (!/unknown|unrecognized|unexpected (?:argument|subcommand)/i.test(status.stderr + status.stdout)) result.loggedIn = status.code === 0;
  }
  return result;
}

export async function listPlugins(p: Platform, id: AgentId): Promise<string[]> {
  const bin = (await p.proc.which([id]))[id];
  if (!bin) return [];
  const prefix = `${id} plugin listing failed (${bin})`;
  let result;
  try {
    result = await p.proc.run(bin, ['plugin', 'list', '--json']);
  } catch {
    throw new Error(`${prefix}: could not start`);
  }
  if (result.code !== 0) throw new Error(`${prefix}: exit code ${result.code}`);
  try {
    const parsed = JSON.parse(result.stdout);
    const installed: unknown = id === 'claude' ? parsed : parsed.installed;
    if (!Array.isArray(installed)) throw new Error();
    return [...new Set(installed.map(x => x.id ?? x.name).filter((name): name is string => typeof name === 'string'))];
  } catch {
    throw new Error(`${prefix}: invalid output`);
  }
}
