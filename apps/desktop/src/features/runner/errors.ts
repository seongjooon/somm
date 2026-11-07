import { RunCleanupError } from '@somm/core';
import { t } from '../../i18n/t';
import { getApiKey } from './session';

export function runnerError(error: unknown, aborted: boolean): string {
  if (error instanceof RunCleanupError) {
    const key = getApiKey();
    const scrub = (value: string) => key ? [key, JSON.stringify(key).slice(1, -1)].reduce((text, part) => part ? text.split(part).join('[REDACTED]') : text, value) : value;
    return `${t('runner.cleanupFailed')} ${scrub(error.cleanupMessage)}${error.recoveryPath ? ` ${t('runner.recoveryPath')}: ${scrub(error.recoveryPath)}` : ''}`;
  }
  if (aborted) return t('runner.cancelled');
  if (error instanceof Error && error.name === 'TargetInResidueError') return t('runner.residue');
  return t('runner.actionError');
}
