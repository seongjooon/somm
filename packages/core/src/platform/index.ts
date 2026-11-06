import type { SkillFile } from '../types';
export interface DirEntry { name: string; isDir: boolean; isSymlink: boolean }
export interface Fs {
  exists(p: string): Promise<boolean>; readText(p: string): Promise<string>;
  writeText(p: string, s: string): Promise<void>; readDir(p: string): Promise<DirEntry[]>;
  mkdirp(p: string): Promise<void>; remove(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>; symlink(target: string, link: string): Promise<void>;
}
export interface ProcResult { code: number; stdout: string; stderr: string }
export interface Proc {
  which(names: string[]): Promise<Record<string, string | null>>;
  run(bin: string, args: string[], opts?: {
    cwd?: string; env?: Record<string, string | null>;       // null = 상속 env에서 제거
    onLine?: (stream: 'stdout' | 'stderr', line: string) => void; signal?: AbortSignal;
  }): Promise<ProcResult>;
}
export interface Db { select<T>(sql: string, params?: unknown[]): Promise<T[]>; execute(sql: string, params?: unknown[]): Promise<void> }
export interface Platform { fs: Fs; proc: Proc; db: Db; home: string; dataDir: string; env: Record<string, string | undefined> }

export function resolveDataDir(env: Record<string, string | undefined>, home: string): string {
  return env.SOMM_DATA_DIR ?? `${home.replace(/\/$/, '')}/Library/Application Support/io.github.seongjooon.somm`;
}
export async function hashFiles(files: SkillFile[]): Promise<string> {
  const text = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(f => `${f.path}\0${f.contents}\0`).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export { migrate } from './migrate';
