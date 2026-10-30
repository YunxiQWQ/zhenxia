import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SharedMainWindow from './SharedMainWindow';
const callbacks = vi.hoisted(() => new Map<string, () => void>());
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    callbacks.set(event, handler);
    return () => callbacks.delete(event);
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isVisible: async () => false, onFocusChanged: async () => () => {} }),
}));
vi.mock('./CaptureOverlay', () => ({
  CaptureOverlay: () => <div data-testid="capture-prepared" />,
}));
vi.mock('./HistoryWindow', () => ({
  HistoryWindow: ({ active }: { active: boolean }) => (
    <div data-testid="history-shell" data-active={String(active)}>
      <input aria-label="draft" defaultValue="" />
    </div>
  ),
}));
beforeEach(() => {
  callbacks.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('prepares an inactive shell after idle without waiting for the first show', async () => {
  render(<SharedMainWindow />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  expect(screen.getByTestId('history-shell')).toHaveAttribute('data-active', 'false');
  expect(screen.getByTestId('capture-prepared')).toBeInTheDocument();
});
it('defers background preparation while a capture is in progress', async () => {
  render(<SharedMainWindow />);
  fireEvent(window, new CustomEvent('zhenxia:capture-session'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(screen.queryByTestId('history-shell')).not.toBeInTheDocument();
  fireEvent(window, new Event('zhenxia:capture-reset'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  expect(screen.getByTestId('history-shell')).toHaveAttribute('data-active', 'false');
});

it('keeps drafts mounted across visibility transitions', async () => {
  render(<SharedMainWindow />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  const input = screen.getByLabelText('draft');
  fireEvent.change(input, { target: { value: 'Unsaved draft' } });
  act(() => callbacks.get('zhenxia:main-visible')?.());
  expect(screen.getByTestId('history-shell')).toHaveAttribute('data-active', 'true');
  act(() => callbacks.get('zhenxia:main-idle')?.());
  expect(screen.getByTestId('history-shell')).toHaveAttribute('data-active', 'false');
  act(() => callbacks.get('zhenxia:main-visible')?.());
  expect(screen.getByLabelText('draft')).toBe(input);
  expect(input).toHaveValue('Unsaved draft');
});
