import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceTab } from './AppearanceTab';
import { capturePreferences } from '../../utils/capturePreferences';
import type { Settings } from '../../types';
vi.mock('../../hooks/useSystemTheme', () => ({ useSystemTheme: () => 'light' }));
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn() });
});

function setup() {
  const update = vi.fn();
  render(
    <AppearanceTab
      settings={{ capture: capturePreferences() } as Settings}
      updateSetting={update}
      updateSettings={vi.fn()}
    />
  );
  return update;
}
function dragTool(source: string, target: string, clientX = 0) {
  const from = document.querySelector(`[data-tool-order="${source}"]`)!;
  const to = document.querySelector(`[data-tool-order="${target}"]`)!;
  vi.mocked(document.elementFromPoint).mockReturnValue(to);
  fireEvent.pointerDown(from, { button: 0, pointerId: 1, clientX: -30, clientY: 20 });
  fireEvent.pointerMove(from, { pointerId: 1, clientX, clientY: 20 });
  fireEvent.pointerUp(from, { pointerId: 1, clientX, clientY: 20 });
}
it('reorders by dragging before a visible tool and removes arrow controls', () => {
  const update = setup();
  expect(
    screen.queryByRole('button', { name: /左移|右移|move left|move right/ })
  ).not.toBeInTheDocument();
  dragTool('arrow', 'rect');
  const next = update.mock.calls[0][1];
  expect(
    next.toolbar_order.filter((id: string) => !next.toolbar_hidden.includes(id)).slice(0, 3)
  ).toEqual(['select', 'arrow', 'rect']);
});
it('can drop after a visible tool while preserving hidden tools', () => {
  const update = setup();
  dragTool('rect', 'arrow', 20);
  const next = update.mock.calls[0][1];
  expect(
    next.toolbar_order.filter((id: string) => !next.toolbar_hidden.includes(id)).slice(0, 3)
  ).toEqual(['select', 'arrow', 'rect']);
  expect(next.toolbar_order).toContain('ellipse');
});
it('does not save when a drag is cancelled', () => {
  const update = setup();
  const item = document.querySelector('[data-tool-order="rect"]')!;
  fireEvent.pointerDown(item, { button: 0, pointerId: 1 });
  fireEvent.pointerCancel(item, { pointerId: 1 });
  expect(update).not.toHaveBeenCalled();
});
it('accepts pointer moves and release before React commits the drag indicator', () => {
  const update = setup();
  act(() => dragTool('pen', 'rect'));
  const next = update.mock.calls[0][1];
  expect(next.toolbar_order.indexOf('pen')).toBeLessThan(next.toolbar_order.indexOf('rect'));
});
it('presents the appearance sample as icons and retains the real capture button', () => {
  setup();
  expect(screen.queryByRole('button', { name: /^保存图片$|^Save image$/ })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /保存图片|Save image/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /试用截图|Try capture/ })).toBeEnabled();
});
