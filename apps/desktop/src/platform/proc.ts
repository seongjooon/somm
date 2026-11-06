import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Proc, ProcResult } from '@somm/core';
interface Line { id: string; stream: 'stdout' | 'stderr'; line: string; terminated: boolean }
export const tauriProc: Proc = {
  which: names => invoke('resolve_bins', { names }),
  async run(bin, args, opts = {}) {
    if (opts.signal?.aborted) throw new DOMException('Process aborted', 'AbortError');
    const id = crypto.randomUUID();
    const result: ProcResult = { code: 1, stdout: '', stderr: '' };
    const unlisten: UnlistenFn[] = [];
    let aborted = false;
    let started = false;
    let killing: Promise<void> | undefined;
    const abort = () => {
      aborted = true;
      if (started && !killing) {
        killing = invoke<void>('kill_agent', { id });
        void killing.catch(fail);
      }
    };
    let finish!: (value: ProcResult) => void;
    let fail!: (error: unknown) => void;
    const done = new Promise<ProcResult>((resolve, reject) => { finish = resolve; fail = reject; });
    // Attach a rejection handler while listeners and spawn are being installed.
    void done.catch(() => {});
    try {
      unlisten.push(await listen<Line>('proc://line', ({ payload: p }) => {
        if (p.id !== id) return;
        result[p.stream] += p.line + (p.terminated ? '\n' : '');
        opts.onLine?.(p.stream, p.line);
      }));
      unlisten.push(await listen<{ id: string; code: number }>('proc://exit', ({ payload: p }) => {
        if (p.id !== id) return;
        finish({ ...result, code: p.code });
      }));
      opts.signal?.addEventListener('abort', abort, { once: true });
      if (opts.signal?.aborted) throw new DOMException('Process aborted', 'AbortError');
      const name = bin.split('/').pop()!;
      const path = bin.startsWith('/') ? bin : (await this.which([name]))[name];
      if (!path) throw new Error(`Binary not found: ${name}`);
      await invoke('spawn_agent', { id, binName: name, binPath: path, args, cwd: opts.cwd ?? null, env: opts.env ?? {} });
      started = true;
      if (aborted || opts.signal?.aborted) abort();
      const completed = await done;
      if (aborted) {
        await killing;
        throw new DOMException('Process aborted', 'AbortError');
      }
      return completed;
    } finally {
      opts.signal?.removeEventListener('abort', abort);
      for (const stop of unlisten) stop();
    }
  },
};
