import { writable } from 'svelte/store';
import { RunCleanupError } from '@somm/core';
import { runnerError } from './errors';
import { t } from '../../i18n/t';
import { RunSaveError } from './save';

export const cleanupNotices = writable<{ id: number; message: string }[]>([]);
let nextId = 0;
export function notifyCleanupError(error: unknown): boolean {
  if (error instanceof RunSaveError) {
    const cleanup = error.cleanupFailed ? ` ${t('runner.cleanupFailed')}${error.recoveryPath ? ` ${t('runner.recoveryPath')}: ${error.recoveryPath}` : ''}` : '';
    cleanupNotices.update(items => [...items, { id: ++nextId, message: `${t('runner.saveFailed')}${cleanup}` }]);
    return true;
  }
  if (!(error instanceof RunCleanupError)) return false;
  cleanupNotices.update(items => [...items, { id: ++nextId, message: runnerError(error, false) }]);
  return true;
}
export function notifyCleanupResult(recoveryPath?: string): void {
  const message = `${t('runner.cleanupFailed')}${recoveryPath ? ` ${t('runner.recoveryPath')}: ${recoveryPath}` : ''}`;
  cleanupNotices.update(items => [...items, { id: ++nextId, message }]);
}
export function dismissCleanupNotice(id: number): void { cleanupNotices.update(items => items.filter(item => item.id !== id)); }
