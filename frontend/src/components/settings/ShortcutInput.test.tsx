import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { ShortcutInput } from './ShortcutInput';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(async () => {
  cleanup();
  await act(async () => {});
});

it('restores global shortcuts when the settings page becomes inactive', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const props = { value: 'F1', defaultValue: 'F1', label: 'Capture', onChange: vi.fn() };
  const view = render(<ShortcutInput {...props} enabled />);
  fireEvent.click(screen.getByRole('button', { name: /Capture.*快捷键|Capture shortcut/ }));
  await waitFor(() => expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument());
  view.rerender(<ShortcutInput {...props} enabled={false} />);
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('set_shortcut_recording', { active: false })
  );
  expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  expect(props.onChange).not.toHaveBeenCalled();
});

it('does not start a hidden recorder after an asynchronous native request returns', async () => {
  let resolve: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { active?: boolean })?.active)
      await new Promise<void>((done) => {
        resolve = done;
      });
  });
  const props = { value: 'F1', defaultValue: 'F1', label: 'Capture', onChange: vi.fn() };
  const view = render(<ShortcutInput {...props} enabled />);
  fireEvent.click(screen.getByRole('button', { name: /Capture.*快捷键|Capture shortcut/ }));
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(<ShortcutInput {...props} enabled={false} />);
  await act(async () => resolve?.());
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('set_shortcut_recording', { active: false })
  );
  expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
});

it('cancels a pending recording request when the window loses focus', async () => {
  let resolve: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { active?: boolean })?.active)
      await new Promise<void>((done) => {
        resolve = done;
      });
  });
  render(<ShortcutInput value="F1" defaultValue="F1" label="Capture" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Capture.*快捷键|Capture shortcut/ }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.blur(window);
  await act(async () => resolve?.());
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('set_shortcut_recording', { active: false })
  );
  expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
});
