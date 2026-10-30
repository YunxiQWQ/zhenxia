import { useSyncExternalStore, type ReactNode } from 'react';
import { zhCN } from './zh-CN';
import { en } from './en';
export type LanguageCode = 'zh-CN' | 'en';
export interface LanguagePack {
  code: LanguageCode;
  name: string;
  strings: Record<string, string>;
}
export const LANGUAGES: LanguagePack[] = [
  { code: 'zh-CN', name: '简体中文', strings: zhCN },
  { code: 'en', name: 'English', strings: en },
];
const STORAGE_KEY = 'zhenxia_lang';
const EVENT = 'zhenxia:language-changed';
const subscribers = new Set<() => void>();
const valid = (value: unknown): value is LanguageCode => value === 'zh-CN' || value === 'en';
function readLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (valid(stored)) return stored;
  } catch {
    /* unavailable storage */
  }
  return 'zh-CN';
}
let current = readLanguage();
let listenersStarted = false;
function applyLanguage(code: LanguageCode, broadcast = false) {
  if (!valid(code)) return;
  const changed = code !== current;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* memory-only */
  }
  document.documentElement.lang = code;
  if ('__TAURI_INTERNALS__' in window)
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_interface_language', { language: code }))
      .catch(console.error);
  if (changed) subscribers.forEach((notify) => notify());
  if (broadcast && changed && '__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/event').then(({ emit }) => emit(EVENT, code)).catch(console.error);
  }
}
function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (!listenersStarted) {
    listenersStarted = true;
    applyLanguage(readLanguage());
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY && valid(event.newValue)) applyLanguage(event.newValue);
    });
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event')
        .then(({ listen }) =>
          listen<string>(EVENT, ({ payload }) => {
            if (valid(payload)) applyLanguage(payload);
          })
        )
        .catch(console.error);
    }
  }
  return () => {
    subscribers.delete(notify);
  };
}
export function useUiLanguage() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'zh-CN' as LanguageCode
  );
}
export function setGlobalLang(code: LanguageCode) {
  applyLanguage(code, true);
}
export function tGlobal(key: string): string {
  return (current === 'zh-CN' ? zhCN[key] : en[key]) ?? key;
}
export function useTranslation() {
  const lang = useUiLanguage();
  return { lang, setLang: setGlobalLang, t: tGlobal };
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  useUiLanguage();
  return <>{children}</>;
}
document.documentElement.lang = current;
export { zhCN, en };
