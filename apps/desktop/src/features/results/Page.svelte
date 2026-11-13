<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { compare, summarize, type RunResult, type ScanReport } from '@somm/core';
  import { route, navigate } from '../../lib/route';
  import { t, translate } from '../../i18n/t';
  import Button from '../../ui/Button.svelte';
  import Card from '../../ui/Card.svelte';
  import SommTag from '../../ui/SommTag.svelte';
  import type { RunHistoryEntry } from './service';
  import { formatPercentage, formatValue, runDescription } from './display';
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
</script>
<section class="results"><h1>{$translate('results.title')}</h1>
{#if error}<p role="alert">{$translate('results.error')}</p><Button variant="secondary" onclick={() => navigate({ page: 'results', runId: '' })}>{$translate('results.history')}</Button>
{:else if loading}<p>{$translate('results.loading')}</p>
{:else if historyLoading}<p>{$translate('results.loadingHistory')}</p>
{:else if historyError}<p role="alert">{$translate('results.historyError')}</p>
{:else if !result}
  <h2>{$translate('results.history')}</h2>
  {#if history.length}<ul class="history">{#each history as entry (entry.id)}<li><Button variant="secondary" onclick={() => navigate({ page: 'results', runId: entry.id })}>{entry.skill_id} · {entry.agent} · {$translate(entry.runs_mode === 'thorough' ? 'runner.thorough' : 'runner.quick')} · {entry.status} · {entry.started_at}</Button></li>{/each}</ul>{:else}<p>{$translate('results.empty')}</p>{/if}
{:else}
  <Button variant="ghost" onclick={() => navigate({ page: 'results', runId: '' })}>← {$translate('results.history')}</Button>
  <header><h2>{result.meta.skill}</h2><SommTag verdict={result.tag === '// somm: pairs well' ? 'recommend' : result.tag === '// somm: corked' ? 'corked' : 'conditional'} /><p>{result.verdict?.line ?? $translate('results.noVerdict')}</p></header>
  {#if result.contamination.targetInResidue || result.warnings.includes('target-in-residue')}<p role="alert">{$translate('results.targetWarning')}</p>{/if}
  {#if result.warnings.includes('auth')}<p role="alert">{$translate('results.authWarning')}</p>{/if}
  {#if result.warnings.includes('cleanup-failed')}<p role="alert">{$translate('results.cleanupFailed')}{#if result.cleanupRecoveryPath} {$translate('results.recoveryPath')}: {result.cleanupRecoveryPath}{/if}</p>{/if}
  <div class="stack"><Card><h2>{$translate('results.comparison')}</h2><p>{runDescription(result)}</p>{#if result.meta.runs === 'thorough'}<p>{$translate('results.thorough')}</p>{/if}
  {#if rows.length}<div class="table"><table><thead><tr><th>{$translate('results.metric')}</th><th>{$translate('results.baseline')}</th><th>{$translate('results.withSkill')}</th><th>Δ</th></tr></thead><tbody>{#each rows as row}<tr><th>{$translate('results.metric.' + row.metric)}</th><td>{formatValue(row.a, result.meta.runs === 'thorough', a?.stdev?.[row.metric])}</td><td>{formatValue(row.b, result.meta.runs === 'thorough', b?.stdev?.[row.metric])}</td><td>{formatPercentage(row.deltaPct)}</td></tr>{/each}</tbody></table></div>{:else}<p>{$translate('results.noMetrics')}</p>{/if}</Card>
  <Card><h2>{$translate('results.contamination')}</h2><p>{result.contamination.status === 'clean' ? $translate('results.clean', { count: result.contamination.common.length }) : $translate('results.contaminated')}</p><p>{$translate('results.common')}: {result.contamination.common.join(', ') || '—'}</p><p>{$translate('results.extras')}: {result.contamination.extras.join(', ') || '—'}</p><p>{$translate('results.residue', { count: result.contamination.residue.length })}: {result.contamination.residue.join(', ') || '—'}</p></Card>
  <Card><h2>{$translate('results.diff')}</h2><div role="group" aria-label={$translate('results.diff')}><Button variant={side === 'a' ? 'primary' : 'secondary'} onclick={() => side = 'a'}>{$translate('results.baseline')}</Button> <Button variant={side === 'b' ? 'primary' : 'secondary'} onclick={() => side = 'b'}>{$translate('results.withSkill')}</Button></div>{#each result[side] as arm, i}<h3>{$translate('results.run', { n: i + 1 })}</h3><pre>{arm.diff.patch || '—'}</pre>{/each}</Card>
  <Card><h2>{$translate('results.security')}</h2><p>{$translate('results.grade', { grade: result.grade })} · {$translate('results.eventBased')}</p><h3>{$translate('results.static')}</h3>{#if report}{#each report.findings as finding}<p>{finding.file}:{finding.line} · {finding.message}</p>{:else}<p>{$translate('results.noFindings')}</p>{/each}{:else}<p>{$translate('results.scanUnavailable')}</p>{/if}<h3>{$translate('results.events')}</h3>{#each [...result.a, ...result.b] as arm}{#each arm.canaryHits as hit}<p>{hit}</p>{/each}{/each}<p>{result.warnings.join(', ') || '—'}</p></Card>
  {#if result.meta.identity}<Button variant={result.tag === '// somm: corked' ? 'secondary' : 'primary'} disabled={result.grade === 'F'} onclick={() => navigate({ page: 'installs', installSkillId: result!.meta.identity!.source })}>{$translate('results.install')}</Button>{/if}</div>
{/if}</section>
<style>.results { max-width: 1000px; margin: auto; } .history { padding: 0; list-style: none; display: grid; gap: .5rem; } .stack { display: grid; gap: 1rem; } .table { overflow-x: auto; } table { width: 100%; border-collapse: collapse; text-align: left; } th, td { padding: .6rem; border-bottom: 1px solid var(--border); } pre { white-space: pre-wrap; overflow-wrap: anywhere; } p { overflow-wrap: anywhere; }</style>
