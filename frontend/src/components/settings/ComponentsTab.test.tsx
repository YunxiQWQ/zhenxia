import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { ComponentsTab } from './ComponentsTab';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(cleanup);

it('exposes working installation controls alongside component version details', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'component_status')
      return [
        {
          id: 'ocr-tiny',
          kind: 'ocr',
          name: 'PP-OCRv6 Tiny',
          version: '1.2.0',
          installed: false,
          bytes: 0,
          busy: false,
        },
        {
          id: 'translate-zh-en',
          kind: 'translation',
          name: 'Chinese / English',
          version: 'Bergamot 0.5.1',
          installed: false,
          bytes: 0,
          busy: false,
        },
      ];
    return null;
  });
  render(<ComponentsTab settings={{} as never} updateSetting={vi.fn()} active />);
  const buttons = await screen.findAllByRole('button', { name: /Download and install|下载并安装/ });
  expect(buttons).toHaveLength(2);
  expect(screen.getByText('1.2.0')).toBeVisible();
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_component', { id: 'ocr-tiny' }));
});
