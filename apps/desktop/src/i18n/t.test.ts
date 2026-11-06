import { afterEach, expect, test } from 'vitest';
import { t, setLocale } from './t';
afterEach(() => setLocale('en'));
test('translates common English keys', () => expect(t('nav.store')).toBe('Store'));
test('falls back from Korean to English', () => {
  setLocale('ko');
  expect(t('x.count', { n: 3 })).toBe('3 items');
});
test('returns unknown keys', () => expect(t('missing')).toBe('missing'));
test('interpolates parameters', () => expect(t('x.count', { n: 3 })).toBe('3 items'));
test('merges feature dictionaries through glob', () => expect(t('store.title')).toBe('Store'));
