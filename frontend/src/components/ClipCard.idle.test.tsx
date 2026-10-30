import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClipCard } from './ClipCard';
import type { ClipboardItem } from '../types';

afterEach(cleanup);

it('detaches hidden thumbnails and restores the same selected row on show', () => {
  const clip: ClipboardItem = {
    id: 'idle-image',
    clip_type: 'image',
    content: 'data:image/png;base64,aW1hZ2U=',
    preview: '',
    folder_id: null,
    is_pinned: false,
    created_at: new Date().toISOString(),
    source_app: null,
    source_icon: null,
    metadata: null,
    ocr_match: null,
  };
  const props = {
    clip,
    density: 'comfortable' as const,
    isSelected: true,
    posInSet: 1,
    setSize: 1,
    onPaste: vi.fn(),
    onCopy: vi.fn(),
    onTogglePin: vi.fn(),
  };
  const { container, rerender } = render(<ClipCard {...props} active />);
  const row = container.querySelector('[role="option"]');
  expect(container.querySelector('img')).toHaveAttribute('src', clip.content);
  rerender(<ClipCard {...props} active={false} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[role="option"]')).toBe(row);
  expect(row).toHaveAttribute('aria-selected', 'true');
  rerender(<ClipCard {...props} active />);
  expect(container.querySelector('img')).toHaveAttribute('src', clip.content);
});
