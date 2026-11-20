import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Settings } from '../types';

export function useWindowSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unlisten = listen<Settings>('settings-changed', ({ payload }) => {
      if (!active) return;
      receivedUpdate = true;
      setSettings(payload);
    });
    void invoke<Settings>('get_settings')
      .then((snapshot) => {
        if (active && !receivedUpdate) setSettings(snapshot);
      })
      .catch(console.error);

    return () => {
      active = false;
      void unlisten.then((dispose) => dispose()).catch(() => undefined);
    };
  }, []);

  return settings;
}
