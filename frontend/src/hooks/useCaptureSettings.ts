import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Settings } from '../types';
import { capturePreferences } from '../utils/capturePreferences';
import { useTheme } from './useTheme';
import { useSystemTheme } from './useSystemTheme';
export function useCaptureSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<Settings>('get_settings')
      .then((s) => {
        if (active) setSettings(s);
      })
      .catch(console.error);
    const off = listen<Settings>('settings-changed', (e) => {
      if (active) setSettings(e.payload);
    });
    return () => {
      active = false;
      void off.then((f) => f()).catch(() => undefined);
    };
  }, []);
  const effectiveTheme = useTheme(settings?.theme ?? 'system');
  const systemTheme = useSystemTheme();
  return { settings, preferences: capturePreferences(settings), effectiveTheme, systemTheme };
}
