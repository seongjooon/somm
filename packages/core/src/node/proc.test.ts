import { expect, test, vi } from 'vitest';
import { nodeProc as proc } from './proc';
test('runs git and resolves absolute binaries', async () => {
  expect((await proc.run('git', ['--version'])).code).toBe(0);
  expect((await proc.which(['git', 'somm_missing_binary'])).git).toMatch(/^\//);
  expect((await proc.which(['somm_missing_binary'])).somm_missing_binary).toBeNull();
});
test('removes inherited environment variables', async () => {
  process.env.SOMM_TEST_FOO = 'present';
  try {
    const result = await proc.run(process.execPath, ['-e', 'console.log("SOMM_TEST_FOO" in process.env)'], { env: { SOMM_TEST_FOO: null } });
    expect(result.stdout.trim()).toBe('false');
  } finally { delete process.env.SOMM_TEST_FOO; }
});
test('closes stdin immediately', async () => {
  expect((await proc.run(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>console.log("closed"))'])).stdout).toBe('closed\n');
});
test('splits streams independently and flushes partial lines', async () => {
  const lines: string[] = [];
  await proc.run(process.execPath, ['-e', 'process.stdout.write("a\\nb");process.stderr.write("c\\nd")'], { onLine: (stream, line) => lines.push(`${stream}:${line}`) });
  expect(lines.sort()).toEqual(['stderr:c', 'stderr:d', 'stdout:a', 'stdout:b']);
});
test('aborts and waits for child termination', async () => {
  const controller = new AbortController();
  let pid = 0;
  const result = proc.run(process.execPath, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], { signal: controller.signal, onLine: (_, line) => { pid = Number(line); controller.abort(); } });
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(() => process.kill(pid, 0)).toThrow();
});
test('aborts before spawn and rejects missing binaries', async () => {
  await expect(proc.run(process.execPath, [], { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(proc.run('/somm/nonexistent', [])).rejects.toMatchObject({ code: 'ENOENT' });
});
test('kills descendants even when the parent exits on SIGTERM', async () => {
  const controller = new AbortController();
  let descendant = 0;
  const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});console.log(process.pid);setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});c.stdout.on('data',d=>process.stdout.write(d));setInterval(()=>{},1000)`;
  const result = proc.run(process.execPath, ['-e', script], { signal: controller.signal, onLine: (_, line) => { descendant = Number(line); controller.abort(); } });
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(() => process.kill(descendant, 0)).toThrow();
});

test('ignores kill errors during cancellation and retries with SIGKILL', async () => {
  const controller = new AbortController();
  const kill = vi.spyOn(process, 'kill').mockImplementationOnce(() => { throw new Error('kill denied'); });
  try {
    const result = proc.run(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {
      signal: controller.signal, onLine: () => controller.abort(),
    });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  } finally { kill.mockRestore(); }
});
