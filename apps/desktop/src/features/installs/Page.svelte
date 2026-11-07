<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { SkillExistsError, type AgentId, type DetectResult, type InstalledSkill, type Scope, type Conflict } from '@somm/core';
  import Button from '../../ui/Button.svelte';
  import Card from '../../ui/Card.svelte';
  import Badge from '../../ui/Badge.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Spinner from '../../ui/Spinner.svelte';
  import { t } from '../../i18n/t';
  import { route, navigate } from '../../lib/route';
  import { groupInstalled } from './helpers';
  import { createService, type Backup, type Prepared, type Service } from './service';

  const agentIds: AgentId[] = ['claude', 'codex'];
  const scopes: Scope[] = ['global', 'project'];
  let service: Service;
  let loading = $state(true), busy = $state(false), error = $state('');
  let detected = $state<Record<AgentId, DetectResult>>({ claude: { installed: false, loggedIn: 'unknown' }, codex: { installed: false, loggedIn: 'unknown' } });
  let items = $state<InstalledSkill[]>([]), backups = $state<Backup[]>([]);
  let plugins = $state<Record<AgentId, string[]>>({ claude: [], codex: [] });
  let conflicts = $state<Record<string, Conflict[]>>({}), updates = $state<Record<string, boolean | null>>({});
  let project = $state<string | undefined>(), prepared = $state<Prepared | undefined>();
  let installOpen = $state(false), confirmOpen = $state(false), warned = $state(false);
  let selectedAgent = $state<AgentId>('claude'), scope = $state<Scope>('global'), mode = $state<'copy' | 'symlink'>('copy'), linkSource = $state<string | undefined>();
  let confirmMessage = $state(''), confirmAction: (() => Promise<void>) | undefined;
  let handledRoute = '';
  const grouped = $derived(groupInstalled(items));

  async function task(fn: () => Promise<void>) {
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }
  async function refresh() {
    items = await service.list(project);
    backups = await service.backups();
    conflicts = await service.conflicts(items);
  }
  async function chooseProject() {
    const value = import.meta.env.DEV && !('__TAURI_INTERNALS__' in window) ? '/demo/project' : await open({ directory: true, recursive: true });
    if (typeof value === 'string') { project = value; await refresh(); }
  }
  async function chooseLink() {
    const value = import.meta.env.DEV && !('__TAURI_INTERNALS__' in window) ? '/demo/skill' : await open({ directory: true, recursive: true });
    if (typeof value === 'string') linkSource = value;
  }
  function confirm(message: string, action: () => Promise<void>) { confirmMessage = message; confirmAction = action; confirmOpen = true; }
  async function accept() { const action = confirmAction; confirmOpen = false; if (action) await task(action); }
  async function requestRestore(backup: Backup, overwrite = false) {
    try { await service.restore(backup.id, overwrite); await refresh(); }
    catch (e) { if (e instanceof SkillExistsError && !overwrite) confirm(t('installs.overwriteConfirm'), () => requestRestore(backup, true)); else throw e; }
  }
  async function submitInstall(overwrite = false) {
    if (!prepared || prepared.gate === 'blocked' || (prepared.gate === 'after-test' && !warned)) return;
    try {
      await service.install(prepared, selectedAgent, scope, project, mode, linkSource, overwrite);
      installOpen = false; navigate({ page: 'installs' }); await refresh();
    } catch (e) { if (e instanceof SkillExistsError && !overwrite) confirm(t('installs.overwriteConfirm'), () => submitInstall(true)); else throw e; }
  }
  async function openInstall(id: string) {
    prepared = undefined; warned = false; installOpen = true;
    await task(async () => { prepared = await service.prepare(id); selectedAgent = agentIds.find(a => detected[a].installed && prepared?.meta.agents.includes(a)) ?? 'claude'; });
  }
  onMount(() => {
    void (async () => {
      try {
        service = await createService(); detected = await service.detect();
        for (const agent of agentIds) if (detected[agent].installed) plugins[agent] = await service.plugins(agent);
        await refresh();
      } catch (e) { error = e instanceof Error ? e.message : String(e); }
      finally { loading = false; }
    })();
  });
  $effect(() => {
    const id = $route.page === 'installs' ? $route.installSkillId : undefined;
    if (!loading && service && id && id !== handledRoute) { handledRoute = id; void openInstall(id); }
    if (!id) handledRoute = '';
  });
</script>

<section class="mx-auto max-w-5xl space-y-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div><p class="text-sm text-muted">{t('installs.eyebrow')}</p><h1 class="text-3xl font-semibold">{t('installs.title')}</h1><p class="mt-2 text-muted">{t('installs.subtitle')}</p></div>
    <Button variant="secondary" disabled={busy || loading} onclick={() => task(chooseProject)}>{t('installs.chooseProject')}</Button>
  </header>
  {#if project}<p class="break-all text-sm text-muted">{t('installs.projectSelected', { project })}</p>{/if}
  {#if error}<div role="alert" class="rounded-lg border border-border bg-surface p-4">{t('installs.error')}: {error}</div>{/if}
  {#if loading}<Spinner label={t('installs.loading')} /><span class="ml-2">{t('installs.loading')}</span>
  {:else}
    {#each agentIds as agent}
      <Card>
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{t(`installs.agent.${agent}`)}</h2>
          <Badge>{!detected[agent].installed ? t('installs.notInstalled') : detected[agent].loggedIn === false ? t('installs.notLoggedIn') : detected[agent].loggedIn === 'unknown' ? t('installs.loginUnknown') : t('installs.ready')}</Badge>
        </div>
        {#each scopes as currentScope}
          <div class="mt-5"><h3 class="font-semibold">{t(`installs.scope.${currentScope}`)}</h3>
            {#if currentScope === 'project' && !project}<p class="mt-2 text-sm text-muted">{t('installs.selectProject')}</p>
            {:else if grouped[agent][currentScope].length === 0}<p class="mt-2 text-sm text-muted">{t('installs.empty')}</p>
            {:else}
              {#each grouped[agent][currentScope] as item (item.dir)}
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>{item.name}</strong><Badge>{item.enabled ? t('installs.enabled') : t('installs.disabled')}</Badge>
                    {#if conflicts[item.dir]?.length}<Badge>{t('installs.conflicts', { n: conflicts[item.dir].length })}</Badge>{/if}
                    {#if updates[item.dir] === true}<Badge>{t('installs.updateAvailable')}</Badge>{:else if updates[item.dir] === false}<Badge>{t('installs.upToDate')}</Badge>{/if}
                  </div><p class="break-all text-xs text-muted">{item.dir}</p>
                  {#each conflicts[item.dir] ?? [] as conflict}<p class="text-sm text-muted">{t('installs.conflictWith', { kind: conflict.kind, name: conflict.with })}</p>{/each}</div>
                  <div class="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onclick={() => task(async () => { updates[item.dir] = await service.update(item); if (updates[item.dir] === null) error = t('installs.noSource'); })}>{t('installs.checkUpdate')}</Button>
                    <Button variant="secondary" disabled={busy} onclick={() => task(async () => { await service.toggle(item); await refresh(); })}>{item.enabled ? t('installs.disable') : t('installs.enable')}</Button>
                    <Button variant="danger" disabled={busy} onclick={() => confirm(t('installs.uninstallConfirm', { name: item.name }), async () => { await service.uninstall(item); await refresh(); })}>{t('installs.uninstall')}</Button></div>
                </div>
              {/each}
            {/if}
          </div>
        {/each}
        <div class="mt-5 border-t border-border pt-4"><h3 class="font-semibold">{t('installs.plugins')}</h3><p class="mt-2 text-sm text-muted">{plugins[agent].length ? plugins[agent].join(', ') : t('installs.noPlugins')}</p></div>
      </Card>
    {/each}
    <Card><h2 class="text-xl font-semibold">{t('installs.backups')}</h2>
      {#if !backups.length}<p class="mt-2 text-muted">{t('installs.noBackups')}</p>{/if}
      {#each backups as backup (backup.id)}<div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><div><strong>{backup.name}</strong><p class="text-sm text-muted">{t(`installs.agent.${backup.agent}`)} · {t(`installs.scope.${backup.scope}`)} · {backup.created_at}</p></div><Button variant="secondary" disabled={busy} onclick={() => confirm(t('installs.restoreConfirm', { name: backup.name }), () => requestRestore(backup))}>{t('installs.restore')}</Button></div>{/each}
    </Card>
  {/if}
</section>
<Dialog bind:open={installOpen} title={t('installs.installTitle')} closeLabel={t('installs.close')}>
  {#if error}<p role="alert">{t('installs.error')}: {error}</p>{/if}
  {#if !prepared}<p>{busy ? t('installs.loading') : t('installs.installUnavailable')}</p>
  {:else}
    <div class="space-y-4"><div><h3 class="font-semibold">{prepared.meta.name}</h3><p class="text-sm text-muted">{prepared.meta.description}</p><Badge>{t('installs.grade', { grade: prepared.grade })}</Badge></div>
      <label class="block">{t('installs.agentLabel')}<select class="mt-1 block w-full rounded border border-border bg-raised p-2" bind:value={selectedAgent}>{#each agentIds as agent}<option value={agent} disabled={!detected[agent].installed || !prepared.meta.agents.includes(agent)}>{t(`installs.agent.${agent}`)}{!detected[agent].installed ? ` — ${t('installs.notInstalled')}` : ''}</option>{/each}</select></label>
      <label class="block">{t('installs.scopeLabel')}<select class="mt-1 block w-full rounded border border-border bg-raised p-2" bind:value={scope}><option value="global">{t('installs.scope.global')}</option><option value="project">{t('installs.scope.project')}</option></select></label>
      {#if scope === 'project'}<Button variant="secondary" onclick={() => task(chooseProject)}>{project ?? t('installs.chooseProject')}</Button>{/if}
      <label class="block">{t('installs.mode')}<select class="mt-1 block w-full rounded border border-border bg-raised p-2" bind:value={mode}><option value="copy">{t('installs.copy')}</option><option value="symlink">{t('installs.symlink')}</option></select></label>
      {#if mode === 'symlink'}<Button variant="secondary" onclick={() => task(chooseLink)}>{linkSource ?? t('installs.chooseSource')}</Button>{/if}
      <p class="text-sm text-muted">{t('installs.backupNotice')}</p>
      {#if prepared.gate === 'blocked'}<p role="alert">{t('installs.blocked')}</p>{:else if prepared.gate === 'after-test'}<label class="flex gap-2"><input type="checkbox" bind:checked={warned} />{t('installs.warning')}</label>{/if}
      <Button disabled={busy || prepared.gate === 'blocked' || (prepared.gate === 'after-test' && !warned) || !detected[selectedAgent].installed || !prepared.meta.agents.includes(selectedAgent) || (scope === 'project' && !project) || (mode === 'symlink' && !linkSource)} onclick={() => task(() => submitInstall())}>{t('installs.install')}</Button>
    </div>
  {/if}
</Dialog>
<Dialog bind:open={confirmOpen} title={t('installs.confirmTitle')} closeLabel={t('installs.close')}><p>{confirmMessage}</p><div class="mt-4 flex gap-2"><Button variant="secondary" onclick={() => confirmOpen = false}>{t('installs.cancel')}</Button><Button variant="danger" onclick={accept}>{t('installs.confirm')}</Button></div></Dialog>
