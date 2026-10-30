import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { Pin, PinOff, Copy, Save, X, Pencil } from 'lucide-react';
import { useTranslation } from '../i18n';
import { useCaptureSettings } from '../hooks/useCaptureSettings';
import { shortcutAction } from '../utils/capturePreferences';

interface Payload {
  id: string;
  imageBase64: string;
  width: number;
  height: number;
}
export function PinWindow() {
  const { settings, preferences } = useCaptureSettings();
  const opacityInitialized = useRef(false);
  useEffect(() => {
    if (settings && !opacityInitialized.current) {
      setOpacity(preferences.pin_opacity / 100);
      opacityInitialized.current = true;
    }
  }, [settings, preferences.pin_opacity]);
  const { t } = useTranslation();
  const [image, setImage] = useState('');
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [opacity, setOpacity] = useState(1);
  const [top, setTop] = useState(true);
  const [error, setError] = useState('');
  const pinId = new URLSearchParams(location.search).get('pin');
  const close = () => getCurrentWindow().close().catch(console.error);
  useEffect(() => {
    if (!pinId) return;
    let active = true,
      url = '';
    invoke<Payload>('get_pin_payload', { pinId })
      .then((payload) => {
        if (!active) return;
        const bytes = Uint8Array.from(atob(payload.imageBase64), (char) => char.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        setImage(url);
        setDimensions({ width: payload.width, height: payload.height });
      })
      .catch((e) => setError(String(e)));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pinId]);
  const copy = async () => {
    try {
      await invoke('copy_pin_image', { pinId });
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async () => {
    try {
      await invoke('save_pin_image', { pinId });
    } catch (e) {
      if (!String(e).includes('cancel')) setError(String(e));
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void close();
      }
      const action = shortcutAction(e, preferences);
      if (action === 'copy') {
        e.preventDefault();
        void copy();
      }
      if (action === 'save') {
        e.preventDefault();
        void save();
      }
      if (action === 'edit') {
        e.preventDefault();
        void invoke('edit_pin_image', { pinId }).catch((e) => setError(String(e)));
      }
      if (action === 'toggle_top') {
        e.preventDefault();
        void getCurrentWindow()
          .setAlwaysOnTop(!top)
          .then(() => setTop(!top))
          .catch((e) => setError(String(e)));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const zoom = async (event: React.WheelEvent) => {
    event.preventDefault();
    if (event.shiftKey) {
      setOpacity((v) => Math.min(1, Math.max(0.15, v + (event.deltaY < 0 ? 0.05 : -0.05))));
      return;
    }
    const width = Math.max(
      100,
      Math.min(2400, window.innerWidth * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
    );
    if (dimensions.width)
      try {
        await getCurrentWindow().setSize(
          new LogicalSize(width, (width * dimensions.height) / dimensions.width)
        );
      } catch (e) {
        setError(String(e));
      }
  };
  return (
    <div
      className="pin-surface group"
      style={{ opacity, boxShadow: preferences.pin_border ? undefined : 'none' }}
      onWheel={(e) => void zoom(e)}
    >
      {image ? (
        <img
          src={image}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
          onMouseDown={(e) => {
            if (e.button === 0) void getCurrentWindow().startDragging();
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-background text-sm">
          {error || t('Loading pinned image…')}
        </div>
      )}
      <div className="pin-controls" onMouseDown={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          aria-label={t('Opacity')}
          className="w-16 accent-violet-400"
        />
        <span className="h-4 w-px bg-white/15" />
        <button
          title={top ? t('Unpin from top') : t('Always on top')}
          aria-label={top ? t('Unpin from top') : t('Always on top')}
          onClick={() => {
            void getCurrentWindow()
              .setAlwaysOnTop(!top)
              .then(() => setTop(!top))
              .catch((e) => setError(String(e)));
          }}
        >
          {top ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button title={t('Copy')} aria-label={t('Copy')} onClick={() => void copy()}>
          <Copy size={15} />
        </button>
        <button
          title={t('Edit image')}
          aria-label={t('Edit image')}
          onClick={() => {
            void invoke('edit_pin_image', { pinId }).catch((e) => setError(String(e)));
          }}
        >
          <Pencil size={15} />
        </button>
        <button title={t('Save as')} aria-label={t('Save as')} onClick={() => void save()}>
          <Save size={15} />
        </button>
        <button
          title={t('Close')}
          aria-label={t('Close')}
          onClick={() => void close()}
          className="hover:text-red-400"
        >
          <X size={17} />
        </button>
      </div>
      {error && image && (
        <button
          className="absolute bottom-2 left-2 right-2 rounded bg-red-950 p-2 text-xs text-white"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}
    </div>
  );
}
