// Bounded shell subset: direct assignments, $(cat secret), and curl data arguments.
// No aliases, expansion chains, control flow, pipelines, or general dataflow analysis.
export function secretPostLines(lines: string[]): number[] {
  const hits = new Set<number>();
  for (let start = 0; start < lines.length; start++) {
    const read = /^\s*(?:export\s+)?([A-Za-z_]\w*)="?\$\(cat\s+([^()]+)\)"?\s*$/.exec(lines[start]);
    if (!read || !/(?:\.ssh\b|\.env\b|id_rsa|id_ed25519)/.test(read[2])) continue;
    const urls = new Set<string>();
    for (let i = Math.max(0, start - 3); i <= Math.min(lines.length - 1, start + 3); i++) {
      const line = lines[i];
      const assignment = /^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(line);
      if (assignment) {
        urls.delete(assignment[1]);
        if (/^["']?https?:\/\/[^\s"']+["']?\s*$/.test(assignment[2])) urls.add(assignment[1]);
        if (i > start && assignment[1] === read[1]) break;
        continue;
      }
      if (i <= start || !/^\s*curl\s/.test(line) || /[;|&`]/.test(line)) continue;
      const tokens = line.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? [];
      const unquote = (token: string) => token.replace(/^(["'])(.*)\1$/, '$2');
      const reference = (token: string, name: string) => !token.startsWith("'")
        && [ `$${name}`, `\${${name}}` ].includes(unquote(token));
      const data = tokens.findIndex(token => ['-d', '--data', '--data-binary', '--data-raw'].includes(token));
      if (data < 0 || !tokens[data + 1] || !reference(tokens[data + 1], read[1])) continue;
      const endpoint = tokens.some(token => /^https?:\/\//.test(unquote(token))
        || [...urls].some(name => reference(token, name)));
      if (endpoint) hits.add(start + 1);
    }
  }
  return [...hits];
}
