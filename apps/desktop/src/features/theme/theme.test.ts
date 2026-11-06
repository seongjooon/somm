import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadTheme, saveTheme } from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('theme settings', () => {
  it('defaults to dark and accepts only a saved light value', () => {
    const getItem = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('invalid').mockReturnValueOnce('light');
    vi.stubGlobal('localStorage', { getItem });
    expect(loadTheme()).toBe('dark');
    expect(loadTheme()).toBe('dark');
    expect(loadTheme()).toBe('light');
  });
  it('applies and persists a selection', () => {
    const dataset: Record<string, string> = {};
    const setItem = vi.fn();
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', { setItem });
    saveTheme('light');
    expect(dataset.theme).toBe('light');
    expect(setItem).toHaveBeenCalledWith('somm.theme', 'light');
    applyTheme('dark');
    expect(dataset.theme).toBe('dark');
  });
  it('continues with a usable session when storage is unavailable', () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
    expect(loadTheme()).toBe('dark');
    expect(() => saveTheme('light')).not.toThrow();
    expect(dataset.theme).toBe('light');
  });
});
