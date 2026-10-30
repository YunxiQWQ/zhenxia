import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Square, Pause, Play, Camera, GripHorizontal } from 'lucide-react';
import { useTranslation } from '../i18n';
interface Status {
  kind: string;
  width?: number;
  height?: number;
  frames?: number;
  preview?: string;
  auto?: boolean;
  canUndo?: boolean;
  message?: string;
  started?: boolean;
  paused?: boolean;
  done?: boolean;
  elapsed?: number;
}
export function WorkflowWindow() {
  const { lang } = useTranslation(),
    t = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  const [status, setStatus] = useState<Status>({ kind: 'none' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [format, setFormat] = useState('mp4'),
    [fps, setFps] = useState(12);
  useEffect(()=>{void invoke('workflow_ready').catch(e=>setError(String(e)))},[]);
  useEffect(() => {
    let alive = true,
      pending = false;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try {
        const s = await invoke<Status>('workflow_status');
        if (alive) setStatus(s);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        pending = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 600);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (command: string, args?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await invoke(command, args);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background/95 p-3 text-foreground"
      data-el="workflow-controls"
    >
      <header
        className="mb-3 flex cursor-move items-center justify-between border-b border-border pb-2"
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest('button')) void getCurrentWindow().startDragging();
        }}
      >
        <strong className="flex items-center gap-2 text-sm">
          <GripHorizontal size={16} />
          {status.kind === 'scroll'
            ? t('长截图', 'Scrolling capture')
            : t('录屏', 'Screen recording')}
        </strong>
        <button
          aria-label={t('取消', 'Cancel')}
          disabled={busy}
          onClick={() => void run('cancel_workflow')}
        >
          <X size={17} />
        </button>
      </header>
      <p className="mb-2 text-xs text-muted-foreground">
        {status.width} × {status.height} ·{' '}
        {status.kind === 'scroll'
          ? `${status.frames ?? 0} ${t('张', 'frames')}`
          : `${((status.elapsed ?? 0) / 1000).toFixed(1)} s`}
      </p>
      {status.kind === 'scroll' ? (
        <>
          <p className="mb-2 text-xs">
            {t(
              '在原页面向下滚动，自动捕获并拼接。每次保留至少一半重叠。',
              'Scroll down in the source app. Keep at least half of each frame overlapping.'
            )}
          </p>
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden rounded-lg bg-black/10">
            {status.preview && (
              <img
                className="h-full max-w-full object-contain"
                src={status.preview}
                alt={t('拼接预览', 'Stitched preview')}
              />
            )}
          </div>
          <label className="my-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={status.auto ?? false}
              onChange={(e) => void run('set_scroll_auto', { enabled: e.target.checked })}
            />
            {t('自动采集', 'Capture automatically')}
          </label>
          <button
            className="self-start text-xs underline disabled:opacity-40"
            disabled={busy || !status.canUndo}
            onClick={() => void run('undo_scroll')}
          >
            {t('撤销上一张并暂停采集', 'Undo last frame and pause')}
          </button>
          <p className="mb-2 min-h-8 text-[11px] text-muted-foreground">{status.message}</p>
          <div className="flex gap-2">
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border p-2 text-xs"
              disabled={busy}
              onClick={() => void run('sample_scroll')}
            >
              <Camera size={14} />
              {t('捕获一张', 'Capture frame')}
            </button>
            <button
              className="flex-1 rounded-lg bg-primary p-2 text-xs text-primary-foreground"
              disabled={busy}
              onClick={() => void run('finish_scroll')}
            >
              {busy ? t('处理中…', 'Processing…') : t('完成并编辑', 'Finish and edit')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            {t(
              '录制所选区域的屏幕画面，不录制音频。控制窗口不会进入画面。',
              'Records the selected screen region without audio. This panel is excluded.'
            )}
          </p>
          {!status.started ? (
            <>
              <label className="mb-3 flex items-center justify-between text-sm">
                {t('格式', 'Format')}
                <select
                  className="rounded border border-border bg-background p-2"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option>mp4</option>
                  <option>gif</option>
                </select>
              </label>
              <label className="mb-3 flex items-center justify-between text-sm">
                {t('帧率', 'Frame rate')}
                <select
                  className="rounded border border-border bg-background p-2"
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                >
                  {[5, 8, 12, 15, 24, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} FPS
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="mt-4 rounded-lg bg-primary p-3 text-sm text-primary-foreground"
                disabled={busy}
                onClick={() => void run('begin_recording', { format, fps })}
              >
                {t('开始录制', 'Start recording')}
              </button>
            </>
          ) : (
            <>
              <div className="my-5 flex items-center justify-center gap-3 text-lg">
                <span
                  className={`h-3 w-3 rounded-full ${status.paused ? 'bg-amber-400' : 'bg-red-500'}`}
                />
                {status.done
                  ? t('录制已结束', 'Recording ended')
                  : status.paused
                    ? t('已暂停', 'Paused')
                    : t('正在录制', 'Recording')}
              </div>
              <div className="flex gap-2">
                <button
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border p-3 text-xs"
                  disabled={busy || status.done}
                  onClick={() => void run('pause_recording', { paused: !status.paused })}
                >
                  {status.paused ? <Play size={16} /> : <Pause size={16} />}
                  {status.paused ? t('继续', 'Resume') : t('暂停', 'Pause')}
                </button>
                <button
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary p-3 text-xs text-primary-foreground"
                  disabled={busy}
                  onClick={() => void run('finish_recording')}
                >
                  <Square size={14} />
                  {busy ? t('正在保存…', 'Saving…') : t('停止并保存', 'Stop and save')}
                </button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {t(
                  '完成后进入截图历史的“录屏”分类，可导出文件。单次最多30分钟或512 MB。',
                  'Saved recordings appear in capture history for export. Limit: 30 minutes or 512 MB.'
                )}
              </p>
            </>
          )}
        </>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 max-h-20 overflow-auto break-words rounded border border-destructive/40 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </main>
  );
}
