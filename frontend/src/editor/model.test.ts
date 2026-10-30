import { describe, expect, it } from 'vitest';
import {
  boundedCrop,
  hitMark,
  imageHistory,
  markBounds,
  moveMark,
  resizeMark,
  type History,
  type ImageDocument,
  type Mark,
} from './model';
const base = (w = 100, h = 80) => ({ width: w, height: h }) as HTMLCanvasElement;
const mark: Mark = {
  id: 'a',
  kind: 'arrow',
  start: { x: 10, y: 10 },
  end: { x: 90, y: 70 },
  points: [],
  color: '#ff0000',
  width: 4,
  fontSize: 24,
  bold: false,
  fill: false,
  text: '',
  number: 1,
};
describe('image editing transactions', () => {
  it('restores raster and marks together after a destructive crop', () => {
    const original: ImageDocument = { base: base(), marks: [mark] };
    let state: History<ImageDocument> = { past: [], present: original, future: [] };
    const cropped = { base: base(20, 30), marks: [] };
    state = imageHistory(state, { type: 'commit', value: cropped });
    state = imageHistory(state, { type: 'undo' });
    expect(state.present).toBe(original);
    expect(imageHistory(state, { type: 'redo' }).present).toBe(cropped);
  });
  it('drops stale redo entries after drawing on an undone document', () => {
    const original = { base: base(), marks: [] },
      edited = { ...original, marks: [mark] };
    let state: History<ImageDocument> = { past: [], present: original, future: [] };
    state = imageHistory(state, { type: 'commit', value: edited });
    state = imageHistory(state, { type: 'undo' });
    state = imageHistory(state, {
      type: 'commit',
      value: { ...original, marks: [{ ...mark, id: 'b' }] },
    });
    expect(state.future).toEqual([]);
    expect(imageHistory(state, { type: 'redo' })).toBe(state);
  });
  it('bounds transformed raster history instead of retaining every large image', () => {
    let state: History<ImageDocument> = {
      past: [],
      present: { base: base(2560, 1440), marks: [] },
      future: [],
    };
    for (let i = 0; i < 20; i++)
      state = imageHistory(state, { type: 'commit', value: { base: base(2560, 1440), marks: [] } });
    expect(state.past.length).toBeLessThan(7);
    expect(state.past.length).toBeGreaterThan(0);
  });
});
describe('selection geometry', () => {
  it('selects a diagonal line by distance rather than its entire bounding box', () => {
    expect(hitMark(mark, { x: 50, y: 40 }, 3)).toBe(true);
    expect(hitMark(mark, { x: 20, y: 65 }, 3)).toBe(false);
  });
  it('moves every pen point without modifying the original undo snapshot', () => {
    const pen = {
      ...mark,
      kind: 'pen' as const,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 15 },
      ],
    };
    expect(moveMark(pen, 5, -3).points).toEqual([
      { x: 15, y: 7 },
      { x: 25, y: 12 },
    ]);
    expect(pen.points[0]).toEqual({ x: 10, y: 10 });
  });
  it('resizes geometry in image coordinates independently of viewport zoom', () => {
    const resized = resizeMark(mark, markBounds(mark), { x: 170, y: 130 });
    expect(resized.start).toEqual(mark.start);
    expect(resized.end).toEqual({ x: 170, y: 130 });
  });
  it('includes every line of multilingual text in its selectable bounds', () => {
    const text = { ...mark, kind: 'text' as const, text: '中文\nEnglish' };
    expect(markBounds(text).h).toBeCloseTo(62.4);
    expect(hitMark(text, { x: 20, y: 60 }, 2)).toBe(true);
  });
});
describe('bounded aspect-ratio crop', () => {
  it('keeps the requested ratio at the bottom edge', () => {
    const r = boundedCrop({ x: 80, y: 90 }, { x: 190, y: 99 }, 200, 100, 1);
    expect(r).toEqual({ x: 80, y: 90, w: 10, h: 10 });
  });
  it('keeps the ratio when dragging up and left beyond the edge', () => {
    const r = boundedCrop({ x: 20, y: 10 }, { x: 0, y: 0 }, 200, 100, 1);
    expect(r).toEqual({ x: 10, y: 0, w: 10, h: 10 });
  });
  it('supports unrestricted reverse drags without negative dimensions', () => {
    expect(boundedCrop({ x: 80, y: 70 }, { x: -10, y: -20 }, 200, 100, 0)).toEqual({
      x: 0,
      y: 0,
      w: 80,
      h: 70,
    });
  });
});
