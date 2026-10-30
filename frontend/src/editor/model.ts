export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type DrawTool =
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'marker'
  | 'highlight'
  | 'mosaic'
  | 'eraser';
export type Tool = DrawTool | 'select' | 'pan' | 'crop';
export interface Mark {
  id: string;
  kind: DrawTool;
  start: Point;
  end: Point;
  points: Point[];
  color: string;
  width: number;
  fontSize: number;
  bold: boolean;
  fill: boolean;
  text: string;
  number: number;
}
export interface ImageDocument {
  watermark?: import('./watermark').Watermark;
  base: HTMLCanvasElement;
  marks: Mark[];
}
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
export type HistoryAction<T> = { type: 'commit'; value: T } | { type: 'undo' | 'redo' };

// Bound retained raster memory as well as transaction count. Marks share immutable
// arrays; only crop/rotate/resize allocate another raster.
export function imageHistory(
  state: History<ImageDocument>,
  action: HistoryAction<ImageDocument>
): History<ImageDocument> {
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1],
      future: [state.present, ...state.future],
    };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  if (action.type !== 'commit' || action.value === state.present) return state;
  const past = [...state.past, state.present].slice(-30);
  const retained = () =>
    [...new Set([...past, action.value].map((d) => d.base))].reduce(
      (n, c) => n + c.width * c.height * 4,
      0
    );
  while (past.length > 1 && retained() > 96 * 1024 * 1024) past.shift();
  return { past, present: action.value, future: [] };
}
export const rectFromPoints = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});
export function markBounds(mark: Mark): Rect {
  if (mark.kind === 'text') {
    const lines = mark.text.split('\n');
    return {
      x: mark.start.x,
      y: mark.start.y,
      w: Math.max(
        20,
        ...lines.map(
          (s) =>
            Array.from(s).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : 0.62), 0) *
            mark.fontSize
        )
      ),
      h: lines.length * mark.fontSize * 1.3,
    };
  }
  if (mark.kind === 'marker') {
    const r = mark.fontSize * 0.75;
    return { x: mark.start.x - r, y: mark.start.y - r, w: r * 2, h: r * 2 };
  }
  const points = ['pen', 'highlight', 'mosaic', 'eraser'].includes(mark.kind)
    ? mark.points
    : [mark.start, mark.end];
  if (!points.length) return { ...mark.start, w: 0, h: 0 };
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitMark(mark: Mark, p: Point, tolerance: number): boolean {
  const r = markBounds(mark),
    pad = Math.max(tolerance, mark.width / 2);
  if (p.x < r.x - pad || p.x > r.x + r.w + pad || p.y < r.y - pad || p.y > r.y + r.h + pad)
    return false;
  if (mark.kind === 'line' || mark.kind === 'arrow')
    return segmentDistance(p, mark.start, mark.end) <= pad;
  if (['pen', 'highlight', 'mosaic', 'eraser'].includes(mark.kind)) {
    const brush =
      mark.kind === 'mosaic' || mark.kind === 'eraser'
        ? mark.width * 3
        : mark.kind === 'highlight'
          ? mark.width * 2
          : pad;
    return mark.points.some(
      (a, i) => segmentDistance(p, a, mark.points[i + 1] ?? a) <= Math.max(pad, brush)
    );
  }
  return true;
}
export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { ...mark, start: move(mark.start), end: move(mark.end), points: mark.points.map(move) };
}
export function resizeMark(mark: Mark, original: Rect, end: Point): Mark {
  const sx = Math.max(0.1, (end.x - original.x) / Math.max(1, original.w));
  const sy = Math.max(0.1, (end.y - original.y) / Math.max(1, original.h));
  const map = (p: Point) => ({
    x: original.x + (p.x - original.x) * sx,
    y: original.y + (p.y - original.y) * sy,
  });
  return {
    ...mark,
    start: map(mark.start),
    end: map(mark.end),
    points: mark.points.map(map),
    fontSize:
      mark.kind === 'text' || mark.kind === 'marker'
        ? Math.max(8, Math.min(160, mark.fontSize * sy))
        : mark.fontSize,
  };
}
export function constrainRect(start: Point, end: Point, ratio = 0): Rect {
  if (!ratio) return rectFromPoints(start, end);
  const w = Math.abs(end.x - start.x),
    h = w / ratio;
  return rectFromPoints(start, { x: end.x, y: start.y + (end.y < start.y ? -h : h) });
}
export function boundedCrop(
  start: Point,
  end: Point,
  width: number,
  height: number,
  ratio: number
): Rect {
  if (!ratio)
    return rectFromPoints(start, {
      x: Math.max(0, Math.min(width, end.x)),
      y: Math.max(0, Math.min(height, end.y)),
    });
  const dx = end.x < start.x ? -1 : 1,
    dy = end.y < start.y ? -1 : 1;
  const maxW = dx < 0 ? start.x : width - start.x,
    maxH = dy < 0 ? start.y : height - start.y;
  const w = Math.min(Math.abs(end.x - start.x), maxW, maxH * ratio);
  return rectFromPoints(start, { x: start.x + dx * w, y: start.y + (dy * w) / ratio });
}
