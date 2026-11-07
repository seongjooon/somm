import { describe, expect, it } from 'vitest';
import type { InstalledSkill } from '@somm/core';
import { groupInstalled, updateAvailable } from './helpers';

const item = (agent: InstalledSkill['agent'], scope: InstalledSkill['scope']): InstalledSkill => ({
  agent, scope, name: 'example', dir: '/example', enabled: true, hash: 'current', managedBySomm: true, isSymlink: false,
});

describe('installed skills', () => {
  it('groups skills by agent and scope including empty groups', () => {
    const claude = item('claude', 'global');
    const codex = item('codex', 'project');
    expect(groupInstalled([claude, codex])).toEqual({
      claude: { global: [claude], project: [] }, codex: { global: [], project: [codex] },
    });
  });
  it('compares the marker hash with the latest source hash', () => {
    expect(updateAvailable({ markerHash: 'old' }, 'new')).toBe(true);
    expect(updateAvailable({ markerHash: 'same' }, 'same')).toBe(false);
    expect(updateAvailable({ markerHash: undefined }, 'new')).toBe(false);
    expect(updateAvailable({ markerHash: 'old' }, undefined)).toBe(false);
  });
});
