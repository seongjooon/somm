<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children?: Snippet } = $props();
</script>
<span class="badge">{@render children?.()}</span>
<style>.badge { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: .125rem .5rem; background: var(--raised); color: var(--foreground); font-size: .75rem; line-height: 1.4; font-weight: 600; }</style>
