export function latestRequest() {
  let token = 0;
  return {
    start() { const current = ++token; return () => token === current; },
    cancel() { token++; },
  };
}
