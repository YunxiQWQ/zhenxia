import type { Settings } from '../types';

export const CAPTURE_ACTIONS = [
  ['select', '选择', 'Select'],
  ['rect', '矩形', 'Rectangle'],
  ['ellipse', '椭圆', 'Ellipse'],
  ['arrow', '箭头', 'Arrow'],
  ['pen', '画笔', 'Pen'],
  ['text', '文字', 'Text'],
  ['marker', '序号', 'Number'],
  ['highlight', '高亮', 'Highlight'],
  ['mosaic', '马赛克', 'Mosaic'],
  ['eraser', '橡皮擦', 'Eraser'],
  ['undo', '撤销', 'Undo'],
  ['redo', '重做', 'Redo'],
  ['edit', '完整编辑', 'Full editor'],
  ['ocr', '识别文字', 'Recognize text'],
  ['translate', '翻译', 'Translate'],
  ['save', '保存图片', 'Save image'],
  ['pin', '贴图', 'Pin image'],
  ['scroll', '长截图', 'Scrolling capture'],
  ['record', '录屏', 'Record screen'],
  ['watermark', '水印', 'Watermark'],
  ['cancel', '取消', 'Cancel'],
  ['confirm', '完成并复制', 'Finish and copy'],
] as const;
export type CaptureAction = (typeof CAPTURE_ACTIONS)[number][0];
export interface ToolbarColors {
  background: string;
  foreground: string;
  accent: string;
  border: string;
}
export interface CapturePreferences {
  toolbar_theme: 'system' | 'dark' | 'light' | 'custom';
  toolbar_colors: ToolbarColors;
  toolbar_order: CaptureAction[];
  toolbar_hidden: CaptureAction[];
  toolbar_scale: number;
  shortcuts: Record<string, string>;
  global_hotkeys: Record<string, string>;
  ocr_engine: 'windows' | 'ppocr';
  ocr_variant: 'tiny' | 'small';
  translate_source: string;
  translate_target: string;
  pin_border: boolean;
  pin_opacity: number;
  viewer_path: string;
}
export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  toolbar_theme: 'dark',
  toolbar_colors: {
    background: '#202020',
    foreground: '#eeeeee',
    accent: '#33cc66',
    border: '#444444',
  },
  toolbar_order: CAPTURE_ACTIONS.map((a) => a[0]),
  toolbar_hidden: ['ellipse', 'highlight', 'redo'],
  toolbar_scale: 100,
  shortcuts: {
    select: 'V',
    rect: 'R',
    ellipse: 'E',
    arrow: 'A',
    pen: 'B',
    text: 'T',
    marker: 'N',
    highlight: 'H',
    mosaic: 'M',
    eraser: 'X',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    edit: 'Ctrl+E',
    ocr: 'Ctrl+O',
    translate: 'Ctrl+T',
    save: 'Ctrl+S',
    pin: 'Ctrl+P',
    confirm: 'Enter',
    copy: 'Ctrl+C',
    next_candidate: 'Tab',
    pan: 'Space',
    crop: 'C',
    line: 'L',
    remove: 'Delete',
    rotate_left: 'Ctrl+Alt+ArrowLeft',
    rotate_right: 'Ctrl+Alt+ArrowRight',
    flip_x: 'Ctrl+Alt+H',
    flip_y: 'Ctrl+Shift+V',
    fit: 'Ctrl+0',
    actual_size: 'Ctrl+1',
    zoom_in: 'Ctrl+Equal',
    zoom_out: 'Ctrl+Minus',
    finish_editor: 'Ctrl+Enter',
    toggle_top: 'Alt+P',
    scroll: '',
    record: '',
    watermark: '',
  },
  global_hotkeys: {},
  ocr_engine: 'windows',
  ocr_variant: 'tiny',
  translate_source: 'auto',
  translate_target: 'en',
  pin_border: true,
  pin_opacity: 100,
  viewer_path: '',
};
export function capturePreferences(settings?: Settings | null): CapturePreferences {
  const p = settings?.capture;
  return {
    ...DEFAULT_CAPTURE_PREFERENCES,
    ...p,
    toolbar_colors: { ...DEFAULT_CAPTURE_PREFERENCES.toolbar_colors, ...p?.toolbar_colors },
    shortcuts: { ...DEFAULT_CAPTURE_PREFERENCES.shortcuts, ...p?.shortcuts },
    global_hotkeys: p?.global_hotkeys ?? {},
    toolbar_order: [
      ...new Set([
        ...(p?.toolbar_order ?? DEFAULT_CAPTURE_PREFERENCES.toolbar_order),
        ...CAPTURE_ACTIONS.map((a) => a[0]),
      ]),
    ],
  };
}

/** Apply only fields changed in this render, preserving earlier queued edits. */
export function mergeCaptureUpdate(
  current: CapturePreferences,
  rendered: CapturePreferences,
  next: CapturePreferences,
  force: (keyof CapturePreferences)[] = []
): CapturePreferences {
  const output = { ...current } as unknown as Record<string, unknown>;
  for (const key of Object.keys(next) as (keyof CapturePreferences)[]) {
    if (force.includes(key)) {
      output[key] = next[key];
      continue;
    }
    if (JSON.stringify(rendered[key]) === JSON.stringify(next[key])) continue;
    if (next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])) {
      const old = rendered[key] as unknown as Record<string, unknown>;
      const value = next[key] as unknown as Record<string, unknown>;
      const merged = { ...(current[key] as unknown as Record<string, unknown>) };
      for (const child of new Set([...Object.keys(old), ...Object.keys(value)])) {
        if (old[child] === value[child]) continue;
        if (value[child] === undefined) delete merged[child];
        else merged[child] = value[child];
      }
      output[key] = merged;
    } else output[key] = next[key];
  }
  return output as unknown as CapturePreferences;
}

export function eventShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
): string | null {
  if (
    [
      'Control',
      'Alt',
      'Shift',
      'Meta',
      'OS',
      'AltGraph',
      'Dead',
      'Process',
      'Unidentified',
    ].includes(event.key)
  )
    return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Win');
  let key = event.key;
  if (event.code?.startsWith('Key')) key = event.code.slice(3);
  else if (event.code?.startsWith('Digit')) key = event.code.slice(5);
  else if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  if (['+', '=', '-', '/', '\\', ',', '.', ';', "'", '[', ']', '`'].includes(key)) key = event.code;
  parts.push(key);
  return parts.join('+');
}
export function shortcutMatches(event: KeyboardEvent, value?: string): boolean {
  if (!value) return false;
  const normalize = (s: string) => {
    const tokens = s
      .toLowerCase()
      .replace(/windows|super|meta/g, 'win')
      .replace(/control/g, 'ctrl')
      .split('+');
    const key = tokens.pop();
    return [...tokens.sort(), key].join('+');
  };
  return normalize(eventShortcut(event) ?? '') === normalize(value);
}
export function shortcutAction(event: KeyboardEvent, p: CapturePreferences): string | undefined {
  return Object.entries(p.shortcuts).find(([, value]) => shortcutMatches(event, value))?.[0];
}
