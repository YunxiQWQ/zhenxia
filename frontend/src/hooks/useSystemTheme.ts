import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
/** A WebView media query can follow an app override instead of the desktop. */
export function useSystemTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void invoke<'light' | 'dark'>('get_system_theme')
        .then((t) => {
          if (active && (t === 'light' || t === 'dark')) setTheme(t);
        })
        .catch(console.error);
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('zhenxia:capture-session', refresh);
    const off = listen<'light' | 'dark'>('system-theme-changed', (event) => {
      if (active) setTheme(event.payload);
    });
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('zhenxia:capture-session', refresh);
      void off.then((f) => f()).catch(() => undefined);
    };
  }, []);
  return theme;
}
