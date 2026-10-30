import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useState } from 'react';
import type { Settings } from '../types';
import { useCaptureSettings } from '../hooks/useCaptureSettings';
import { useSystemAccent } from '../hooks/useSystemAccent';
import { TranslationPane } from '../components/settings/TranslationPane';
import { windowMaterial } from '../utils/windowMaterial';
import { useTranslation } from '../i18n';
export function TranslationWindow() {
  const { settings, effectiveTheme } = useCaptureSettings();
  const [override, setOverride] = useState<Settings | null>(null);
  useSystemAccent();
  const { lang } = useTranslation();
  const current = override ?? settings;
  if (!current)
    return (
      <div role="status" className="p-8">
        {lang === 'zh-CN' ? '正在加载…' : 'Loading…'}
      </div>
    );
  return (
    <div
      className="window-surface flex h-screen flex-col text-foreground"
      data-window-material={windowMaterial(current.mica_effect)}
    >
      <header
        className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as Element).closest('button'))
            void getCurrentWindow().startDragging();
        }}
      >
        <span className="text-sm font-medium">
          {lang === 'zh-CN' ? '帧匣 · 离线翻译' : 'Zhenxia · Offline translation'}
        </span>
        <button aria-label="Close" onClick={() => void getCurrentWindow().close()}>
          <X size={17} />
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <TranslationPane
          settings={current}
          updateSetting={(key, value) => {
            const next = { ...current, [key]: value };
            void invoke('save_settings', { settings: next, changedKeys: [key] })
              .then(async () => {
                setOverride(next);
                await emit('settings-changed', next);
              })
              .catch((e) => toast.error(String(e)));
          }}
        />
      </main>
      <Toaster theme={effectiveTheme} />
    </div>
  );
}
