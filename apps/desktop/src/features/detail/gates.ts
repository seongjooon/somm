import type { SkillTraits } from '@somm/core';

export function testAllowed(traits: SkillTraits, dockerAvailable: boolean): boolean {
  return dockerAvailable || !(traits.hasScripts || traits.hasHooks || traits.hasMcp);
}
