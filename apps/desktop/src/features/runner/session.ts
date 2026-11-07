let apiKey: string | undefined;
export function setApiKey(value: string): void { apiKey = value || undefined; }
export function getApiKey(): string | undefined { return apiKey; }
export function clearApiKey(): void { apiKey = undefined; }
export function changeAuth(mode: 'subscription' | 'isolated'): void {
  if (mode !== 'isolated') clearApiKey();
}

export function resetKey(input?: { value: string }): void {
  clearApiKey();
  if (input) input.value = '';
}
