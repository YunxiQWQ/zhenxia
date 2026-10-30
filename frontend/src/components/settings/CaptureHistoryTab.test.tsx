import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
