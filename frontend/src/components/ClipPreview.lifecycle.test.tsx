import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ClipPreview } from './ClipPreview';
import type { ClipboardItem } from '../types';

vi.mock('./ImageTextViewer', () => ({
  ImageTextViewer: ({ src }: { src: string }) => <img alt="full preview" src={src} />,
}));
afterEach(cleanup);

it('saves a note on Enter and cancels an unsaved note on Escape', async () => {
  const clip = {
    id: 'note',
    clip_type: 'text',
    content: 'body',
    preview: 'body',
    notes: null,
  } as ClipboardItem;
  const noop = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockResolvedValue({ content: 'body', ocr_text: null });
  const r = render(
    <ClipPreview
      clip={clip}
      onCopy={noop}
      onCopyOcrText={noop}
      onCopySelection={noop}
      onOpenImage={noop}
      onSaveOcrText={noop}
      onRescanOcr={noop}
      onCopyText={noop}
      onSaveText={noop}
      onSaveNotes={save}
      onToggleHidden={noop}
      onDelete={noop}
    />
  );
  const note = r.getByRole('textbox', { name: 'Note' });
  note.focus();
  fireEvent.change(note, { target: { value: '  可搜索的中文备注  ' } });
  fireEvent.keyDown(note, { key: 'Enter' });
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('note', '可搜索的中文备注'));
  save.mockClear();
  note.focus();
  fireEvent.change(note, { target: { value: 'do not save' } });
  fireEvent.keyDown(note, { key: 'Escape' });
  expect(save).not.toHaveBeenCalled();
  expect((note as HTMLInputElement).value).toBe('');
  expect(r.queryByRole('button', { name: 'Paste' })).toBeNull();
  expect(r.queryByRole('button', { name: 'Pin' })).toBeNull();
});
it('releases hidden image previews, rejects a late fetch, and keeps the OCR correction draft', async () => {
  const clip = {
    id: 'image',
    clip_type: 'image',
    content: 'thumbnail',
    preview: 'Image',
    is_hidden: false,
    has_ocr_text: true,
    notes: '',
  } as ClipboardItem;
  const details = { content: 'data:image/png;base64,AQID', ocr_text: 'original', ocr_layout: null };
  let resolveLate: (value: typeof details) => void = () => {};
  vi.mocked(invoke).mockResolvedValue(details);
  const noop = vi.fn();
  const props = {
    clip,
    onCopy: noop,
    onCopyOcrText: noop,
    onCopySelection: noop,
    onOpenImage: noop,
    onSaveOcrText: noop,
    onRescanOcr: noop,
    onCopyText: noop,
    onSaveText: noop,
    onSaveNotes: noop,
    onToggleHidden: noop,
    onTogglePin: noop,
    onDelete: noop,
  };
  const r = render(<ClipPreview {...props} />);
  await waitFor(() => expect(r.getByAltText('full preview')).toBeTruthy());
  fireEvent.click(r.getByRole('button', { name: 'Scan text' }));
  const correction = r.container.querySelector('textarea')!;
  fireEvent.change(correction, { target: { value: 'unsaved correction' } });
  r.rerender(<ClipPreview {...props} active={false} />);
  expect(r.queryByAltText('full preview')).toBeNull();
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      })
  );
  r.rerender(<ClipPreview {...props} active />);
  await waitFor(() =>
    expect(r.container.querySelector('textarea')?.value).toBe('unsaved correction')
  );
  r.rerender(<ClipPreview {...props} active={false} />);
  resolveLate(details);
  await Promise.resolve();
  expect(r.queryByAltText('full preview')).toBeNull();
  vi.mocked(invoke).mockResolvedValue(details);
  r.rerender(<ClipPreview {...props} active />);
  await waitFor(() => expect(r.getByAltText('full preview')).toBeTruthy());
  expect(r.container.querySelector('textarea')?.value).toBe('unsaved correction');
});
