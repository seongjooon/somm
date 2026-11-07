<script lang="ts">
  import { route, navigate, type Route } from './lib/route';
  import { t, translate, setLocale } from './i18n/t';
  import { isTauri } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { startDesktop } from './platform';
  import { applyTheme, loadTheme, saveTheme, type Theme } from './features/theme/theme';
  import Store from './features/store/Page.svelte';
  import Detail from './features/detail/Page.svelte';
  import Runner from './features/runner/Page.svelte';
  import Results from './features/results/Page.svelte';
  import Installs from './features/installs/Page.svelte';
  import { cleanupNotices, dismissCleanupNotice } from './features/runner/notifications';
  const pages = { store: Store, detail: Detail, runner: Runner, results: Results, installs: Installs };
  const links: Route[] = [{ page: 'store' }, { page: 'detail', skillId: '' },
    { page: 'runner', skillId: '' }, { page: 'results', runId: '' }, { page: 'installs' }];
  function initialTheme(): Theme {
    const value = loadTheme();
    applyTheme(value);
    return value;
  }
  let theme: Theme = $state(initialTheme());
  function changeTheme(event: Event) {
    theme = (event.currentTarget as HTMLSelectElement).value as Theme;
    saveTheme(theme);
  }
  let locale = $state<'en' | 'ko'>('en');
  let status = $state<'starting' | 'ready' | 'error'>(isTauri() ? 'starting' : 'ready');
  onMount(() => { if (isTauri()) void startDesktop().then(() => status = 'ready').catch(() => status = 'error'); });
  function changeLocale(event: Event) { locale = (event.currentTarget as HTMLSelectElement).value as 'en' | 'ko'; setLocale(locale); }
  const Page = $derived(pages[$route.page]);
</script>
<nav aria-label="Main">
  {#each links as link}
    <button aria-current={$route.page === link.page ? 'page' : undefined}
      onclick={() => navigate(link)}>{$translate('nav.' + link.page)}</button>
  {/each}
  <label>{$translate('language.label')} <select value={locale} onchange={changeLocale}><option value="en">English</option><option value="ko">한국어</option></select></label>
  <label>{$translate("theme.label")} <select value={theme} onchange={changeTheme}>
    <option value="dark">{$translate("theme.dark")}</option><option value="light">{$translate("theme.light")}</option>
  </select></label>
</nav>
<div aria-live="assertive">{#each $cleanupNotices as notice (notice.id)}<div role="alert"><span>{notice.message}</span> <button aria-label={$translate('runner.dismissCleanup')} onclick={() => dismissCleanupNotice(notice.id)}>{$translate('runner.dismissCleanup')}</button></div>{/each}</div>
<main>{#if status === 'starting'}<p role="status">{$translate('startup.loading')}</p>{:else if status === 'error'}<p role="alert">{$translate('startup.error')}</p>{:else}<Page />{/if}</main>
