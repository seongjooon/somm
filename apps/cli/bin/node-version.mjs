export function nodeSupported(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
}
