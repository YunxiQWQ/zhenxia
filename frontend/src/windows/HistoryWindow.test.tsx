import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { HistoryWindow } from './HistoryWindow';

const native = vi.hoisted(() => ({
  hide: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: native.hide,
    close: native.close,
    onFocusChanged: async () => () => {},
    startDragging: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('../hooks/useUpdater', () => ({ useUpdater: () => {} }));
vi.mock('../components/ClipPreview', () => ({
  ClipPreview: () => <textarea data-el="note-draft" aria-label="Note draft" />,
}));
const fixture = {
  id: 'first',
  clip_type: 'text',
  content: 'History fixture',
  preview: 'History fixture',
  folder_id: null,
  is_pinned: false,
  created_at: '2026-10-27T00:00:00Z',
  source_app: 'Fixture',
  source_icon: null,
  metadata: null,
  ocr_match: null,
};
beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  delete document.documentElement.dataset.captureMode;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'get_settings')
      return { theme: 'dark', has_completed_onboarding: true, self_update_available: false };
    if (command === 'get_clips' || command === 'search_clips') return [fixture];
    if (command === 'get_folders' || command === 'get_source_apps') return [];
    if (command === 'get_clipboard_history_size') return 1;
    if (command === 'get_system_accent_color')
      return { red: 70, green: 130, blue: 180, alpha: 255 };
    return null;
  });
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.captureMode;
});
const open = async () => {
  const r = render(<HistoryWindow />);
  await waitFor(() =>
    expect(r.container.querySelector('[data-clip-id="first"][data-selected="true"]')).not.toBeNull()
  );
  return r;
};
describe('unified Win+V history keyboard contract', () => {
  it('opens settings through the native foreground window route', async () => {
    const { container } = await open();
    fireEvent.click(container.querySelector('button[aria-label="Settings"]')!);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_settings_window'));
  });
  it('drags from title text, icon and empty header while keeping actions clickable', async () => {
    const { container } = await open();
    const header = container.querySelector('[data-el="history-titlebar"]')!;
    const title = header.querySelector('span')!;
    const icon = header.querySelector('svg')!;
    for (const target of [header, title, icon]) fireEvent.mouseDown(target, { button: 0 });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'start_history_drag')).toHaveLength(
      3
    );
    vi.mocked(invoke).mockClear();
    fireEvent.mouseDown(title, { button: 2 });
    for (const button of header.querySelectorAll('button')) {
      fireEvent.mouseDown(button.querySelector('svg') ?? button, { button: 0 });
    }
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'start_history_drag')).toBe(false);
    fireEvent.click(header.querySelector('button[aria-label="Screenshot (F1)"]')!);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('start_screenshot'));
    fireEvent.click(header.querySelector('button[aria-label="Close history"]')!);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('hide_history_window'));
  });

  it('keeps clicks in the search and note editor out of the title drag route', async () => {
    const { container } = await open();
    for (const target of [
      container.querySelector('[data-el="search-input"]')!,
      container.querySelector('textarea')!,
    ]) {
      fireEvent.mouseDown(target, { button: 0 });
      fireEvent.click(target);
    }
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([c]) => c === 'start_history_drag' || c === 'hide_history_window')
    ).toBe(false);
  });
  it('defers history queries while hidden and preserves the search on resume', async () => {
    const r = render(<HistoryWindow active={false} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_settings'));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'get_clips')).toBe(false);
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'get_folders')).toBe(false);
    r.rerender(<HistoryWindow active />);
    await waitFor(() => expect(r.container.querySelector('[data-clip-id="first"]')).not.toBeNull());
    fireEvent.change(r.container.querySelector('[data-el="search-input"]')!, {
      target: { value: 'draft search' },
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'search_clips',
        expect.objectContaining({ query: 'draft search' })
      )
    );
    r.rerender(<HistoryWindow active={false} />);
    vi.mocked(invoke).mockClear();
    fireEvent.focus(window);
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === 'get_clips' || c === 'search_clips')
    ).toBe(false);
    r.rerender(<HistoryWindow active />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'search_clips',
        expect.objectContaining({ query: 'draft search' })
      )
    );
    expect((r.container.querySelector('[data-el="search-input"]') as HTMLInputElement).value).toBe(
      'draft search'
    );
  });
  it('pastes on Enter from search instead of copying as the old tray view did', async () => {
    const { container } = await open();
    fireEvent.keyDown(container.querySelector('[data-el="search-input"]')!, { key: 'Enter' });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('paste_clip', { id: 'first', plainText: false })
    );
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'copy_clip')).toBe(false);
  });
  it('copies without dismissing the unified history on Ctrl+Enter', async () => {
    const { container } = await open();
    fireEvent.keyDown(container.querySelector('[data-el="search-input"]')!, {
      key: 'Enter',
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('copy_clip', {
        id: 'first',
        plainText: false,
        keepOpen: true,
      })
    );
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'paste_clip')).toBe(false);
  });
  it('hides the main window on Escape rather than closing the application', async () => {
    await open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(invoke).toHaveBeenCalledWith('hide_history_window');
    expect(native.close).not.toHaveBeenCalled();
  });
  it('does not consume editor keys while a screenshot occupies the same document', async () => {
    await open();
    document.documentElement.dataset.captureMode = 'true';
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === 'paste_clip' || c === 'delete_clip')
    ).toBe(false);
    expect(native.hide).not.toHaveBeenCalled();
  });
  it('leaves Enter and Delete in note editing fields', async () => {
    const { container } = await open();
    const note = container.querySelector('textarea')!;
    fireEvent.keyDown(note, { key: 'Enter' });
    fireEvent.keyDown(note, { key: 'Delete' });
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === 'paste_clip' || c === 'delete_clip')
    ).toBe(false);
  });
  it('previews on a single row click and pastes only on double click', async () => {
    const { container } = await open();
    const row = container.querySelector('[data-clip-id="first"]')!;
    fireEvent.click(row);
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === 'paste_clip')).toBe(false);
    fireEvent.doubleClick(row);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('paste_clip', { id: 'first', plainText: false })
    );
  });
});
