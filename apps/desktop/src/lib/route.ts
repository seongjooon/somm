import { writable } from 'svelte/store';
export type Route =
  | { page: 'store' } | { page: 'detail'; skillId: string }
  | { page: 'runner'; skillId: string } | { page: 'results'; runId: string }
  | { page: 'installs'; installSkillId?: string };
export const route = writable<Route>({ page: 'store' });
export function navigate(next: Route): void { route.set(next); }
