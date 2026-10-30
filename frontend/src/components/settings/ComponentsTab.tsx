import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Download, Trash2, FolderOpen, Check, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings } from '../../types';
import type { UpdateSetting } from './types';
import { capturePreferences } from '../../utils/capturePreferences';
import { useTranslation } from '../../i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { PaneHeader, Row, SettingCard, Segmented, ghostButton } from './ui';
interface ComponentStatus {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: string;
  installed: boolean;
  bytes: number;
  busy: boolean;
}
interface Progress {
  id: string;
  stage: string;
  received: number;
  total: number;
  step: number;
  steps: number;
}
export function ComponentsTab({
  settings,
  updateSetting,
  active,
}: {
  settings: Settings;
  updateSetting: UpdateSetting;
  active: boolean;
}) {
  const { lang } = useTranslation();
  const text = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  const componentName = (item: ComponentStatus) => {
    if (lang === 'zh-CN') return item.name;
    const names: Record<string, string> = {
      'ocr-tiny': 'PP-OCRv6 Tiny',
      'ocr-small': 'PP-OCRv6 Small',
      'translate-zh-en': 'Chinese ↔ English',
      'translate-zh-Hant': 'Traditional Chinese ↔ English',
      'translate-ja': 'Japanese ↔ English',
      'translate-ko': 'Korean ↔ English',
      'translate-ru': 'Russian ↔ English',
      'translate-fr': 'French ↔ English',
      'translate-es': 'Spanish ↔ English',
      'translate-de': 'German ↔ English',
    };
    return names[item.id] ?? item.name;
  };
  const p = capturePreferences(settings);
  const [items, setItems] = useState<ComponentStatus[]>([]);
  const [variant, setVariant] = useState('tiny');
  const [pack, setPack] = useState('translate-zh-en');
  const [installing, setInstalling] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<ComponentStatus | null>(null);
  const refresh = async () => {
    try {
      setItems(await invoke<ComponentStatus[]>('component_status'));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!active) return;
    void refresh();
    const off = listen<Progress>('component-progress', (e) => setProgress(e.payload));
    const changed = listen('component-changed', () => {
      setProgress(null);
      void refresh();
    });
    return () => {
      void off.then((f) => f()).catch(() => undefined);
      void changed.then((f) => f()).catch(() => undefined);
    };
  }, [active]);
  const install = async (id: string) => {
    setInstalling(id);
    setProgress(null);
    setError('');
    try {
      await invoke('install_component', { id });
      toast.success(text('组件安装完成', 'Component installed'));
    } catch (e) {
      if (!String(e).includes('cancelled')) setError(String(e));
    } finally {
      setInstalling('');
      setProgress(null);
      await refresh();
    }
  };
  const ocr = items.find((i) => i.id === `ocr-${variant}`);
  const translation = items.find((i) => i.id === pack);
  const busy = !!installing || items.some((i) => i.busy);
  const controls = (item: ComponentStatus | undefined) =>
    item && (
      <div className="flex items-center gap-2">
        {item.installed ? (
          <>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
              <Check size={11} />
              {text('已安装', 'Installed')} · {(item.bytes / 1048576).toFixed(1)} MB
            </span>
            <button
              className={`${ghostButton} text-destructive`}
              disabled={busy}
              aria-label={`${componentName(item)} ${text('卸载', 'uninstall')}`}
              onClick={() => setRemove(item)}
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : (
          <button className={ghostButton} disabled={busy} onClick={() => void install(item.id)}>
            <Download size={14} />
            {text('下载并安装', 'Download and install')}
          </button>
        )}
      </div>
    );
  return (
    <div className="space-y-5" data-el="components-settings">
      <PaneHeader
        title={text('组件集成', 'Optional components')}
        subtitle={text(
          '本地模型按需安装，不随主程序捆绑；使用后释放。安装组件后可在此选择启用。',
          'Optional local models are downloaded separately and released after use. Choose the active engine below.'
        )}
      />
      <SettingCard>
        <Row
          title={text('离线文字识别', 'Offline OCR')}
          desc={text(
            'PP-OCRv6；轻量模型适合日常截图，标准模型适合更多文字场景。',
            'PP-OCRv6 tiny and small model options.'
          )}
          control={
            <select
              aria-label={text('OCR 模型', 'OCR model')}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              <option value="tiny">PP-OCRv6 {text('轻量', 'Tiny')}</option>
              <option value="small">PP-OCRv6 {text('标准', 'Small')}</option>
            </select>
          }
        />
        <Row desc={ocr?.version} control={controls(ocr)} />
        <Row
          title={text('当前识别引擎', 'Active OCR engine')}
          control={
            <Segmented
              value={p.ocr_engine === 'windows' ? 'windows' : p.ocr_variant}
              onChange={(value) =>
                updateSetting('capture', {
                  ...p,
                  ocr_engine: value === 'windows' ? 'windows' : 'ppocr',
                  ocr_variant: value === 'small' ? 'small' : 'tiny',
                })
              }
              options={[
                { value: 'windows', label: text('Windows 系统', 'Windows') },
                ...items
                  .filter((i) => i.kind === 'ocr' && i.installed)
                  .map((i) => ({
                    value: i.id.slice(4),
                    label: i.id === 'ocr-tiny' ? 'PP-OCRv6 Tiny' : 'PP-OCRv6 Small',
                  })),
              ]}
            />
          }
        />
      </SettingCard>
      <SettingCard>
        <Row
          title={text('离线翻译', 'Offline translation')}
          desc={text(
            'Firefox / Bergamot 语言包；无需联网发送文字，支持通过英语中转。',
            'Firefox / Bergamot local models. Text stays on this computer; English pivot is supported.'
          )}
          control={
            <select
              aria-label={text('翻译语言包', 'Translation language pack')}
              className="max-w-[175px] rounded-lg border border-border bg-background px-2 py-1 text-xs"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
            >
              {items
                .filter((i) => i.kind === 'translation')
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {componentName(i)}
                  </option>
                ))}
            </select>
          }
        />
        <Row desc={translation?.version} control={controls(translation)} />
      </SettingCard>
      <SettingCard>
        <Row
          title={text('外部图片查看器', 'External image viewer')}
          desc={text(
            '可选择已安装的果核看图或其他查看器；截图历史中可直接打开。',
            'Choose an installed image viewer to open images from capture history.'
          )}
          control={
            <button
              className={ghostButton}
              onClick={async () => {
                try {
                  const path = await invoke<string | null>('choose_image_viewer');
                  if (path) updateSetting('capture', { ...p, viewer_path: path });
                } catch (e) {
                  toast.error(String(e));
                }
              }}
            >
              {text('选择程序', 'Choose app')}
            </button>
          }
        />
        {p.viewer_path && (
          <Row>
            <p className="break-all text-xs text-muted-foreground">{p.viewer_path}</p>
            <button
              className="mt-2 text-xs text-destructive"
              onClick={() => updateSetting('capture', { ...p, viewer_path: '' })}
            >
              {text('移除关联', 'Remove association')}
            </button>
          </Row>
        )}
      </SettingCard>
      {progress && (
        <div role="status" className="rounded-xl border border-border p-3">
          <p className="mb-2 text-xs">
            {text('正在安装', 'Installing')} {progress.step + 1}/{progress.steps} ·{' '}
            {progress.stage === 'extract'
              ? text('解压组件', 'Extracting')
              : text('下载资源', 'Downloading')}
          </p>
          <progress
            className="h-2 w-full"
            value={progress.total ? progress.received : undefined}
            max={progress.total || undefined}
          />
          <button
            className={`${ghostButton} mt-2`}
            onClick={() => void invoke('cancel_component_install')}
          >
            <Square size={12} />
            {text('取消安装', 'Cancel installation')}
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className={ghostButton}
          onClick={() =>
            void invoke('open_component_directory').catch((e) => toast.error(String(e)))
          }
        >
          <FolderOpen size={14} />
          {text('打开组件目录', 'Open components folder')}
        </button>
        <span className="text-xs text-muted-foreground">
          {text('已安装组件', 'Installed components')}: {items.filter((i) => i.installed).length}
        </span>
      </div>
      <ConfirmDialog
        isOpen={!!remove}
        title={text('卸载组件？', 'Uninstall component?')}
        message={text(
          `移除 ${remove?.name ?? ''}。不会删除截图历史；卸载正在使用的 OCR 后会恢复系统引擎。`,
          `Remove ${remove ? componentName(remove) : ''}. History remains; removing the active OCR restores the system engine.`
        )}
        onCancel={() => setRemove(null)}
        onConfirm={async () => {
          if (!remove) return;
          try {
            await invoke('uninstall_component', { id: remove.id });
            setRemove(null);
            await refresh();
          } catch (e) {
            setError(String(e));
          }
        }}
      />
    </div>
  );
}
