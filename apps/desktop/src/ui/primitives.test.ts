import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Tabs from './Tabs.svelte';
import Spinner from './Spinner.svelte';

// The label is required so every caller supplies localized status text.
// @ts-expect-error Spinner requires a label.
const missingSpinnerLabel: Parameters<typeof render<typeof Spinner>>[1] = { props: {} };
void missingSpinnerLabel;

describe('UI primitives', () => {
  it('renders tabs as non-submitting buttons', () => {
    const { body } = render(Tabs, { props: { label: 'Sections', selected: 'a', items: [
      { value: 'a', label: 'First', id: 'tab-a', panelId: 'panel-a' },
      { value: 'b', label: 'Second', id: 'tab-b', panelId: 'panel-b' },
    ] } });
    const buttons = body.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => /\btype="button"/.test(button))).toBe(true);
  });

  it('renders the supplied localized spinner status', () => {
    const { body } = render(Spinner, { props: { label: '불러오는 중' } });
    expect(body).toContain('role="status"');
    expect(body).toContain('불러오는 중');
  });
});
