import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import { SANDBOX_GIT_ENV } from '../sandbox';
import type { AgentEvent, RunOptions } from '../types';

export function mapStrings(value: unknown, transform: (value: string) => string): unknown {
  return typeof value === 'string' ? transform(value) : Array.isArray(value) ? value.map(v => mapStrings(v, transform)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, transform)])) : value;
}

// Mask common forms in string values without modifying object keys or replacement markers.
export function makeScrub(key?: string) {
  const bytes = key && [...key].length >= 8 ? new TextEncoder().encode(key) : new Uint8Array();
  const forms: string[] = bytes.length ? [key!, JSON.stringify(key).slice(1, -1), encodeURIComponent(key!), Array.from(bytes, b => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''), Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')] : [];
  if (bytes.length) {
    forms.push(forms.at(-1)!.toUpperCase());
    for (let prefix = 0; prefix < 3; prefix++) for (let suffix = 0; suffix < 3; suffix++) {
      const encoded = btoa(String.fromCharCode(...new Uint8Array(prefix), ...bytes, ...new Uint8Array(suffix)));
      const start = Math.ceil(prefix * 8 / 6), end = Math.floor((prefix + bytes.length) * 8 / 6);
      const middle = encoded.slice(start, end);
      forms.push(middle, middle.replace(/\+/g, '-').replace(/\//g, '_'));
      if (!prefix && !suffix) for (const f of [encoded, encoded.replace(/=+$/, '')]) forms.push(f, f.replace(/\+/g, '-').replace(/\//g, '_'));
    }
  }
  const needles = [...new Set(forms.filter(Boolean))].sort((a, b) => b.length - a.length);
  const str = (s: string) => {
    let out = '';
    for (let i = 0; i < s.length;) {
      const found = needles.find(f => s.startsWith(f, i));
      if (found) { out += '[REDACTED]'; i += found.length; } else { out += s[i++]; }
    }
    return out;
  };
  return { str, event: (e: AgentEvent): AgentEvent => mapStrings(e, str) as AgentEvent };
}
export type Scrub = ReturnType<typeof makeScrub>;

export const DETECT_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 10 * 60_000;
export const AGENT_TIMEOUT_MS = 15 * 60_000;
export interface Timeouts { detect: number; test: number; agent: number }
export const DEFAULT_TIMEOUTS: Timeouts = { detect: DETECT_TIMEOUT_MS, test: TEST_TIMEOUT_MS, agent: AGENT_TIMEOUT_MS };

export interface Invocation { events: AgentEvent[]; code: number; stderr: string; auth: boolean; budget: boolean; timedOut: boolean }
export interface InvokeInput {
  cwd: string; tmpHome: string; prompt: string; opts: RunOptions; signal: AbortSignal; scrub: Scrub;
  model?: string; allowedBash?: string[]; onEvent?: (e: AgentEvent) => void; timeoutMs?: number;
}
const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

// Runs one agent process with stdin closed by the platform. An auth error event stops the process
// immediately (Codex would otherwise retry for a long time); a caller abort rethrows.
export async function invokeAgent(p: Platform, agent: AgentAdapter, i: InvokeInput): Promise<Invocation> {
  await p.fs.mkdirp(i.opts.agent === 'codex' ? `${i.tmpHome}/.codex` : i.tmpHome);
  const spec = agent.buildRun({ cwd: i.cwd, prompt: i.prompt, opts: i.opts, tmpHome: i.tmpHome, model: i.model, allowedBash: i.allowedBash });
  const ctl = new AbortController();
  const deadline = AbortSignal.timeout(i.timeoutMs ?? AGENT_TIMEOUT_MS);
  const signal = AbortSignal.any([i.signal, deadline, ctl.signal]);
  const out: Invocation = { events: [], code: 1, stderr: '', auth: false, budget: false, timedOut: false };
  try {
    const res = await p.proc.run(spec.bin, spec.args, {
      cwd: spec.cwd, env: { ...spec.env, ...SANDBOX_GIT_ENV }, signal,
      onLine: (stream, line) => {
        if (stream === 'stderr') return;
        const parsed = agent.parseLine(line);
        if (!parsed) return;
        const e = i.scrub.event(parsed);
        out.events.push(e);
        i.onEvent?.(e);
        if (e.kind === 'error' && e.error?.code === 'auth') { out.auth = true; ctl.abort(); }
        if (e.kind === 'error' && e.error?.code === 'budget') out.budget = true;
      },
    });
    out.code = res.code;
    out.stderr = res.stderr.slice(-1000);
  } catch (err) {
    if (i.signal.aborted || !isAbort(err)) throw err;
    if (deadline.aborted && !out.auth) out.timedOut = true;
    else if (!out.auth) throw err;
  }
  out.stderr = i.scrub.str(out.stderr);
  return out;
}
