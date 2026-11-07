export function tokenHistory(rows: { metrics_json: string }[]): number[] {
  return rows.flatMap(row => {
    try {
      const m = JSON.parse(row.metrics_json);
      return typeof m.tokensIn === 'number' && Number.isFinite(m.tokensIn) && m.tokensIn >= 0 && typeof m.tokensOut === 'number' && Number.isFinite(m.tokensOut) && m.tokensOut >= 0 ? [m.tokensIn + m.tokensOut] : [];
    } catch { return []; }
  });
}
