import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { Settings } from '../../types';
import type { UpdateSetting, UpdateSettings } from './types';
import { useTranslation } from '../../i18n';
import {
  capturePreferences,
  CAPTURE_ACTIONS,
  DEFAULT_CAPTURE_PREFERENCES,
} from '../../utils/capturePreferences';
import { PaneHeader, Row, SettingCard, Segmented, ghostButton } from './ui';
import { ShortcutInput } from './ShortcutInput';
export function HotkeysTab({
  settings,
  updateSetting,
  updateSettings,
  active,
}: {
  settings: Settings;
  updateSetting: UpdateSetting;
  updateSettings: UpdateSettings;
  active: boolean;
}) {
  const { lang } = useTranslation();
  const zh = lang === 'zh-CN';
  const [scope, setScope] = useState('global');
  const p = capturePreferences(settings);
  const text = (cn: string, en: string) => (zh ? cn : en);
  const [status, setStatus] = useState<{
    active: Record<string, string>;
    suspended: boolean;
  } | null>(null);
  const refresh = useCallback(
    () =>
      invoke<{ active: Record<string, string>; suspended: boolean }>('get_shortcut_status')
        .then(setStatus)
        .catch((e) => toast.error(String(e))),
    []
  );
  useEffect(() => {
    if (active) void refresh();
  }, [
    active,
    settings.hotkey,
    settings.screenshot_hotkey,
    settings.pin_hotkey,
    settings.capture?.global_hotkeys,
    refresh,
  ]);
  const global = [
    ['hotkey', '剪贴板历史', 'Clipboard history', 'Win+Alt+V'],
    ['screenshot_hotkey', '区域截图', 'Capture region', 'F1'],
    ['pin_hotkey', '快速贴图', 'Pin clipboard image', 'F3'],
  ] as const;
  const extra = [
    ['capture_history', '截图历史', 'Capture history'],
    ['scroll_capture', '长截图', 'Scrolling capture'],
    ['record_screen', '录屏', 'Record screen'],
    ['presentation', '演示画布 / 恢复操作', 'Presentation / restore'],
    ['open_settings', '打开设置', 'Open settings'],
    ['translate', '离线翻译', 'Offline translation'],
    ['region_ocr', '区域文字识别', 'Recognize screen text'],
    ['region_translate', '区域翻译', 'Translate screen region'],
    ['hide_pins', '隐藏 / 恢复所有贴图', 'Hide / restore pinned images'],
  ] as const;
  const local = [
    ...CAPTURE_ACTIONS.filter((a) => a[0] !== 'cancel'),
    ['copy', '复制截图', 'Copy screenshot'],
    ['next_candidate', '切换窗口候选', 'Next window candidate'],
    ['pan', '移动画布', 'Pan canvas'],
    ['crop', '裁剪', 'Crop'],
    ['line', '直线', 'Line'],
    ['remove', '删除选中标注', 'Delete selected mark'],
    ['rotate_left', '向左旋转', 'Rotate left'],
    ['rotate_right', '向右旋转', 'Rotate right'],
    ['flip_x', '水平翻转', 'Flip horizontal'],
    ['flip_y', '垂直翻转', 'Flip vertical'],
    ['fit', '适应窗口', 'Fit image'],
    ['actual_size', '实际像素', 'Actual pixels'],
    ['zoom_in', '放大', 'Zoom in'],
    ['zoom_out', '缩小', 'Zoom out'],
    ['finish_editor', '完成图片编辑', 'Finish editing'],
    ['toggle_top', '切换贴图置顶', 'Toggle pin always-on-top'],
  ] as const;
  return (
    <div className="space-y-5" data-el="hotkeys-settings">
      <PaneHeader
        title={text('快捷键', 'Keyboard shortcuts')}
        subtitle={text(
          '点击键位后直接按下组合键；支持 F1 等单键。保存时检查重复和占用，失败保留旧绑定。',
          'Click a binding and press the keys. Conflicts preserve the previous working binding.'
        )}
      />
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'global', label: text('全局热键', 'Global') },
          { value: 'local', label: text('截图 / 编辑 / 贴图', 'Capture / editor / pins') },
        ]}
      />
      {scope === 'global' ? (
        <div className="space-y-4">
          <SettingCard>
            {global.map(([key, cn, en, def]) => (
              <Row
                key={key}
                title={text(cn, en)}
                control={
                  <ShortcutInput
                    enabled={active}
                    label={text(cn, en)}
                    value={settings[key] ?? def}
                    defaultValue={def}
                    onChange={(value) => updateSetting(key, value)}
                  />
                }
              />
            ))}
          </SettingCard>
          <SettingCard>
            {extra.map(([id, cn, en]) => (
              <Row
                key={id}
                title={text(cn, en)}
                control={
                  <ShortcutInput
                    enabled={active}
                    label={text(cn, en)}
                    value={p.global_hotkeys[id] ?? ''}
                    defaultValue=""
                    onChange={(value) =>
                      updateSetting('capture', {
                        ...p,
                        global_hotkeys: { ...p.global_hotkeys, [id]: value },
                      })
                    }
                  />
                }
              />
            ))}
          </SettingCard>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {text(
              'Win+V 仍由常规页的“替换 Win+V”控制。区域识别和翻译在松手后处理；翻译需先安装语言包。',
              'Win+V is controlled by General settings. Region OCR and translation run after selection; translation requires an installed language pack.'
            )}
          </p>
          {status &&
            Object.entries(p.global_hotkeys)
              .filter(([id, value]) => value && status.active[id] !== value)
              .map(([id, value]) => (
                <p key={id} role="status" className="text-xs text-destructive">
                  {text('尚未注册', 'Not registered')}: {value}
                </p>
              ))}
          <div className="flex flex-wrap gap-2">
            <button
              className={ghostButton}
              onClick={() =>
                void invoke('retry_configured_shortcuts')
                  .then(() => {
                    void refresh();
                    toast.success(text('快捷键已注册', 'Shortcuts registered'));
                  })
                  .catch((e) => toast.error(String(e)))
              }
            >
              {text('重新注册', 'Retry registration')}
            </button>
            <button
              className={ghostButton}
              onClick={() =>
                updateSettings(
                  {
                    hotkey: 'Win+Alt+V',
                    screenshot_hotkey: 'F1',
                    pin_hotkey: 'F3',
                    capture: { ...p, global_hotkeys: {} },
                  },
                  ['global_hotkeys']
                )
              }
            >
              {text('恢复全局默认', 'Reset global bindings')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <SettingCard>
            {local.map(([id, cn, en]) => (
              <Row
                key={id}
                title={text(cn, en)}
                control={
                  <ShortcutInput
                    enabled={active}
                    label={text(cn, en)}
                    value={p.shortcuts[id] ?? ''}
                    defaultValue={DEFAULT_CAPTURE_PREFERENCES.shortcuts[id] ?? ''}
                    onChange={(value) =>
                      updateSetting('capture', { ...p, shortcuts: { ...p.shortcuts, [id]: value } })
                    }
                  />
                }
              />
            ))}
          </SettingCard>
          <p className="text-xs text-muted-foreground">
            {text(
              'Esc 始终用于取消。文字输入时工具键暂停；画布、裁剪和变换键用于完整编辑器，贴图使用复制、保存、编辑和置顶绑定。',
              'Escape always cancels. Tool keys pause during text entry. Canvas, crop and transform keys apply in the full editor; pins use copy, save, edit and always-on-top bindings.'
            )}
          </p>
          <button
            className={ghostButton}
            onClick={() =>
              updateSettings(
                { capture: { ...p, shortcuts: { ...DEFAULT_CAPTURE_PREFERENCES.shortcuts } } },
                ['shortcuts']
              )
            }
          >
            {text('恢复默认操作键', 'Reset action keys')}
          </button>
        </div>
      )}
    </div>
  );
}
