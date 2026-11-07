<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { estimateUsage, type AgentEvent, type RunOptions } from '@somm/core';
  import { route, navigate } from '../../lib/route';
  import { t } from '../../i18n/t';
  import Button from '../../ui/Button.svelte';
  import Card from '../../ui/Card.svelte';
  import { changeAuth, resetKey, setApiKey, validKey } from './session';
  import type { Service, Skill } from './service';
  import { staticDenial } from './guards';
  import { runnerError } from './errors';
  import { notifyCleanupError, notifyCleanupResult } from './notifications';

  let service: Service | undefined = $state(), skill: Skill | undefined = $state();
  let project = $state(''), model = $state(''), task = $state(''), choices: string[] = $state([]), error = $state(''), busy = $state(false), phase = $state('');
  let history: number[] = $state([]);
  let options: RunOptions = $state({ agent: 'claude', auth: 'subscription', runs: 'quick' });
  let keyPresent = $state(false), keyTooShort = $state(false), events: { arm: string; event: AgentEvent }[] = $state([]);
  let controller: AbortController | undefined;
  let mounted = true;
  let canaryAlert = $state(false);
  let keyInput: HTMLInputElement | undefined = $state();
  const preview = import.meta.env.DEV && !isTauri();
  let denial = $derived(skill ? staticDenial(skill) : undefined);
  let estimate = $derived(estimateUsage(options, !choices.includes(task), history));
  function clearSession() { resetKey(keyInput); keyPresent = false; keyTooShort = false; }
  $effect(() => {
    window.addEventListener('beforeunload', clearSession);
    return () => { window.removeEventListener('beforeunload', clearSession); clearSession(); };
  });
  $effect(() => {
    const id = $route.page === 'runner' ? $route.skillId : '';
    let active = true; mounted = true;
    if (id) void (async () => { try {
      let s: Service;
      if (import.meta.env.DEV && !isTauri()) s = await (await import('./fake')).createFakeService();
      else s = await (await import('./service')).createService();
      const loaded = await s.load(id); if (active) { service = s; skill = loaded; }
    } catch { if (active) error = t('runner.loadError'); } })();
    return () => { active = false; mounted = false; controller?.abort(); clearSession(); };
  });
  $effect(() => {
    const current = service, agent = options.agent;
    let active = true; history = [];
    if (current) void current.history(agent).then(values => { if (active) history = values; }).catch(() => { if (active) history = []; });
    return () => { active = false; };
  });
  async function chooseProject() { try { const selected = await open({ directory: true, recursive: true }); if (typeof selected === 'string') project = selected; } catch { error = t('runner.actionError'); } }
  function valid() { return !!skill && !denial && !!project && (options.auth !== 'isolated' || (keyPresent && !!options.budgetUsd && options.budgetUsd > 0)); }
  async function propose() {
    if (!service || !skill || !valid()) return;
    busy = true; error = ''; controller = new AbortController();
    try { choices = await service.propose({ skill, project, options, model, signal: controller.signal }); }
    catch (e) { if (!notifyCleanupError(e) && mounted) error = runnerError(e, !!controller?.signal.aborted); clearSession(); }
    finally { busy = false; }
  }
  async function start() {
    if (!service || !skill || !valid() || !task.trim()) return;
    busy = true; error = ''; events = []; phase = ''; canaryAlert = false; controller = new AbortController();
    try {
      const outcome = await service.run({ skill, project, options, model, task: task.trim(), signal: controller.signal }, (arm, event) => { phase = arm; events = [...events, { arm, event }]; }, () => { canaryAlert = true; });
      clearSession(); if (mounted) navigate({ page: 'results', runId: outcome.id });
      else if (outcome.cleanupFailed) notifyCleanupResult(outcome.recoveryPath);
    } catch (e) { if (!notifyCleanupError(e) && mounted) error = runnerError(e, !!controller?.signal.aborted); }
    finally { busy = false; clearSession(); }
  }
</script>
<section class="runner">
  <h1>{t('runner.title')}</h1>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if canaryAlert}<p role="alert">{t('runner.canary')}</p>{/if}
  {#if !skill}<p>{t('runner.selectSkill')}</p>{:else}
  {#if preview}<p>{t('runner.preview')}</p>{/if}
  <div class="columns"><div><Card><h2>{skill.meta.name}</h2><p>{skill.meta.description}</p><h3>{t('runner.files')}</h3><ul>{#each skill.files as file}<li>{file.path}</li>{/each}</ul></Card></div>
  <div class="stack"><Card><fieldset disabled={busy}>
    <p>{t('runner.project')}: {project || '—'}</p>
    {#if preview}<Button variant="secondary" onclick={() => project = 'demo'}>{t('runner.demo')}</Button>{:else}<Button variant="secondary" onclick={chooseProject}>{t('runner.choose')}</Button>{/if}
    <label>{t('runner.agent')} <select bind:value={options.agent}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
    <label>{t('runner.auth')} <select bind:value={options.auth} onchange={(e) => { const mode = e.currentTarget.value as RunOptions['auth']; changeAuth(mode); if (mode !== 'isolated') { keyPresent = false; if (keyInput) keyInput.value = ''; } }}><option value="subscription">{t('runner.subscription')}</option><option value="isolated">{t('runner.isolated')}</option></select></label>
    {#if options.auth === 'isolated'}<label>API key <input bind:this={keyInput} type="password" autocomplete="off" oninput={(e) => { setApiKey(e.currentTarget.value); keyPresent = validKey(e.currentTarget.value); keyTooShort = !!e.currentTarget.value && !keyPresent; }} /></label><p>{t('runner.keyHint')}</p>{#if keyTooShort}<p role="alert">{t('runner.keyShort')}</p>{/if}
      <label>{t('runner.budget')} <input type="number" min="0.01" step="0.01" bind:value={options.budgetUsd} /></label>{/if}
    <label>{t('runner.model')} <input bind:value={model} /></label>
    <label>{t('runner.runs')} <select bind:value={options.runs}><option value="quick">{t('runner.quick')}</option><option value="thorough">{t('runner.thorough')}</option></select></label>
    {#if denial}<p role="status">{t(denial === 'grade' ? 'runner.deniedGrade' : 'runner.deniedTraits')}</p>{/if}
    <Button variant="secondary" disabled={!valid()} onclick={propose}>{t('runner.propose')}</Button>
    {#each choices as choice}<label><input type="radio" name="task" value={choice} bind:group={task} /> {choice}</label>{/each}
    <label>{t('runner.task')} <textarea bind:value={task}></textarea></label>
    <p>{t('runner.estimate', { runs: estimate.abRuns, calls: estimate.agentCalls })}{#if estimate.avgTokens !== undefined} · {t('runner.averageTokens', { count: Math.round(estimate.avgTokens) })}{/if}{#if estimate.maxUsd !== undefined} · ${estimate.maxUsd} {options.agent === 'codex' ? t('runner.notEnforced') : ''}{/if}</p>
    {#if estimate.warnThorough}<p role="alert">{t('runner.warning')}</p>{/if}
    <Button disabled={!valid() || !task.trim()} onclick={start}>{t('runner.start')}</Button>
  </fieldset></Card>
  <Card><h2>{t('runner.progress')}</h2><p>{t('results.baseline')} {phase.startsWith('a-') ? '▶' : '○'} / {t('results.withSkill')} {phase.startsWith('b-') ? '▶' : '○'}</p>{#if busy}<Button variant="secondary" onclick={() => { controller?.abort(); clearSession(); }}>{t('runner.cancel')}</Button>{/if}<div aria-live="polite" class="log">{#each events as entry}<p><strong>{entry.arm}</strong> {entry.event.text ?? entry.event.tool?.name ?? entry.event.kind}</p>{/each}</div></Card></div></div>
  {/if}
</section>
<style>
.runner { max-width: 1100px; margin: auto; } .columns { display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; } .stack { display: grid; gap: 1rem; } fieldset { border: 0; padding: 0; display: grid; gap: .8rem; } label { display: grid; gap: .35rem; } input, select, textarea { color: var(--foreground); background: var(--raised); border: 1px solid var(--border); padding: .5rem; } input[type=radio] { display: inline; } .log { max-height: 20rem; overflow: auto; overflow-wrap: anywhere; } @media(max-width:700px) { .columns { grid-template-columns: 1fr; } }
</style>
