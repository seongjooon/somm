<script lang="ts">
  import { route, navigate, type Route } from './lib/route';
  import { t } from './i18n/t';
  import { applyTheme, loadTheme, saveTheme, type Theme } from './features/theme/theme';
  import Store from './features/store/Page.svelte';
  import Detail from './features/detail/Page.svelte';
  import Runner from './features/runner/Page.svelte';
  import Results from './features/results/Page.svelte';
  import Installs from './features/installs/Page.svelte';
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
  const Page = $derived(pages[$route.page]);
</script>
<nav aria-label="Main">
  {#each links as link}
    <button aria-current={$route.page === link.page ? 'page' : undefined}
      onclick={() => navigate(link)}>{t('nav.' + link.page)}</button>
  {/each}
  <label>{t("theme.label")} <select value={theme} onchange={changeTheme}>
    <option value="dark">{t("theme.dark")}</option><option value="light">{t("theme.light")}</option>
  </select></label>
</nav>
<main><Page /></main>
