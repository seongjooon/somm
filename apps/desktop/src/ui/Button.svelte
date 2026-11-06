<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { children, variant = 'primary', class: className = '', type = 'button', ...rest }: HTMLButtonAttributes & {
    children?: Snippet; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  } = $props();
</script>
<button {type} class="button {variant} {className}" {...rest}>{@render children?.()}</button>
<style>
  .button { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.5rem; padding: .5rem 1rem; border: 1px solid transparent; border-radius: .5rem; font: inherit; font-weight: 600; transition: background 150ms, border-color 150ms; }
  .primary, .danger { background: var(--accent); color: white; }
  .secondary { background: var(--raised); border-color: var(--border); color: var(--foreground); }
  .ghost { background: transparent; color: var(--foreground); }
  .button:not(:disabled):hover { filter: brightness(1.15); }
  .ghost:not(:disabled):hover { background: var(--raised); }
  .button:disabled { opacity: .5; cursor: not-allowed; }
</style>
