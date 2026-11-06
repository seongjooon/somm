import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Proc } from '../platform';
export const nodeProc: Proc = {
  async which(names) {
    return Object.fromEntries(await Promise.all(names.map(async name => {
      for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        const path = join(dir, name);
        try { await access(path, constants.X_OK); if (isAbsolute(path)) return [name, path]; } catch { /* Try the next PATH entry. */ }
      }
      return [name, null];
    })));
  },
  async run(bin, args, opts = {}) {
    if (opts.signal?.aborted) throw new DOMException('Process aborted', 'AbortError');
    const env = { ...process.env };
    for (const [key, value] of Object.entries(opts.env ?? {})) {
      if (value === null) delete env[key]; else env[key] = value;
    }
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const output = { stdout: '', stderr: '' };
      const pending = { stdout: '', stderr: '' };
      let aborted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (child.pid) { try { process.kill(-child.pid, signal); } catch { /* Cancellation must remain best-effort if signaling fails. */ } }
      };
      const abort = () => { aborted = true; kill('SIGTERM'); timer = setTimeout(() => kill('SIGKILL'), 300); };
      opts.signal?.addEventListener('abort', abort, { once: true });
      for (const stream of ['stdout', 'stderr'] as const) {
        child[stream].setEncoding('utf8');
        child[stream].on('data', (chunk: string) => {
          output[stream] += chunk;
          pending[stream] += chunk;
          const lines = pending[stream].split('\n');
          pending[stream] = lines.pop()!;
          for (const line of lines) opts.onLine?.(stream, line.replace(/\r$/, ''));
        });
      }
      child.once('error', reject);
      child.once('close', code => {
        // Descendants may outlive the direct child after SIGTERM.
        if (aborted) kill('SIGKILL');
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abort);
        for (const stream of ['stdout', 'stderr'] as const) if (pending[stream]) opts.onLine?.(stream, pending[stream]);
        if (aborted) reject(new DOMException('Process aborted', 'AbortError'));
        else resolve({ code: code ?? 1, ...output });
      });
      if (opts.signal?.aborted) abort();
    });
  },
};
