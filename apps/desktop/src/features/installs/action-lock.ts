export function createActionLock(onChange: (busy: boolean) => void) {
  let busy = false;
  return {
    async run(action: () => Promise<void>): Promise<void> {
      if (busy) return;
      busy = true; onChange(true);
      try { await action(); } finally { busy = false; onChange(false); }
    },
  };
}
