<script lang="ts">
  import type { Snippet } from 'svelte';
  let { open = $bindable(false), title, closeLabel, children }: { open?: boolean; title: string; closeLabel: string; children?: Snippet } = $props();
  let dialog: HTMLDialogElement;
  $effect(() => { if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); });
</script>
<dialog bind:this={dialog} onclose={() => open = false} aria-label={title}>
  <header><h2>{title}</h2><button type="button" aria-label={closeLabel} onclick={() => open = false}>×</button></header>
  {@render children?.()}
</dialog>
<style>dialog { width: min(32rem, calc(100% - 2rem)); padding: 1.5rem; background: var(--surface); color: var(--foreground); border: 1px solid var(--border); border-radius: .75rem; box-shadow: 0 16px 48px #0006; } dialog::backdrop { background: #0009; } header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; } h2 { margin: 0; font-size: 1.125rem; } button { width: 2rem; height: 2rem; border: 0; border-radius: .375rem; background: transparent; color: var(--foreground); font-size: 1.5rem; } button:hover { background: var(--raised); }</style>
