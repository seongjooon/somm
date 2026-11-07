<script lang="ts">
  import { onMount } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { createTauriPlatform } from '../../platform';
  import { cachedGrades, previewGrades } from './grades';
  import GradeBadge from '../../ui/GradeBadge.svelte';
  import { availableViews, createSampleSource, dedupe, filterSkills, rank, searchSkills, type Filters, type Grade, type SkillMeta, type View } from '@somm/core';
  import { navigate } from '../../lib/route';
  import { t } from '../../i18n/t';
  import Card from '../../ui/Card.svelte';
  import Badge from '../../ui/Badge.svelte';
  import Spinner from '../../ui/Spinner.svelte';
  import Tabs from '../../ui/Tabs.svelte';

  let items: SkillMeta[] = $state([]);
  let grades: Record<string, Grade> = $state({});
  let loading = $state(true), error = $state(false), query = $state('');
  let view = $state('all-time');
  let category = $state(''), agent = $state(''), source = $state(''), license = $state(''), minGrade = $state('');
  let search: HTMLInputElement;
  const today = new Date().toISOString().slice(0, 10);
  let views = $derived(availableViews(items, today));
  let tabs = $derived(views.map(value => ({ value, label: t('store.view.' + value), id: 'tab-' + value, panelId: 'panel-' + value })));
  let visible = $derived(searchSkills(filterSkills(rank(items, view as View, today), { category, agent, source, license, minGrade } as Filters, grades), query));
  const values = (list: (string | undefined)[]) => [...new Set(list.filter((v): v is string => !!v))].sort();
  async function load() {
    loading = true; error = false;
    try {
      items = dedupe(await createSampleSource().fetchIndex());
      if (import.meta.env.DEV && !isTauri()) grades = { ...previewGrades };
      else {
        const platform = await createTauriPlatform();
        grades = cachedGrades(await platform.db.select<{ skill_id: string; report_json: string }>('SELECT skill_id, report_json FROM scan_cache'));
      }
    } catch { error = true; }
    finally { loading = false; }
  }
  onMount(() => { void load(); });
  function shortcut(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search?.focus(); }
  }
</script>
<svelte:window onkeydown={shortcut} />
<section class="store">
  <header><div><p class="eyebrow">{t('store.eyebrow')}</p><h1>{t('store.title')}</h1><p class="muted">{t('store.intro')}</p></div></header>
  <label class="search"><span>{t('store.search')}</span><input bind:this={search} bind:value={query} placeholder={t('store.searchPlaceholder')} aria-label={t('store.search')} /><kbd>⌘ K</kbd></label>
  {#if loading}<Spinner label={t('store.loading')} /> <span>{t('store.loading')}</span>
  {:else if error}<p role="alert">{t('store.error')}</p><button type="button" onclick={load}>{t('store.retry')}</button>
  {:else}
    <Tabs items={tabs} bind:selected={view} label={t('store.views')} />
    <div class="filters">
      <label>{t('store.category')}<select bind:value={category}><option value="">{t('store.all')}</option>{#each values(items.map(i => i.category)) as v}<option value={v}>{v}</option>{/each}</select></label>
      <label>{t('store.agent')}<select bind:value={agent}><option value="">{t('store.all')}</option>{#each values(items.flatMap(i => i.agents)) as v}<option value={v}>{v}</option>{/each}</select></label>
      <label>{t('store.source')}<select bind:value={source}><option value="">{t('store.all')}</option>{#each values(items.map(i => i.source)) as v}<option value={v}>{v}</option>{/each}</select></label>
      <label>{t('store.license')}<select bind:value={license}><option value="">{t('store.all')}</option>{#each values(items.map(i => i.license)) as v}<option value={v}>{v}</option>{/each}</select></label>
      <label>{t('store.minGrade')}<select bind:value={minGrade}><option value="">{t('store.all')}</option>{#each ['A','B','C','D','F'] as v}<option value={v}>{v}</option>{/each}</select></label>
    </div>
    {#each views as v}<div role="tabpanel" id={'panel-' + v} aria-labelledby={'tab-' + v} hidden={view !== v}>
      {#if v === view}{#if visible.length}<div class="grid">{#each visible as item (item.id)}<Card><button type="button" class="skill" aria-label={t('store.open', { name: item.name })} onclick={() => navigate({ page: 'detail', skillId: item.id })}>
        <div class="row"><strong>{item.name}</strong>{#if grades[item.id]}<GradeBadge grade={grades[item.id]} label={t('detail.gradeLabel', { grade: grades[item.id] })} />{:else}<span aria-label={t('store.unknownGrade')}>—</span>{/if}</div><p>{item.description}</p><div class="badges"><Badge>{item.source}</Badge>{#each item.agents as a}<Badge>{a}</Badge>{/each}</div><div class="stats">{#if item.stars !== undefined}<span>★ {item.stars}</span>{/if}{#if item.installs !== undefined}<span>↓ {item.installs}</span>{/if}</div>
      </button></Card>{/each}</div>{:else}<p>{t('store.empty')}</p>{/if}{/if}
    </div>{/each}
  {/if}
</section>
<style>
  .store { max-width: 1200px; margin: auto; } h1 { font-size: 2rem; margin: .25rem 0; } .eyebrow { color: var(--focus); text-transform: uppercase; letter-spacing: .12em; font-size: .75rem; font-weight: 700; } .muted, p, .stats { color: var(--muted); } .search { display: flex; align-items: center; gap: 1rem; margin: 2rem 0 1rem; padding: .5rem 1rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); } .search span { position: absolute; clip-path: inset(50%); } input { flex: 1; background: transparent; border: 0; color: var(--foreground); padding: .5rem 0; font: inherit; } kbd { color: var(--muted); } .filters { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0; } .filters label { display: grid; gap: .35rem; color: var(--muted); font-size: .75rem; } select { min-width: 8rem; padding: .5rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); color: var(--foreground); } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; } .skill { display: flex; flex-direction: column; width: 100%; height: 100%; text-align: left; color: var(--foreground); border: 0; background: transparent; font: inherit; } .skill p { flex: 1; line-height: 1.5; } .row { display: flex; justify-content: space-between; width: 100%; gap: 1rem; } .badges, .stats { display: flex; gap: .5rem; flex-wrap: wrap; } .stats { margin-top: 1rem; font-size: .8rem; }
</style>
