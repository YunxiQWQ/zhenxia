import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTimeTick } from './useTimeTick';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('stops the shared timer when hidden and refreshes immediately when shown again', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ active }) => useTimeTick(active), {
    initialProps: { active: true },
  });
  const initial = result.current;
  act(() => vi.advanceTimersByTime(15000));
  expect(result.current).toBe(initial + 1);
  rerender({ active: false });
  const hidden = result.current;
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(60000));
  expect(result.current).toBe(hidden);
  rerender({ active: true });
  expect(result.current).not.toBe(hidden);
  expect(vi.getTimerCount()).toBe(1);
});

it('keeps the single timer alive for another visible list', () => {
  vi.useFakeTimers();
  const first = renderHook(({ active }) => useTimeTick(active), { initialProps: { active: true } });
  const second = renderHook(() => useTimeTick());
  first.rerender({ active: false });
  expect(vi.getTimerCount()).toBe(1);
  const previous = second.result.current;
  act(() => vi.advanceTimersByTime(15000));
  expect(second.result.current).toBe(previous + 1);
  second.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
