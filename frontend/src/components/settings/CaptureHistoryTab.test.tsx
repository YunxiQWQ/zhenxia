import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureHistoryTab } from './CaptureHistoryTab';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(cleanup);

it('refreshes an already open gallery when the screenshot service adds a clipboard record', async () => {
  let count = 1;
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command !== 'list_capture_history') return null;
    return Array.from({ length: count }, (_, i) => ({
      id: `capture-${i}`,
      thumbnail: 'data:image/png;base64,',
      created_at: '2026-10-28 00:00:00',
      width: 100 + i,
      height: 50,
      kind: 'screenshot',
      pinned: false,
    }));
  });
  render(<CaptureHistoryTab active />);
  await screen.findByAltText('100×50');
  count = 2;
  const listener = vi.mocked(listen).mock.calls.find(([name]) => name === 'clipboard-change')?.[1];
  expect(listener).toBeDefined();
  await act(async () => listener?.({ event: 'clipboard-change', id: 1, payload: {} }));
  await waitFor(() => expect(screen.getByAltText('101×50')).toBeVisible());
});

it('pages captures in the selected category and resets the offset for a size search', async () => {
  const list = vi.fn(({ offset, limit, query }: { offset: number; limit: number; query: string }) =>
    Array.from({ length: query ? 1 : limit }, (_, index) => ({
      id: `recording-${offset + index}`,
      thumbnail: 'data:image/png;base64,',
      created_at: '2026-11-20T12:00:00+00:00',
      width: 1280,
      height: 720,
      kind: 'recording',
      pinned: false,
    }))
  );
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === 'list_capture_history' ? list(args as Parameters<typeof list>[0]) : null
  );
  render(<CaptureHistoryTab active />);
  fireEvent.click(screen.getByRole('button', { name: '录屏' }));
  const more = await screen.findByRole('button', { name: '加载更多' });
  fireEvent.click(more);
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({ offset: 18, limit: 18, kind: 'recording', query: '' })
  );
  fireEvent.change(screen.getByRole('textbox', { name: '筛选截图日期或尺寸' }), {
    target: { value: '1280×720' },
  });
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({
      offset: 0,
      limit: 18,
      kind: 'recording',
      query: '1280×720',
    })
  );
  expect(screen.getAllByAltText('录屏预览')).toHaveLength(1);
});
