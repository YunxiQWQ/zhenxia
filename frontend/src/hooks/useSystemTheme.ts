import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ColorTheme = 'light' | 'dark';

const mediaQuery = '(prefers-color-scheme: dark)';
const subscribers = new Set<() => void>();
let currentTheme: ColorTheme | null = null;
let stopWatching: (() => void) | undefined;

function browserTheme() {
  return matchMedia(mediaQuery).matches ? 'dark' : 'light';
}

function publish(theme: ColorTheme) {
  currentTheme = theme;
  subscribers.forEach((subscriber) => subscriber());
}

function watchSystemTheme() {
  let active = true;
  let revision = 0;
  const refresh = async () => {
    const request = ++revision;
    try {
      const theme = await invoke<ColorTheme>('get_system_theme');
      if (active && revision === request && (theme === 'dark' || theme === 'light')) {
        publish(theme);
      }
    } catch {
      if (active && revision === request && currentTheme === null) publish(browserTheme());
    }
  };

  const media = matchMedia(mediaQuery);
  const unlisten = listen<ColorTheme>('system-theme-changed', ({ payload }) => {
    if (!active || (payload !== 'dark' && payload !== 'light')) return;
    ++revision;
    publish(payload);
  });
  // The WebView's own scheme can inherit an explicit app override. Treat it
  // as a signal to query Windows rather than trusting its reported value.
  media.addEventListener('change', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('zhenxia:capture-session', refresh);
  void refresh();

  return () => {
    active = false;
    media.removeEventListener('change', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('zhenxia:capture-session', refresh);
    void unlisten.then((dispose) => dispose()).catch(() => undefined);
  };
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  stopWatching ??= watchSystemTheme();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
      currentTheme = null;
    }
  };
}

const skipSubscribe = () => () => {};
const getSnapshot = () => currentTheme ?? browserTheme();

export function useSystemTheme(enabled = true): ColorTheme {
  return useSyncExternalStore(enabled ? subscribe : skipSubscribe, getSnapshot);
}
