import type { Contamination, Inventory } from '../types';

export function contamination(a: Inventory, b: Inventory, target: string, residue: string[]): Contamination {
  const sortedResidue = [...new Set(residue)].sort();
  const aSet = new Set(a.skills), bSet = new Set(b.skills);
  const extras = [...new Set([
    ...b.skills.filter(s => !aSet.has(s) && s !== target),
    ...a.skills.filter(s => !bSet.has(s)),
  ])].sort();
  const targetInResidue = sortedResidue.includes(target);
  const bad = aSet.has(target) || !bSet.has(target) || extras.length > 0 || targetInResidue;
  return {
    status: bad ? 'contaminated' : 'clean',
    common: [...aSet].filter(s => bSet.has(s)).sort(),
    extras, residue: sortedResidue, targetInResidue,
  };
}
