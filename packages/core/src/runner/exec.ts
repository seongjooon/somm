import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import { SANDBOX_GIT_ENV } from '../sandbox';
import type { AgentEvent, RunOptions } from '../types';

// Replaces the API key (raw and JSON-escaped) so it can never reach events, errors or the DB.
export function makeScrub(key?: string) {
  const forms = key ? [key, JSON.stringify(key).slice(1, -1)] : [];
  const str = (s: string) => forms.reduce((acc, f) => acc.split(f).join('[REDACTED]'), s);
  const event = (e: AgentEvent): AgentEvent => {
    if (!key) return e;
    const json = JSON.stringify(e);
    return forms.some(f => json.includes(f)) ? JSON.parse(str(json)) : e;
  };
  return { str, event };
}
export type Scrub = ReturnType<typeof makeScrub>;

export interface Invocation { events: AgentEvent[]; code: number; stderr: string; auth: boolean; budget: boolean }
export interface InvokeInput {
  cwd: string; tmpHome: string; prompt: string; opts: RunOptions; signal: AbortSignal; scrub: Scrub;
  onEvent?: (e: AgentEvent) => void;
}
const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

// Runs one agent process with stdin closed by the platform. An auth error event stops the process
// immediately (Codex would otherwise retry for a long time); a caller abort rethrows.
export async function invokeAgent(p: Platform, agent: AgentAdapter, i: InvokeInput): Promise<Invocation> {
  await p.fs.mkdirp(i.opts.agent === 'codex' ? `${i.tmpHome}/.codex` : i.tmpHome);
  const spec = agent.buildRun({ cwd: i.cwd, prompt: i.prompt, opts: i.opts, tmpHome: i.tmpHome });
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  if (i.signal.aborted) ctl.abort(); else i.signal.addEventListener('abort', relay, { once: true });
  const out: Invocation = { events: [], code: 1, stderr: '', auth: false, budget: false };
  try {
    const res = await p.proc.run(spec.bin, spec.args, {
      cwd: spec.cwd, env: { ...spec.env, ...SANDBOX_GIT_ENV }, signal: ctl.signal,
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
    if (i.signal.aborted || !isAbort(err) || !out.auth) throw err;
  } finally { i.signal.removeEventListener('abort', relay); }
  out.stderr = i.scrub.str(out.stderr);
  return out;
}
