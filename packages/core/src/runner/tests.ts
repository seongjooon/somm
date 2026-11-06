import type { Platform } from '../platform';

type Counts = { passed: number; failed: number };
const ANSI = /\u001b\[[0-9;]*m/g;
const num = (s: string, re: RegExp) => Number(re.exec(s)?.[1] ?? 0);

// Recognizes the summary lines of vitest, jest, node --test, pytest, unittest, cargo and `go test -v`.
export function parseTestOutput(out: string): Counts | null {
  const text = out.replace(ANSI, '');
  const node = /^ℹ pass (\d+)\s*$/m.exec(text);
  if (node) return { passed: Number(node[1]), failed: num(text, /^ℹ fail (\d+)\s*$/m) };
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)];
  if (cargo.length) return cargo.reduce((a, m) => ({ passed: a.passed + +m[1], failed: a.failed + +m[2] }), { passed: 0, failed: 0 });
  const go = [...text.matchAll(/^\s*--- (PASS|FAIL):/gm)];
  if (go.length) return { passed: go.filter(m => m[1] === 'PASS').length, failed: go.filter(m => m[1] === 'FAIL').length };
  const ran = /^Ran (\d+) tests? in /m.exec(text);
  if (ran) {
    const failed = num(text, /failures=(\d+)/) + num(text, /errors=(\d+)/);
    return { passed: Math.max(0, Number(ran[1]) - failed), failed };
  }
  const js = /^\s*Tests:?\s+(.*\d+ (?:passed|failed).*)$/m.exec(text);
  if (js) return { passed: num(js[1], /(\d+) passed/), failed: num(js[1], /(\d+) failed/) };
  const py = /^=*\s*((?:\d+ \w+(?:, )?)+) in [\d.]+s/m.exec(text);
  if (py && /\d+ (passed|failed|error)/.test(py[1])) {
    return { passed: num(py[1], /(\d+) passed/), failed: num(py[1], /(\d+) failed/) + num(py[1], /(\d+) errors?/) };
  }
  return null;
}

async function pythonCommand(p: Platform, dir: string): Promise<string[] | null> {
  const names = (await p.fs.readDir(dir)).map(e => e.name);
  const isPython = names.some(n => n.endsWith('.py') || ['pyproject.toml', 'requirements.txt', 'setup.py', 'pytest.ini'].includes(n));
  if (!isPython) return null;
  const venv = ['.venv', 'venv'].find(n => names.includes(n));
  const python = venv ? `${dir}/${venv}/bin/python` : 'python3';
  const pytest = names.includes('pytest.ini') || names.includes('conftest.py')
    || (names.includes('pyproject.toml') && (await p.fs.readText(`${dir}/pyproject.toml`)).includes('pytest'));
  return [python, '-m', pytest ? 'pytest' : 'unittest'];
}

export async function detectTestCommand(p: Platform, dir: string): Promise<string[] | null> {
  if (await p.fs.exists(`${dir}/package.json`)) {
    try {
      const pkg = JSON.parse(await p.fs.readText(`${dir}/package.json`));
      if (typeof pkg?.scripts?.test === 'string') {
        const pm = await p.fs.exists(`${dir}/pnpm-lock.yaml`) ? 'pnpm' : await p.fs.exists(`${dir}/yarn.lock`) ? 'yarn' : 'npm';
        return [pm, 'test'];
      }
    } catch { /* malformed package.json: fall through */ }
  }
  const py = await pythonCommand(p, dir);
  if (py) return py;
  if (await p.fs.exists(`${dir}/Cargo.toml`)) return ['cargo', 'test'];
  // -v is needed because plain `go test` prints no per-test counts.
  if (await p.fs.exists(`${dir}/go.mod`)) return ['go', 'test', '-v', './...'];
  return null;
}
