import ReactDOM from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { attachConsole } from '@tauri-apps/plugin-log';
import { LanguageProvider } from './i18n';
import './index.css';

if (import.meta.env.DEV)
  attachConsole()
    .then(() => console.log('[WinPaste] Tauri console attached successfully'))
    .catch((err) => console.error('[WinPaste] Failed to attach Tauri console:', err));

const urlParams = new URLSearchParams(window.location.search);
const windowType = urlParams.get('window');
const WindowRoot = lazy(async () => {
  if (windowType === 'workflow') {
    const { WorkflowWindow } = await import('./windows/WorkflowWindow');
    return { default: WorkflowWindow };
  }
  if (windowType === 'presentation') {
    const { PresentationWindow } = await import('./windows/PresentationWindow');
    return { default: PresentationWindow };
  }
  if (windowType === 'settings') {
    const { SettingsWindow } = await import('./windows/SettingsWindow');
    return { default: SettingsWindow };
  }
  if (windowType === 'translation') {
    const { TranslationWindow } = await import('./windows/TranslationWindow');
    return { default: TranslationWindow };
  }
  if (windowType === 'image') {
    const { ImageWindow } = await import('./windows/ImageWindow');
    return { default: ImageWindow };
  }
  if (windowType === 'screenshot') {
    const { CaptureOverlay } = await import('./windows/CaptureOverlay');
    return { default: CaptureOverlay };
  }
  if (windowType === 'pin') {
    const { PinWindow } = await import('./windows/PinWindow');
    return { default: PinWindow };
  }
  return import('./windows/SharedMainWindow');
});

const initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.documentElement.classList.add(initialTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <Suspense
      fallback={
        <div className="h-full w-full bg-background" role="status" aria-label="正在加载帧匣" />
      }
    >
      <WindowRoot />
    </Suspense>
  </LanguageProvider>
);
