export type Theme = 'dark' | 'light';
const key = 'somm.theme';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function loadTheme(): Theme {
  try { return localStorage.getItem(key) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try { localStorage.setItem(key, theme); } catch { /* The current session still uses the selected theme. */ }
}
