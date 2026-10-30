import type { CSSProperties } from 'react';
import {
  ScanLine,
  Video,
  Stamp,
  MousePointer2,
  Square,
  Circle,
  ArrowUpRight,
  Pencil,
  Type,
  ListOrdered,
  Highlighter,
  Grid2X2,
  Eraser,
  Undo2,
  Redo2,
  Expand,
  ScanText,
  Languages,
  Download,
  Pin,
  X,
  Check,
} from 'lucide-react';
import {
  CAPTURE_ACTIONS,
  type CaptureAction,
  type CapturePreferences,
} from '../utils/capturePreferences';
import { useTranslation } from '../i18n';
export const CAPTURE_ICONS = {
  scroll: ScanLine,
  record: Video,
  watermark: Stamp,
  select: MousePointer2,
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  pen: Pencil,
  text: Type,
  marker: ListOrdered,
  highlight: Highlighter,
  mosaic: Grid2X2,
  eraser: Eraser,
  undo: Undo2,
  redo: Redo2,
  edit: Expand,
  ocr: ScanText,
  translate: Languages,
  save: Download,
  pin: Pin,
  cancel: X,
  confirm: Check,
};
export function toolbarColors(p: CapturePreferences, system: 'light' | 'dark') {
  const theme = p.toolbar_theme === 'system' ? system : p.toolbar_theme;
  return theme === 'custom'
    ? p.toolbar_colors
    : theme === 'light'
      ? { background: '#fafafa', foreground: '#242424', accent: '#19b455', border: '#d6d6d6' }
      : { background: '#202020', foreground: '#eeeeee', accent: '#33cc66', border: '#444444' };
}
export function toolbarStyle(p: CapturePreferences, system: 'light' | 'dark'): CSSProperties {
  const c = toolbarColors(p, system);
  return { background: c.background, color: c.foreground, borderColor: c.border };
}
export function CaptureToolbarButtons({
  preferences: p,
  theme,
  active,
  onAction,
  disabled = [],
  preview = false,
}: {
  preferences: CapturePreferences;
  theme: 'light' | 'dark';
  active?: string;
  onAction: (action: CaptureAction) => void;
  disabled?: string[];
  preview?: boolean;
}) {
  const { lang } = useTranslation();
  const colors = toolbarColors(p, theme);
  const size = Math.round((32 * p.toolbar_scale) / 100);
  return (
    <>
      {p.toolbar_order
        .filter((id) => !p.toolbar_hidden.includes(id) || id === 'cancel' || id === 'confirm')
        .map((id) => {
          const Icon = CAPTURE_ICONS[id];
          const definition = CAPTURE_ACTIONS.find((a) => a[0] === id);
          const label = definition?.[lang === 'zh-CN' ? 1 : 2] ?? id;
          const key = id === 'cancel' ? 'Esc' : p.shortcuts[id];
          const style = {
            width: size,
            height: size,
            color:
              id === 'cancel'
                ? '#ed5555'
                : id === 'confirm' || active === id
                  ? colors.accent
                  : colors.foreground,
            background: active === id ? `${colors.accent}22` : 'transparent',
            border: `1px solid ${active === id ? colors.accent : 'transparent'}`,
          };
          if (preview)
            return (
              <span
                key={id}
                role="img"
                aria-label={label}
                title={label}
                className="flex shrink-0 items-center justify-center rounded-lg"
                style={style}
              >
                <Icon size={Math.round((18 * p.toolbar_scale) / 100)} />
              </span>
            );
          return (
            <button
              key={id}
              type="button"
              data-capture-action={id}
              title={`${label}${key ? ` (${key})` : ''}`}
              aria-label={label}
              aria-pressed={active === id}
              disabled={disabled.includes(id)}
              onClick={() => onAction(id)}
              className="flex shrink-0 items-center justify-center rounded-lg disabled:opacity-30"
              style={style}
            >
              <Icon size={Math.round((18 * p.toolbar_scale) / 100)} />
            </button>
          );
        })}
    </>
  );
}
