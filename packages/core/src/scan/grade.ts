import type { Finding, Grade, Severity } from '../types';

const weights: Record<Severity, number> = { low: 1, medium: 3, high: 8, critical: 20 };
export function staticGrade(findings: Finding[]): { grade: Exclude<Grade, 'F'>; score: number } {
  const score = findings.reduce((sum, finding) => sum + weights[finding.severity], 0);
  return { grade: score === 0 ? 'A' : score <= 3 ? 'B' : score <= 10 ? 'C' : 'D', score };
}
export function finalGrade(staticG: Exclude<Grade, 'F'>, canaryHits: string[]): Grade {
  return canaryHits.length ? 'F' : staticG;
}
export type InstallGate = 'direct' | 'after-test' | 'blocked';
export function installGate(grade: Grade, tested: boolean): InstallGate {
  return grade === 'F' ? 'blocked' : grade === 'A' || grade === 'B' || tested ? 'direct' : 'after-test';
}
