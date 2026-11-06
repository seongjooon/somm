import en from './en.json';
import ko from './ko.json';
type Dictionary = Record<string, string>;
const dictionaries: Record<'en' | 'ko', Dictionary> = { en: { ...en }, ko: { ...ko } };
const features = import.meta.glob<Dictionary>('../features/*/i18n.{en,ko}.json', { eager: true, import: 'default' });
for (const [path, entries] of Object.entries(features)) {
  const lang = path.endsWith('.ko.json') ? 'ko' : 'en';
  Object.assign(dictionaries[lang], entries);
}
let locale: 'en' | 'ko' = 'en';
export function setLocale(next: 'en' | 'ko'): void { locale = next; }
export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
