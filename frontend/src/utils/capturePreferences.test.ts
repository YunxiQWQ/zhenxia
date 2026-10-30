import { describe, it, expect } from 'vitest';
import {
  capturePreferences,
  mergeCaptureUpdate,
  shortcutMatches,
  eventShortcut,
} from './capturePreferences';
describe('capture preference edits', () => {
  it('keeps a queued theme edit when a later render changes hidden tools', () => {
    const original = capturePreferences();
    const first = mergeCaptureUpdate(original, original, { ...original, toolbar_theme: 'light' });
    const second = mergeCaptureUpdate(first, original, { ...original, toolbar_hidden: ['mosaic'] });
    expect(second.toolbar_theme).toBe('light');
    expect(second.toolbar_hidden).toEqual(['mosaic']);
  });
  it('keeps separately queued shortcut and palette edits', () => {
    const original = capturePreferences();
    let current = mergeCaptureUpdate(original, original, {
      ...original,
      shortcuts: { ...original.shortcuts, pen: 'F6' },
    });
    current = mergeCaptureUpdate(current, original, {
      ...original,
      shortcuts: { ...original.shortcuts, rect: 'F7' },
      toolbar_colors: { ...original.toolbar_colors, background: '#123456' },
    });
    expect(current.shortcuts.pen).toBe('F6');
    expect(current.shortcuts.rect).toBe('F7');
    expect(current.toolbar_colors.background).toBe('#123456');
  });
  it('lets an explicit reset override an earlier queued binding even before it rendered', () => {
    const original = capturePreferences();
    const changed = mergeCaptureUpdate(original, original, {
      ...original,
      global_hotkeys: { translate: 'Ctrl+Alt+T' },
    });
    const reset = mergeCaptureUpdate(changed, original, original, ['global_hotkeys']);
    expect(reset.global_hotkeys).toEqual({});
  });
});
describe('keyboard binding matching', () => {
  it('matches modifier order and physical letter keys in a non-Latin layout', () => {
    const event = {
      key: 'ф',
      code: 'KeyA',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    };
    expect(shortcutMatches(event as KeyboardEvent, 'Shift+Ctrl+A')).toBe(true);
    expect(eventShortcut(event)).toBe('Ctrl+Shift+A');
  });
  it('requires the exact modifiers and ignores modifier-only presses', () => {
    const event = {
      key: 'F6',
      code: 'F6',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };
    expect(shortcutMatches(event as KeyboardEvent, 'F6')).toBe(true);
    expect(shortcutMatches(event as KeyboardEvent, 'Ctrl+F6')).toBe(false);
    expect(
      eventShortcut({ ...event, key: 'Control', code: 'ControlLeft', ctrlKey: true })
    ).toBeNull();
  });
});
