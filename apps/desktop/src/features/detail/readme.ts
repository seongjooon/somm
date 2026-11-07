export function firstParagraph(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && (!lines[0].trim() || /^\s*#{1,6}(?:\s|$)/.test(lines[0]))) lines.shift();
  return lines.join('\n').split(/\n\s*\n/)[0].trim();
}
