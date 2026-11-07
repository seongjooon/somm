import type { RunResult } from '@somm/core';
import { t } from '../../i18n/t';
export function runDescription(result: RunResult): string {
  const mode = t(result.meta.runs === 'thorough' ? 'runner.thorough' : 'runner.quick');
  const confidence = t(result.confidence === 'low' ? 'results.lowConfidence' : 'results.normalConfidence');
  const counts = t('results.armCounts', { a: result.a.filter(arm => arm.ok).length, at: result.a.length, b: result.b.filter(arm => arm.ok).length, bt: result.b.length });
  return `${mode} · ${confidence} · ${counts}`;
}

export function formatValue(value: number, thorough = false, deviation?: number): string {
  return `${value.toFixed(thorough ? 1 : 0)}${deviation === undefined || !thorough ? '' : ` ± ${deviation.toFixed(1)}`}`;
}
export function formatPercentage(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}
