<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children?: Snippet } = $props();
</script>
<div class="card">{@render children?.()}</div>
<style>.card { background: var(--surface); border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; }</style>
