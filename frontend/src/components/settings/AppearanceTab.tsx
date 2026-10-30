import { useCallback, useEffect, useRef, useState } from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { invoke } from '@tauri-apps/api/core';
import { GripVertical, EyeOff, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings } from '../../types';
import type { UpdateSetting, UpdateSettings } from './types';
import { useTranslation } from '../../i18n';
import {
  capturePreferences,
  CAPTURE_ACTIONS,
  DEFAULT_CAPTURE_PREFERENCES,
  type CaptureAction,
} from '../../utils/capturePreferences';
import { CaptureToolbarButtons, CAPTURE_ICONS, toolbarStyle } from '../CaptureToolbar';
import { PaneHeader, Row, SettingCard, Segmented, Toggle, ghostButton } from './ui';
export function AppearanceTab({
  settings,
  updateSetting,
  updateSettings,
}: {
  settings: Settings;
  updateSetting: UpdateSetting;
  updateSettings: UpdateSettings;
}) {
  const { lang } = useTranslation();
  const zh = lang === 'zh-CN';
  const text = (cn: string, en: string) => (zh ? cn : en);
  const [section, setSection] = useState('toolbar');
  const [drag, setDrag] = useState<CaptureAction | null>(null);
  const pointerDrag = useRef<{
    source: CaptureAction;
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    element: HTMLDivElement;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<CaptureAction | null>(null);
  const p = capturePreferences(settings);
  const visibleTools = p.toolbar_order.filter((id) => !p.toolbar_hidden.includes(id));
  const patch = (updates: Partial<typeof p>) => updateSetting('capture', { ...p, ...updates });
  const theme = useSystemTheme();
  const move = (id: CaptureAction, target: CaptureAction, after: boolean) => {
    const order = p.toolbar_order.filter((x) => x !== id);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    patch({ toolbar_order: order, toolbar_hidden: p.toolbar_hidden.filter((x) => x !== id) });
  };
  const hide = (id: CaptureAction) => {
    if (id === 'cancel' || id === 'confirm') return;
    patch({ toolbar_hidden: [...new Set([...p.toolbar_hidden, id])] });
  };
  const clearDrag = useCallback(() => {
    const current = pointerDrag.current;
    pointerDrag.current = null;
    if (current?.element.hasPointerCapture(current.pointer))
      current.element.releasePointerCapture(current.pointer);
    setDrag(null);
    setDropTarget(null);
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearDrag();
    };
    window.addEventListener('blur', clearDrag);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('blur', clearDrag);
      window.removeEventListener('keydown', cancel);
    };
  }, [clearDrag]);
  const hitTool = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    if (hit?.closest('[data-el="hidden-tools"]')) return { hidden: true } as const;
    const element = hit?.closest<HTMLDivElement>('[data-tool-order]');
    const id = p.toolbar_order.find((tool) => tool === element?.dataset.toolOrder);
    if (!id || !element) return null;
    const bounds = element.getBoundingClientRect();
    return { hidden: false, id, after: x > bounds.left + bounds.width / 2 } as const;
  };
  const label = (id: CaptureAction) => CAPTURE_ACTIONS.find((a) => a[0] === id)?.[zh ? 1 : 2] ?? id;
  return (
    <div className="space-y-5" data-el="appearance-settings">
      <PaneHeader
        title={text('外观设置', 'Appearance')}
        subtitle={text(
          '工具栏顺序、可见工具和主题会同步到实际截图界面。',
          'Toolbar order, visibility and theme apply to the actual capture interface.'
        )}
      />
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'toolbar', label: text('截图工具栏', 'Capture toolbar') },
          { value: 'software', label: text('软件外观', 'App appearance') },
          { value: 'pins', label: text('贴图外观', 'Pinned images') },
        ]}
      />
      {section === 'toolbar' && (
        <>
          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {text(
                '工具栏外观预览；实际操作请点击“试用截图”。',
                'Toolbar appearance preview. Use “Try capture” to operate the tools.'
              )}
            </p>
            <div
              className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border p-2"
              style={toolbarStyle(p, theme)}
            >
              <CaptureToolbarButtons
                preferences={p}
                theme={theme}
                active="select"
                onAction={() => undefined}
                preview
              />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              {text(
                '按住工具项拖动排列，松手保存。完成和取消始终保留。',
                'Hold and drag a tool to reorder; release to save. Finish and cancel always remain available.'
              )}
            </p>
            <div className="flex flex-wrap gap-2" data-el="toolbar-order">
              {visibleTools.map((id) => {
                const Icon = CAPTURE_ICONS[id];
                return (
                  <div
                    key={id}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || (e.target as Element).closest('button')) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pointerDrag.current = {
                        source: id,
                        pointer: e.pointerId,
                        x: e.clientX,
                        y: e.clientY,
                        moved: false,
                        element: e.currentTarget,
                      };
                    }}
                    onPointerMove={(e) => {
                      const current = pointerDrag.current;
                      if (!current || current.pointer !== e.pointerId) return;
                      if (
                        !current.moved &&
                        Math.hypot(e.clientX - current.x, e.clientY - current.y) < 5
                      )
                        return;
                      current.moved = true;
                      setDrag(current.source);
                      const target = hitTool(e.clientX, e.clientY);
                      setDropTarget(target && !target.hidden ? target.id : null);
                    }}
                    onPointerUp={(e) => {
                      const current = pointerDrag.current;
                      if (!current || current.pointer !== e.pointerId) return;
                      const target = current.moved ? hitTool(e.clientX, e.clientY) : null;
                      if (target?.hidden) hide(current.source);
                      else if (target && target.id !== current.source) {
                        move(current.source, target.id, target.after);
                      }
                      clearDrag();
                    }}
                    onPointerCancel={clearDrag}
                    onLostPointerCapture={clearDrag}
                    onDragStart={(e) => e.preventDefault()}
                    className={`flex cursor-grab items-center gap-2 rounded-lg border border-border bg-accent/25 p-2 active:cursor-grabbing ${drag === id ? 'opacity-40' : ''} ${dropTarget === id ? 'ring-2 ring-primary' : ''}`}
                    style={{ touchAction: 'none' }}
                    data-tool-order={id}
                    title={text('按住拖动排列', 'Hold and drag to reorder')}
                  >
                    <GripVertical size={13} className="text-muted-foreground" />
                    <Icon size={16} />
                    <span className="text-xs">{label(id)}</span>
                    {!['cancel', 'confirm'].includes(id) && (
                      <button
                        aria-label={`${label(id)} ${text('隐藏', 'hide')}`}
                        className="p-1 text-muted-foreground"
                        onClick={() => hide(id)}
                      >
                        <EyeOff size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className="mt-4 min-h-16 rounded-lg border border-dashed border-border p-3"
              data-el="hidden-tools"
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {text(
                  '拖到这里隐藏；点击隐藏的工具可恢复。',
                  'Drop here to hide. Click a hidden tool to restore it.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {p.toolbar_hidden.map((id) => (
                  <button
                    key={id}
                    className={ghostButton}
                    onClick={() =>
                      patch({ toolbar_hidden: p.toolbar_hidden.filter((x) => x !== id) })
                    }
                  >
                    {label(id)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SettingCard>
            <Row
              title={text('工具栏主题', 'Toolbar theme')}
              control={
                <Segmented
                  value={p.toolbar_theme}
                  onChange={(value) => patch({ toolbar_theme: value as typeof p.toolbar_theme })}
                  options={[
                    { value: 'system', label: text('跟随系统', 'System') },
                    { value: 'dark', label: text('深色', 'Dark') },
                    { value: 'light', label: text('浅色', 'Light') },
                    { value: 'custom', label: text('自定义', 'Custom') },
                  ]}
                />
              }
            />
            {p.toolbar_theme === 'custom' &&
              Object.entries(p.toolbar_colors).map(([key, value]) => (
                <Row
                  key={key}
                  title={text(
                    (
                      {
                        background: '背景',
                        foreground: '图标文字',
                        accent: '强调色',
                        border: '边框',
                      } as Record<string, string>
                    )[key],
                    key
                  )}
                  control={
                    <input
                      aria-label={key}
                      type="color"
                      value={value}
                      onChange={(e) =>
                        patch({ toolbar_colors: { ...p.toolbar_colors, [key]: e.target.value } })
                      }
                      className="h-8 w-14 rounded border border-border bg-transparent"
                    />
                  }
                />
              ))}
            <Row
              title={text('工具栏尺寸', 'Toolbar size')}
              control={
                <label className="flex items-center gap-3 text-xs">
                  <input
                    aria-label={text('工具栏尺寸', 'Toolbar size')}
                    type="range"
                    min="70"
                    max="150"
                    step="10"
                    value={p.toolbar_scale}
                    onChange={(e) => patch({ toolbar_scale: Number(e.target.value) })}
                  />
                  {p.toolbar_scale}%
                </label>
              }
            />
          </SettingCard>
          <div className="flex gap-2">
            <button
              className={ghostButton}
              onClick={() =>
                updateSettings(
                  {
                    capture: {
                      ...p,
                      toolbar_order: [...DEFAULT_CAPTURE_PREFERENCES.toolbar_order],
                      toolbar_hidden: [...DEFAULT_CAPTURE_PREFERENCES.toolbar_hidden],
                      toolbar_theme: 'dark',
                      toolbar_colors: { ...DEFAULT_CAPTURE_PREFERENCES.toolbar_colors },
                      toolbar_scale: 100,
                    },
                  },
                  [
                    'toolbar_order',
                    'toolbar_hidden',
                    'toolbar_theme',
                    'toolbar_colors',
                    'toolbar_scale',
                  ]
                )
              }
            >
              <RotateCcw size={14} />
              {text('恢复工具栏默认', 'Reset toolbar')}
            </button>
            <button
              className={ghostButton}
              onClick={() => void invoke('start_screenshot').catch((e) => toast.error(String(e)))}
            >
              {text('试用截图', 'Try capture')}
            </button>
          </div>
        </>
      )}
      {section === 'software' && (
        <SettingCard>
          <Row
            title={text('主题', 'Theme')}
            control={
              <Segmented
                value={settings.theme}
                onChange={(value) => updateSetting('theme', value)}
                options={[
                  { value: 'system', label: text('跟随系统', 'System') },
                  { value: 'light', label: text('浅色', 'Light') },
                  { value: 'dark', label: text('深色', 'Dark') },
                ]}
              />
            }
          />
          <Row
            title={text('窗口材质', 'Window material')}
            control={
              <Segmented
                value={settings.mica_effect ?? 'solid'}
                onChange={(value) => updateSetting('mica_effect', value)}
                options={[
                  { value: 'solid', label: text('纯色', 'Solid') },
                  { value: 'mica', label: text('云母', 'Mica') },
                  { value: 'acrylic', label: text('亚克力', 'Acrylic') },
                ]}
              />
            }
          />
          <Row
            title={text('窗口圆角', 'Rounded windows')}
            control={
              <Toggle
                label={text('窗口圆角', 'Rounded windows')}
                checked={settings.round_corners ?? true}
                onChange={() => updateSetting('round_corners', !settings.round_corners)}
              />
            }
          />
        </SettingCard>
      )}
      {section === 'pins' && (
        <SettingCard>
          <Row
            title={text('贴图边框', 'Image border')}
            control={
              <Toggle
                label={text('贴图边框', 'Image border')}
                checked={p.pin_border}
                onChange={() => patch({ pin_border: !p.pin_border })}
              />
            }
          />
          <Row
            title={text('默认不透明度', 'Default opacity')}
            desc={text(
              '新贴图使用此值；Shift + 滚轮仍可单独调整。',
              'Applied to new pins. Shift + wheel adjusts individual images.'
            )}
            control={
              <label className="flex items-center gap-3 text-xs">
                <input
                  aria-label="pin opacity"
                  type="range"
                  min="15"
                  max="100"
                  step="5"
                  value={p.pin_opacity}
                  onChange={(e) => patch({ pin_opacity: Number(e.target.value) })}
                />
                {p.pin_opacity}%
              </label>
            }
          />
        </SettingCard>
      )}
    </div>
  );
}
