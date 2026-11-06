<script lang="ts">
  import { route, navigate, type Route } from './lib/route';
  import { t } from './i18n/t';
  import Store from './features/store/Page.svelte';
  import Detail from './features/detail/Page.svelte';
  import Runner from './features/runner/Page.svelte';
  import Results from './features/results/Page.svelte';
  import Installs from './features/installs/Page.svelte';
  const pages = { store: Store, detail: Detail, runner: Runner, results: Results, installs: Installs };
  const links: Route[] = [{ page: 'store' }, { page: 'detail', skillId: '' },
    { page: 'runner', skillId: '' }, { page: 'results', runId: '' }, { page: 'installs' }];
  const Page = $derived(pages[$route.page]);
</script>
<nav aria-label="Main">
  {#each links as link}
    <button aria-current={$route.page === link.page ? 'page' : undefined}
      onclick={() => navigate(link)}>{t('nav.' + link.page)}</button>
  {/each}
</nav>
<main><Page /></main>
