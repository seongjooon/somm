<script lang="ts">
  let { verdict }: { verdict: 'recommend' | 'conditional' | 'corked' } = $props();
  const labels = { recommend: '// somm: pairs well', conditional: '// somm: needs to breathe', corked: '// somm: corked' };
</script>
<span class="tag {verdict}">{labels[verdict]}</span>
<style>.tag { font-family: var(--font-mono); font-size: .8125rem; font-weight: 600; } .recommend { color: var(--grade-a); } .conditional { color: var(--grade-c); } .corked { color: var(--grade-f); }</style>
