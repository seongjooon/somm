<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { compare, summarize, type RunResult, type ScanReport } from '@somm/core';
  import { route, navigate } from '../../lib/route';
  import { t } from '../../i18n/t';
  import Button from '../../ui/Button.svelte';
  import Card from '../../ui/Card.svelte';
  import SommTag from '../../ui/SommTag.svelte';
  import type { RunHistoryEntry } from './service';
  import { runDescription } from './display';
  let result: RunResult | undefined = $state(), report: ScanReport | null = $state(null), error = $state(false), side: 'a' | 'b' = $state('a');
  let loading = $state(false);
  let history: RunHistoryEntry[] = $state([]), historyLoading = $state(false), historyError = $state(false);
  let a = $derived(result ? summarize(result.a) : undefined), b = $derived(result ? summarize(result.b) : undefined);
  let rows = $derived(a && b && a.okCount && b.okCount ? compare(a, b) : []);
  $effect(() => {
    const id = $route.page === 'results' ? $route.runId : '';
    let active = true; result = undefined; report = null; error = false; historyError = false; history = [];
    if (!id) {
      historyLoading = true;
      if (import.meta.env.DEV && !isTauri()) {
        void import('../runner/fake').then(({ previewResult }) => {
          if (active && previewResult) history = [{ id: previewResult.runId, skill_id: previewResult.meta.skill, agent: previewResult.meta.agent, auth: previewResult.meta.auth, runs_mode: previewResult.meta.runs, status: 'preview', started_at: previewResult.meta.startedAt, finished_at: previewResult.meta.finishedAt }];
        }).finally(() => { if (active) historyLoading = false; });
      }
      else void (async () => { try { const rows = await (await import('./service')).history(); if (active) history = rows; } catch { if (active) historyError = true; } finally { if (active) historyLoading = false; } })();
    } else historyLoading = false;
    if (id) { loading = true; void (async () => { try {
      if (import.meta.env.DEV && !isTauri() && id === 'preview') result = (await import('../runner/fake')).previewResult;
      else { const loaded = await (await import('./service')).load(id); if (active) { result = loaded.result; report = loaded.report; } }
      if (active && !result) error = true;
    } catch { if (active) error = true; } finally { if (active) loading = false; } })(); }
    return () => { active = false; };
  });
  function value(n: number, deviation?: number) { return `${n.toFixed(1)}${deviation === undefined ? '' : ` ± ${deviation.toFixed(1)}`}`; }
</script>
<section class="results"><h1>{t('results.title')}</h1>
{#if error}<p role="alert">{t('results.error')}</p><Button variant="secondary" onclick={() => navigate({ page: 'results', runId: '' })}>{t('results.history')}</Button>
{:else if loading}<p>{t('results.loading')}</p>
{:else if historyLoading}<p>{t('results.loadingHistory')}</p>
{:else if historyError}<p role="alert">{t('results.historyError')}</p>
{:else if !result}
  <h2>{t('results.history')}</h2>
  {#if history.length}<ul class="history">{#each history as entry (entry.id)}<li><Button variant="secondary" onclick={() => navigate({ page: 'results', runId: entry.id })}>{entry.skill_id} · {entry.agent} · {t(entry.runs_mode === 'thorough' ? 'runner.thorough' : 'runner.quick')} · {entry.status} · {entry.started_at}</Button></li>{/each}</ul>{:else}<p>{t('results.empty')}</p>{/if}
{:else}
  <Button variant="ghost" onclick={() => navigate({ page: 'results', runId: '' })}>← {t('results.history')}</Button>
  <header><h2>{result.meta.skill}</h2><SommTag verdict={result.tag === '// somm: pairs well' ? 'recommend' : result.tag === '// somm: corked' ? 'corked' : 'conditional'} /><p>{result.verdict?.line ?? t('results.noVerdict')}</p></header>
  {#if result.contamination.targetInResidue || result.warnings.includes('target-in-residue')}<p role="alert">{t('results.targetWarning')}</p>{/if}
  {#if result.warnings.includes('auth')}<p role="alert">{t('results.authWarning')}</p>{/if}
  {#if result.warnings.includes('cleanup-failed')}<p role="alert">{t('results.cleanupFailed')}{#if result.cleanupRecoveryPath} {t('results.recoveryPath')}: {result.cleanupRecoveryPath}{/if}</p>{/if}
  <div class="stack"><Card><h2>{t('results.comparison')}</h2><p>{runDescription(result)}</p>{#if result.meta.runs === 'thorough'}<p>{t('results.thorough')}</p>{/if}
  {#if rows.length}<div class="table"><table><thead><tr><th>{t('results.metric')}</th><th>{t('results.baseline')}</th><th>{t('results.withSkill')}</th><th>Δ</th></tr></thead><tbody>{#each rows as row}<tr><th>{t('results.metric.' + row.metric)}</th><td>{value(row.a, a?.stdev?.[row.metric])}</td><td>{value(row.b, b?.stdev?.[row.metric])}</td><td>{row.deltaPct === null ? '—' : `${row.deltaPct.toFixed(1)}%`}</td></tr>{/each}</tbody></table></div>{:else}<p>{t('results.noMetrics')}</p>{/if}</Card>
  <Card><h2>{t('results.contamination')}</h2><p>{result.contamination.status === 'clean' ? t('results.clean', { count: result.contamination.common.length }) : t('results.contaminated')}</p><p>{t('results.common')}: {result.contamination.common.join(', ') || '—'}</p><p>{t('results.extras')}: {result.contamination.extras.join(', ') || '—'}</p><p>{t('results.residue', { count: result.contamination.residue.length })}: {result.contamination.residue.join(', ') || '—'}</p></Card>
  <Card><h2>{t('results.diff')}</h2><div role="group" aria-label={t('results.diff')}><Button variant={side === 'a' ? 'primary' : 'secondary'} onclick={() => side = 'a'}>{t('results.baseline')}</Button> <Button variant={side === 'b' ? 'primary' : 'secondary'} onclick={() => side = 'b'}>{t('results.withSkill')}</Button></div>{#each result[side] as arm, i}<h3>{i + 1}</h3><pre>{arm.diff.patch || '—'}</pre>{/each}</Card>
  <Card><h2>{t('results.security')}</h2><p>{t('results.grade', { grade: result.grade })} · {t('results.eventBased')}</p><h3>{t('results.static')}</h3>{#if report}{#each report.findings as finding}<p>{finding.file}:{finding.line} · {finding.message}</p>{:else}<p>{t('results.noFindings')}</p>{/each}{:else}<p>{t('results.scanUnavailable')}</p>{/if}<h3>{t('results.events')}</h3>{#each [...result.a, ...result.b] as arm}{#each arm.canaryHits as hit}<p>{hit}</p>{/each}{/each}<p>{result.warnings.join(', ') || '—'}</p></Card>
  {#if result.meta.identity}<Button disabled={result.grade === 'F'} onclick={() => navigate({ page: 'installs', installSkillId: result!.meta.identity!.source })}>{t('results.install')}</Button>{/if}</div>
{/if}</section>
<style>.results { max-width: 1000px; margin: auto; } .history { padding: 0; list-style: none; display: grid; gap: .5rem; } .stack { display: grid; gap: 1rem; } .table { overflow-x: auto; } table { width: 100%; border-collapse: collapse; text-align: left; } th, td { padding: .6rem; border-bottom: 1px solid var(--border); } pre { white-space: pre-wrap; overflow-wrap: anywhere; } p { overflow-wrap: anywhere; }</style>
