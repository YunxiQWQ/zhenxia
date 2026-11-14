import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setGlobalLang } from '../i18n';
import { QrResultDialog } from './QrResultDialog';
afterEach(cleanup);
it('keeps decoded URLs as selectable text and closes with Escape before underlying capture sees it', () => {
  setGlobalLang('en');
  const close = vi.fn();
  const parent = vi.fn();
  const { container } = render(
    <div onKeyDown={parent}>
      <QrResultDialog codes={['https://example.com/测试', 'plain text']} onClose={close} />
    </div>
  );
  expect(screen.getByLabelText('QR content 1')).toHaveValue('https://example.com/测试');
  expect(screen.getByLabelText('QR content 2')).toHaveValue('plain text');
  expect(container.querySelector('a')).toBeNull();
  fireEvent.keyDown(screen.getByLabelText('QR content 1'), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  expect(parent).not.toHaveBeenCalled();
});
it('shows an explicit empty result and keeps keyboard focus in the dialog', () => {
  setGlobalLang('zh-CN');
  render(<QrResultDialog codes={[]} onClose={vi.fn()} />);
  const close = screen.getByRole('button', { name: '关闭二维码结果' });
  expect(close).toHaveFocus();
  expect(screen.getByText(/未识别到二维码/)).toBeInTheDocument();
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(close).toHaveFocus();
});
