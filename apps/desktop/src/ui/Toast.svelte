<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, urgent = false }: { children?: Snippet; urgent?: boolean } = $props();
</script>
<div class="toast" role={urgent ? 'alert' : 'status'}>{@render children?.()}</div>
<style>.toast { padding: .75rem 1rem; background: var(--surface); color: var(--foreground); border: 1px solid var(--border); border-radius: .5rem; box-shadow: 0 8px 24px #0003; }</style>
