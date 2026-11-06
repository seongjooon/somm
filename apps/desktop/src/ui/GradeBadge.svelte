<script lang="ts">
  let { grade, label }: { grade: 'A' | 'B' | 'C' | 'D' | 'F'; label: string } = $props();
</script>
<span class="grade" style:color="var(--grade-{grade.toLowerCase()})" aria-label={label}>{grade}</span>
<style>.grade { display: inline-flex; align-items: center; justify-content: center; min-width: 1.75rem; min-height: 1.75rem; border: 1px solid currentColor; border-radius: .375rem; font-weight: 700; font-size: .8125rem; }</style>
