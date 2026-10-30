import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { flushSync } from 'react-dom';
import { CaptureOverlay } from './CaptureOverlay';

const loadHistoryWindow = () =>
  import('./HistoryWindow').then((module) => ({ default: module.HistoryWindow }));
const HistoryWindow = lazy(loadHistoryWindow);

// The clipboard and screenshot use the same native window and renderer.
// Keep clipboard drafts mounted, but pause their global keyboard handlers.
export default function SharedMainWindow() {
  const [capturing, setCapturing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [historyOpened, setHistoryOpened] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (historyOpened || capturing) return;
    let cancelled = false;
    // Prepare only the inactive shell. History data is still fetched on show.
    const timer = window.setTimeout(() => {
      void loadHistoryWindow()
        .then(() => {
          if (!cancelled) setHistoryOpened(true);
        })
        .catch(console.error);
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [historyOpened, capturing]);
  useLayoutEffect(() => {
    document.documentElement.dataset.captureMode = capturing ? 'true' : 'false';
    if (!capturing && previousFocus.current?.isConnected) previousFocus.current.focus();
  }, [capturing]);
  useEffect(() => {
    let disposed = false;
    const current = getCurrentWindow();
    const updateVisibility = async () => {
      const shown = await current.isVisible().catch(() => false);
      if (!disposed) {
        setVisible(shown);
        if (shown && document.documentElement.dataset.captureMode !== 'true')
          setHistoryOpened(true);
      }
    };
    void updateVisibility();
    const focus = current.onFocusChanged(() => void updateVisibility());
    const idle = listen('zhenxia:main-idle', () => setVisible(false));
    const shown = listen('zhenxia:main-visible', () => {
      setVisible(true);
      if (document.documentElement.dataset.captureMode !== 'true') setHistoryOpened(true);
    });
    return () => {
      disposed = true;
      for (const unlisten of [focus, idle, shown])
        unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    const start = () => {
      previousFocus.current = document.activeElement as HTMLElement | null;
      flushSync(() => setCapturing(true));
    };
    const reset = () => setCapturing(false);
    window.addEventListener('zhenxia:capture-session', start);
    window.addEventListener('zhenxia:capture-reset', reset);
    return () => {
      window.removeEventListener('zhenxia:capture-session', start);
      window.removeEventListener('zhenxia:capture-reset', reset);
    };
  }, []);
  return (
    <>
      <div
        inert={capturing}
        style={{ display: capturing ? 'none' : 'block', width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          {historyOpened && <HistoryWindow active={visible && !capturing} />}
        </Suspense>
      </div>
      <div style={{ display: capturing ? 'block' : 'none', width: '100%', height: '100%' }}>
        <CaptureOverlay />
      </div>
    </>
  );
}
