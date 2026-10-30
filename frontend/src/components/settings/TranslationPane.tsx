import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRightLeft, Copy, Languages } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings } from '../../types';
import type { UpdateSetting } from './types';
import { capturePreferences } from '../../utils/capturePreferences';
import { useTranslation } from '../../i18n';
import { PaneHeader, ghostButton } from './ui';
const LANGS = [
  ['zh', '简体中文', 'Chinese'],
  ['en', '英语', 'English'],
  ['zh-Hant', '繁体中文', 'Traditional Chinese'],
  ['ja', '日语', 'Japanese'],
  ['ko', '韩语', 'Korean'],
  ['ru', '俄语', 'Russian'],
  ['fr', '法语', 'French'],
  ['es', '西班牙语', 'Spanish'],
  ['de', '德语', 'German'],
] as const;
export function TranslationPane({
  settings,
  updateSetting,
}: {
  settings: Settings;
  updateSetting: UpdateSetting;
}) {
  const { lang } = useTranslation();
  const zh = lang === 'zh-CN';
  const text = (cn: string, en: string) => (zh ? cn : en);
  const p = capturePreferences(settings);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setOutput(
        await invoke<string>('translate_text', {
          text: input,
          source: p.translate_source,
          target: p.translate_target,
        })
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-el="translation-pane">
      <PaneHeader
        title={text('离线翻译', 'Offline translation')}
        subtitle={text(
          '文字只在本机处理。非英语语言之间可使用已安装的英语语言包中转。',
          'Text is processed locally. Installed English language pairs can provide pivot translation.'
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={text('源语言', 'Source language')}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
          value={p.translate_source}
          onChange={(e) => updateSetting('capture', { ...p, translate_source: e.target.value })}
        >
          <option value="auto">{text('自动检测', 'Auto detect')}</option>
          {LANGS.map(([id, cn, en]) => (
            <option key={id} value={id}>
              {text(cn, en)}
            </option>
          ))}
        </select>
        <button
          className={ghostButton}
          disabled={busy || p.translate_source === 'auto'}
          aria-label={text('交换语言', 'Swap languages')}
          onClick={() => {
            updateSetting('capture', {
              ...p,
              translate_source: p.translate_target,
              translate_target: p.translate_source,
            });
            setInput(output);
            setOutput(input);
          }}
        >
          <ArrowRightLeft size={14} />
        </button>
        <select
          aria-label={text('目标语言', 'Target language')}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
          value={p.translate_target}
          onChange={(e) => updateSetting('capture', { ...p, translate_target: e.target.value })}
        >
          {LANGS.map(([id, cn, en]) => (
            <option key={id} value={id}>
              {text(cn, en)}
            </option>
          ))}
        </select>
      </div>
      <textarea
        aria-label={text('待翻译文字', 'Text to translate')}
        maxLength={200000}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={text('输入或粘贴文字…', 'Type or paste text…')}
        className="min-h-36 w-full resize-y rounded-xl border border-border bg-card/60 p-3 text-sm outline-none focus:border-primary"
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            if (!busy && input.trim()) void run();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`${ghostButton} bg-primary/10 text-primary`}
          disabled={busy || !input.trim()}
          onClick={() => void run()}
        >
          <Languages size={14} />
          {busy ? text('正在翻译…', 'Translating…') : text('翻译', 'Translate')}
        </button>
        <span className="text-[10px] text-muted-foreground">Ctrl+Enter</span>
        <button
          className={`${ghostButton} ml-auto`}
          onClick={() =>
            void invoke('open_settings_section', { section: 'components' }).catch((e) =>
              toast.error(String(e))
            )
          }
        >
          {text('管理语言包', 'Manage language packs')}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <div className="relative">
        <textarea
          aria-label={text('翻译结果', 'Translation result')}
          value={output}
          readOnly
          placeholder={text('翻译结果显示在这里', 'Translation appears here')}
          className="min-h-36 w-full resize-y rounded-xl border border-border bg-card/60 p-3 pb-11 text-sm outline-none"
        />
        <button
          className={`${ghostButton} absolute bottom-3 right-3`}
          disabled={!output}
          onClick={() =>
            void navigator.clipboard
              .writeText(output)
              .then(() => toast.success(text('已复制', 'Copied')))
              .catch((e) => toast.error(String(e)))
          }
        >
          <Copy size={13} />
          {text('复制译文', 'Copy translation')}
        </button>
      </div>
    </div>
  );
}
