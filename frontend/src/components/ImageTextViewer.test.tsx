import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageTextViewer } from './ImageTextViewer';
const words = [{ text: 'Fixture', x: 0.1, y: 0.1, width: 0.25, height: 0.2, line: 0 }];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('image text selection in a shared window', () => {
  it('keeps the preview image when its redundant floating toolbar is removed', () => {
    const { queryByRole, container } = render(
      <ImageTextViewer
        src="fixture.png"
        words={[]}
        showControls={false}
        onCopySelection={vi.fn()}
      />
    );
    expect(container.querySelector('[data-el="image-viewer"] img')).not.toBeNull();
    for (const name of ['Pan mode', 'Zoom in', 'Zoom out', 'Fit to pane', '1:1'])
      expect(queryByRole('button', { name })).toBeNull();
  });
  it('keeps a hidden preview from consuming capture/editor keys', () => {
    const copy = vi.fn();
    const view = (inert: boolean) => (
      <div inert={inert}>
        <ImageTextViewer
          src="fixture.png"
          words={words}
          initialZoom="actual"
          onCopySelection={copy}
        />
      </div>
    );
    const { container, rerender } = render(view(false));
    const img = container.querySelector('img')!;
    Object.defineProperties(img, {
      naturalWidth: { value: 200, configurable: true },
      naturalHeight: { value: 100, configurable: true },
    });
    fireEvent.load(img);
    const surface = img.parentElement!;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON() {},
    });
    fireEvent.pointerDown(surface, { button: 0, clientX: 70, clientY: 40 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 70, clientY: 40 });
    expect(container.querySelector('[data-el="ocr-selection-band"]')).not.toBeNull();
    rerender(view(true));
    const copyWhileHidden = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(copyWhileHidden);
    expect(copy).not.toHaveBeenCalled();
    expect(copyWhileHidden.defaultPrevented).toBe(false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-el="ocr-selection-band"]')).not.toBeNull();
    rerender(view(false));
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(copy).toHaveBeenCalledWith('Fixture');
  });
});
