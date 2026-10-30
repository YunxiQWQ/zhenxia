import { useEffect, useRef, useState, useId } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { eventShortcut } from '../../utils/capturePreferences';
let activeRecorder: { id: string; stop: (next?: string) => Promise<void> } | null = null;
let recorderQueue: Promise<void> = Promise.resolve();
function serializeRecorder(action: () => Promise<void>) {
  const next = recorderQueue.catch(() => undefined).then(action);
  recorderQueue = next.catch(() => undefined);
  return next;
}
export function ShortcutInput({
  value,
  defaultValue,
  label,
  onChange,
  enabled = true,
}: {
  value: string;
  defaultValue: string;
  label: string;
  onChange: (value: string) => void;
  enabled?: boolean;
}) {
  const { lang } = useTranslation();
  const id = useId();
  const zh = lang === 'zh-CN';
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const live = useRef(false);
  const mounted = useRef(true);
  const allowed = useRef(enabled);
  const request = useRef(0);
  const change = useRef(onChange);
  allowed.current = enabled;
  change.current = onChange;
  const stopNow = async (next?: string) => {
    if (activeRecorder?.id === id) activeRecorder = null;
    if (!live.current) {
      if (mounted.current) setRecording(false);
      return;
    }
    live.current = false;
    if (mounted.current) setRecording(false);
    try {
      await invoke('set_shortcut_recording', { active: false });
      if (next !== undefined && mounted.current && allowed.current) change.current(next);
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  };
  const end = (next?: string) => {
    request.current++;
    return serializeRecorder(() => stopNow(next));
  };
  const stop = useRef(end);
  stop.current = end;
  useEffect(() => {
    if (!enabled) void stop.current();
  }, [enabled]);
  useEffect(() => {
    if (!recording) return;
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') {
        void end();
        return;
      }
      const shortcut = eventShortcut(event);
      if (shortcut) {
        setPending(shortcut);
        void end(shortcut);
      } else
        setPending(
          [
            event.ctrlKey ? 'Ctrl' : '',
            event.altKey ? 'Alt' : '',
            event.shiftKey ? 'Shift' : '',
            event.metaKey ? 'Win' : '',
          ]
            .filter(Boolean)
            .join('+')
        );
    };
    window.addEventListener('keydown', key, true);
    const off = listen('shortcut-recording-ended', () => {
      if (activeRecorder?.id === id) activeRecorder = null;
      live.current = false;
      setRecording(false);
    });
    return () => {
      window.removeEventListener('keydown', key, true);
      void off.then((f) => f()).catch(() => undefined);
    };
  });
  useEffect(() => {
    mounted.current = true;
    const blur = () => void stop.current();
    window.addEventListener('blur', blur);
    return () => {
      mounted.current = false;
      window.removeEventListener('blur', blur);
      if (activeRecorder?.id === id) activeRecorder = null;
      void stop.current();
    };
  }, [id]);
  return (
    <div className="w-full max-w-[240px] text-right">
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          data-keybind={label}
          aria-label={`${label} ${zh ? '快捷键' : 'shortcut'}`}
          aria-pressed={recording}
          disabled={!enabled || starting}
          className={`w-32 min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs [overflow-wrap:anywhere] ${recording ? 'border-primary bg-primary/10' : 'border-border bg-accent/30'}`}
          onClick={async () => {
            if (recording) {
              await end();
              return;
            }
            setError('');
            setPending('');
            setStarting(true);
            const serial = ++request.current;
            try {
              await serializeRecorder(async () => {
                const valid = () =>
                  mounted.current && allowed.current && request.current === serial;
                if (!valid()) return;
                if (activeRecorder) await activeRecorder.stop();
                if (!valid()) return;
                await invoke('set_shortcut_recording', { active: true });
                if (!valid()) {
                  await invoke('set_shortcut_recording', { active: false });
                  return;
                }
                live.current = true;
                activeRecorder = { id, stop: stopNow };
                setRecording(true);
              });
            } catch (e) {
              if (mounted.current) setError(String(e));
            } finally {
              if (mounted.current) setStarting(false);
            }
          }}
        >
          {recording
            ? pending || (zh ? '请按快捷键，Esc 取消' : 'Press keys; Esc cancels')
            : value || (zh ? '未绑定' : 'Unbound')}
        </button>
        <button
          type="button"
          aria-label={`${label} ${zh ? '清除' : 'clear'}`}
          title={zh ? '清除绑定' : 'Clear binding'}
          disabled={!enabled || starting || recording || !value}
          className="rounded p-1.5 text-muted-foreground disabled:opacity-30"
          onClick={() => onChange('')}
        >
          <X size={13} />
        </button>
        <button
          type="button"
          aria-label={`${label} ${zh ? '恢复默认' : 'reset'}`}
          title={zh ? '恢复默认' : 'Reset'}
          disabled={!enabled || starting || recording || value === defaultValue}
          className="rounded p-1.5 text-muted-foreground disabled:opacity-30"
          onClick={() => onChange(defaultValue)}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
