import { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FolderOpen, Trash2, RefreshCw, Pin, Image, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { PaneHeader, Segmented, ghostButton } from './ui';
interface Entry {
  id: string;
  thumbnail: string;
  created_at: string;
  width: number;
  height: number;
  kind: 'screenshot' | 'recording';
  pinned: boolean;
}
export function CaptureHistoryTab({ active }: { active: boolean }) {
  const { lang } = useTranslation();
  const text = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [more, setMore] = useState(false);
  const entriesRef = useRef<Entry[]>([]);
  const loadVersion = useRef(0);
  const load = useCallback(async (append = false) => {
    const version = ++loadVersion.current;
    setBusy(true);
    setError('');
    try {
      const page = await invoke<Entry[]>('list_capture_history', {
        offset: append ? entriesRef.current.length : 0,
        limit: 60,
      });
      if (version !== loadVersion.current) return;
      const next = append ? [...entriesRef.current, ...page] : page;
      entriesRef.current = next;
      setEntries(next);
      setMore(page.length === 60);
    } catch (e) {
      if (version === loadVersion.current) setError(String(e));
    } finally {
      if (version === loadVersion.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const off = listen('clipboard-change', () => void load());
    return () => {
      void off.then((f) => f()).catch(() => undefined);
    };
  }, [active, load]);
  const visible = entries.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (!query || `${e.created_at} ${e.width}×${e.height}`.includes(query))
  );
  const open = (id: string) =>
    invoke('open_image_window', { id }).catch((e) => toast.error(String(e)));
  return (
    <div className="space-y-5" data-el="capture-history-settings">
      <PaneHeader
        title={text('截图历史', 'Capture history')}
        subtitle={text(
          '与剪贴板共用同一份历史。点击原图、再次编辑或贴图；清空不会删除其他剪贴板内容。',
          'Uses the same clipboard records. Open, edit or pin an image; clearing captures leaves other clipboard content intact.'
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: text('全部', 'All') },
            { value: 'screenshot', label: text('截图', 'Screenshots') },
            { value: 'recording', label: text('录屏', 'Recordings') },
          ]}
        />
        <button
          className={ghostButton}
          disabled={busy}
          onClick={() => void load()}
          aria-label={text('刷新截图历史', 'Refresh captures')}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-border bg-accent/20 px-3 py-2">
        <Search size={14} />
        <input
          aria-label={text('筛选截图日期或尺寸', 'Filter capture date or dimensions')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={text('按日期或尺寸筛选', 'Filter by date or dimensions')}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </label>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive"
        >
          {error}
          <button className="ml-3 underline" onClick={() => void load()}>
            {text('重试', 'Retry')}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3" data-el="capture-history-grid">
        {visible.map((e) =>
          e.kind === 'recording' ? (
            <article
              key={e.id}
              data-capture-id={e.id}
              className="overflow-hidden rounded-xl border border-border bg-card/40"
            >
              <img
                src={e.thumbnail}
                alt={text('录屏预览', 'Recording preview')}
                className="h-[112px] w-full object-contain"
              />
              <div className="space-y-2 p-2">
                <p className="text-[10px] text-muted-foreground">
                  {e.created_at.slice(5, 16)} · {e.width}×{e.height} · {text('录屏', 'Recording')}
                </p>
                <button
                  className="rounded border border-border px-2 py-1 text-xs"
                  onClick={() =>
                    void invoke('export_recording', { id: e.id }).catch((e) =>
                      toast.error(String(e))
                    )
                  }
                >
                  {text('导出视频 / GIF', 'Export video / GIF')}
                </button>
              </div>
            </article>
          ) : (
            <article
              key={e.id}
              data-capture-id={e.id}
              className="overflow-hidden rounded-xl border border-border bg-card/40"
            >
              <button
                className="block h-[112px] w-full bg-black/15 p-2"
                title={text('查看原图', 'Open original')}
                onClick={() => void open(e.id)}
              >
                <img
                  src={e.thumbnail}
                  alt={`${e.width}×${e.height}`}
                  className="h-full w-full object-contain"
                />
              </button>
              <div className="space-y-2 p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {e.created_at.slice(5, 16)} · {e.width}×{e.height}
                  {e.pinned && <Pin size={10} />}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    className="rounded border border-border px-1.5 py-1 text-[10px]"
                    onClick={() =>
                      void invoke('edit_clip_image', { id: e.id }).catch((x) =>
                        toast.error(String(x))
                      )
                    }
                  >
                    {text('编辑', 'Edit')}
                  </button>
                  <button
                    className="rounded border border-border px-1.5 py-1 text-[10px]"
                    onClick={() =>
                      void invoke('pin_clip_image', { id: e.id }).catch((x) =>
                        toast.error(String(x))
                      )
                    }
                  >
                    {text('贴图', 'Pin')}
                  </button>
                  <button
                    className="rounded border border-border px-1.5 py-1 text-[10px]"
                    onClick={() =>
                      void invoke('open_capture_in_viewer', { id: e.id }).catch((x) =>
                        toast.error(String(x))
                      )
                    }
                  >
                    {text('外部查看器', 'External viewer')}
                  </button>
                </div>
              </div>
            </article>
          )
        )}
      </div>
      {!busy && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-xs text-muted-foreground">
          <Image size={24} className="mx-auto mb-3 opacity-50" />
          {kind === 'recording'
            ? text('暂无录屏记录', 'No recordings yet')
            : text('没有符合条件的截图', 'No matching captures')}
        </div>
      )}
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {text('正在读取历史…', 'Loading history…')}
        </p>
      )}
      {more && (
        <button className={ghostButton} disabled={busy} onClick={() => void load(true)}>
          {text('加载更多', 'Load more')}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          className={ghostButton}
          disabled={busy}
          title={text(
            '将可见历史解密导出到图片文件夹后打开',
            'Export decrypted images to a folder and open it'
          )}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke('open_capture_history_directory');
            } catch (e) {
              toast.error(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FolderOpen size={14} />
          {text('导出并打开历史目录', 'Export and open folder')}
        </button>
        <button
          className={`${ghostButton} text-destructive`}
          disabled={busy || !entries.length}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={14} />
          {text('清空截图历史', 'Clear capture history')}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {text('已加载', 'Loaded')}: {entries.length}
        </span>
      </div>
      <ConfirmDialog
        isOpen={confirm}
        title={text('清空截图历史？', 'Clear capture history?')}
        message={text(
          '清理截图条目，保留已置顶图片；文字、文件等其他剪贴板记录不受影响。',
          'Remove capture records while keeping pinned images. Other clipboard text and files remain intact.'
        )}
        isBusy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await invoke('clear_capture_history', { includePinned: false });
            setConfirm(false);
            await load();
          } catch (e) {
            toast.error(String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
