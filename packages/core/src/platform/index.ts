import type { SkillFile } from '../types';
export interface DirEntry { name: string; isDir: boolean; isSymlink: boolean }
export interface Fs {
  fileSize(p: string): Promise<number>;
  readBytes(p: string): Promise<Uint8Array>; writeBytes(p: string, bytes: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>; readText(p: string): Promise<string>;
  writeText(p: string, s: string): Promise<void>; readDir(p: string): Promise<DirEntry[]>;
  mkdirp(p: string): Promise<void>; remove(p: string): Promise<void>;
  readlink(p: string): Promise<string>;
  // Same-filesystem rename atomically replaces an existing regular file.
  rename(from: string, to: string): Promise<void>; symlink(target: string, link: string): Promise<void>;
}
export interface ProcResult { code: number; stdout: string; stderr: string }
export interface Proc {
  which(names: string[]): Promise<Record<string, string | null>>;
  run(bin: string, args: string[], opts?: {
    cwd?: string; env?: Record<string, string | null>;       // null removes the variable from the inherited environment.
    onLine?: (stream: 'stdout' | 'stderr', line: string) => void; signal?: AbortSignal;
  }): Promise<ProcResult>;
}
export interface Db { select<T>(sql: string, params?: unknown[]): Promise<T[]>; execute(sql: string, params?: unknown[]): Promise<void> }
export interface Platform { fs: Fs; proc: Proc; db: Db; home: string; dataDir: string; env: Record<string, string | undefined> }

export function resolveDataDir(env: Record<string, string | undefined>, home: string): string {
  return env.SOMM_DATA_DIR || `${home.replace(/\/$/, '')}/Library/Application Support/io.github.seongjooon.somm`;
}
export async function hashFiles(files: SkillFile[]): Promise<string> {
  // Length-prefixed byte format intentionally replaces the pre-release T4 hash format.
  const encoder = new TextEncoder();
  const parts = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).flatMap(f => {
    const bytes = typeof f.contents === 'string' ? encoder.encode(f.contents) : f.contents;
    return [encoder.encode(JSON.stringify([f.path, bytes.length]) + '\n'), bytes];
  });
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export { migrate } from './migrate';
