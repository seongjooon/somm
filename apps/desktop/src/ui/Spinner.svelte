<script lang="ts">
  let { label }: { label: string } = $props();
</script>
<span class="spinner" role="status"><span class="sr-only">{label}</span></span>
<style>.spinner { display: inline-block; width: 1rem; height: 1rem; border: 2px solid var(--border); border-top-color: var(--foreground); border-radius: 50%; animation: spin .8s linear infinite; } .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; } @keyframes spin { to { transform: rotate(360deg); } }</style>
