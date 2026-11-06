<script lang="ts">
  let { items, selected = $bindable(), label }: { items: { value: string; label: string; id: string; panelId: string }[]; selected: string; label: string } = $props();
  function keydown(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault(); selected = items[next].value;
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button')[next]?.focus();
  }
</script>
<div class="tabs" role="tablist" aria-label={label}>
  {#each items as item, index (item.value)}
    <button type="button" role="tab" id={item.id} aria-controls={item.panelId} aria-selected={selected === item.value} tabindex={selected === item.value ? 0 : -1} onclick={() => selected = item.value} onkeydown={(event) => keydown(event, index)}>{item.label}</button>
  {/each}
</div>
<style>.tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); } button { padding: .625rem .875rem; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; } button:hover { color: var(--foreground); } button[aria-selected="true"] { color: var(--foreground); border-bottom-color: var(--accent); font-weight: 600; }</style>
