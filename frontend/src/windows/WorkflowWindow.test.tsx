import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { WorkflowWindow } from './WorkflowWindow';
vi.mock('../i18n', () => ({ useTranslation: () => ({ lang: 'zh-CN' }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }));
let state: Record<string, unknown>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state = { kind: 'record', width: 640, height: 480, started: false, elapsed: 0 };
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'workflow_status') return { ...state };
    if (command === 'begin_recording') state.started = true;
    if (command === 'pause_recording') state.paused = true;
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
}
it('starts a chosen format and exposes pause and save controls after recording begins', async () => {
  render(<WorkflowWindow />);
  await tick();
  fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'gif' } });
  fireEvent.change(screen.getByLabelText('帧率'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
  await tick();
  expect(invoke).toHaveBeenCalledWith('begin_recording', { format: 'gif', fps: 8 });
  fireEvent.click(screen.getByRole('button', { name: '暂停' }));
  await tick();
  expect(invoke).toHaveBeenCalledWith('pause_recording', { paused: true });
  expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '停止并保存' }));
  await tick();
  expect(invoke).toHaveBeenCalledWith('finish_recording', undefined);
});
it('cancel uses the cancellation path without copying or exporting', async () => {
  render(<WorkflowWindow />);
  await tick();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await tick();
  expect(invoke).toHaveBeenCalledWith('cancel_workflow', undefined);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(
        ([name]) => String(name).includes('clipboard') || name === 'export_recording'
      )
  ).toBe(false);
});
it('keeps the scrolling preview and offers undo only when a checkpoint exists', async () => {
  state = {
    kind: 'scroll',
    width: 640,
    height: 960,
    frames: 2,
    canUndo: true,
    auto: true,
    preview: 'data:image/png;base64,aA==',
  };
  render(<WorkflowWindow />);
  await tick();
  expect(screen.getByAltText('拼接预览')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '撤销上一张并暂停采集' }));
  await tick();
  expect(invoke).toHaveBeenCalledWith('undo_scroll', undefined);
});
