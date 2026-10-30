import type { ImageDocument, Mark, Point, Rect } from './model';
import {paintWatermark} from './watermark';

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function path(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y);
}
const samples = new WeakMap<HTMLCanvasElement, ImageData>();
export function releaseRaster(canvas: HTMLCanvasElement) {
  samples.delete(canvas);
  canvas.width = 0;
  canvas.height = 0;
}
function mosaic(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, mark: Mark) {
  let source = samples.get(base);
  if (!source) {
    source = base.getContext('2d')!.getImageData(0, 0, base.width, base.height);
    samples.set(base, source);
  }
  const size = Math.max(6, Math.round(mark.width * 2)),
    radius = Math.max(size, mark.width * 3);
  const cells = new Set<number>(),
    cols = Math.ceil(base.width / size);
  const stamp = (p: Point) => {
    const cx = Math.floor(p.x / size),
      cy = Math.floor(p.y / size),
      reach = Math.ceil(radius / size);
    for (
      let y = Math.max(0, cy - reach);
      y <= Math.min(Math.ceil(base.height / size) - 1, cy + reach);
      y++
    )
      for (let x = Math.max(0, cx - reach); x <= Math.min(cols - 1, cx + reach); x++)
        if (Math.hypot((x + 0.5) * size - p.x, (y + 0.5) * size - p.y) <= radius + size / 2)
          cells.add(y * cols + x);
  };
  mark.points.forEach((p, i) => {
    const q = mark.points[i - 1] ?? p,
      n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (size / 2)));
    for (let j = 0; j <= n; j++)
      stamp({ x: q.x + ((p.x - q.x) * j) / n, y: q.y + ((p.y - q.y) * j) / n });
  });
  for (const id of cells) {
    const x0 = (id % cols) * size,
      y0 = Math.floor(id / cols) * size;
    let r = 0,
      g = 0,
      b = 0,
      a = 0,
      count = 0;
    for (let y = y0; y < Math.min(y0 + size, base.height); y++)
      for (let x = x0; x < Math.min(x0 + size, base.width); x++) {
        const i = (y * base.width + x) * 4;
        r += source.data[i];
        g += source.data[i + 1];
        b += source.data[i + 2];
        a += source.data[i + 3];
        count++;
      }
    ctx.fillStyle = `rgba(${Math.floor(r / count)},${Math.floor(g / count)},${Math.floor(b / count)},${a / count / 255})`;
    ctx.clearRect(x0, y0, size, size);
    ctx.fillRect(x0, y0, size, size);
  }
}
export function paintMark(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, m: Mark) {
  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const x = Math.min(m.start.x, m.end.x),
    y = Math.min(m.start.y, m.end.y),
    w = Math.abs(m.end.x - m.start.x),
    h = Math.abs(m.end.y - m.start.y);
  switch (m.kind) {
    case 'rect':
      ctx.lineJoin = 'miter';
      if (m.fill) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        x + w / 2,
        y + h / 2,
        Math.max(0.01, w / 2),
        Math.max(0.01, h / 2),
        0,
        0,
        Math.PI * 2
      );
      if (m.fill) ctx.fill();
      else ctx.stroke();
      break;
    case 'line':
    case 'arrow': {
      path(ctx, [m.start, m.end]);
      ctx.stroke();
      if (m.kind === 'arrow') {
        const angle = Math.atan2(m.end.y - m.start.y, m.end.x - m.start.x),
          head = Math.max(10, m.width * 4);
        ctx.beginPath();
        ctx.moveTo(m.end.x, m.end.y);
        ctx.lineTo(
          m.end.x - head * Math.cos(angle - Math.PI / 6),
          m.end.y - head * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          m.end.x - head * Math.cos(angle + Math.PI / 6),
          m.end.y - head * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'pen':
    case 'highlight':
      if (m.kind === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = m.width * 4;
      }
      path(ctx, m.points);
      ctx.stroke();
      break;
    case 'mosaic':
      mosaic(ctx, base, m);
      break;
    case 'eraser':
      ctx.lineWidth = m.width * 6;
      path(ctx, m.points);
      ctx.strokeStyle = '#000';
      // Restore source pixels through a brush mask, including transparency.
      {
        const mask = makeCanvas(base.width, base.height),
          mc = mask.getContext('2d')!;
        mc.lineWidth = m.width * 6;
        mc.lineCap = 'round';
        mc.lineJoin = 'round';
        path(mc, m.points);
        mc.stroke();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        mc.globalCompositeOperation = 'source-in';
        mc.drawImage(base, 0, 0);
        ctx.drawImage(mask, 0, 0);
        mask.width = 0;
        mask.height = 0;
      }
      break;
    case 'text':
      ctx.font = `${m.bold ? '600 ' : ''}${m.fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'top';
      m.text
        .split('\n')
        .forEach((line, i) => ctx.fillText(line, m.start.x, m.start.y + i * m.fontSize * 1.3));
      break;
    case 'marker': {
      const r = m.fontSize * 0.75;
      ctx.beginPath();
      ctx.arc(m.start.x, m.start.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${m.fontSize}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.number), m.start.x, m.start.y);
      break;
    }
  }
  ctx.restore();
}
// This exact canvas is used for preview, clipboard, pins, files and history.
export function paintDocument(canvas: HTMLCanvasElement, doc: ImageDocument, marks = doc.marks) {
  if (canvas.width !== doc.base.width) canvas.width = doc.base.width;
  if (canvas.height !== doc.base.height) canvas.height = doc.base.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(doc.base, 0, 0);
  for (const mark of marks) paintMark(ctx, doc.base, mark);
  paintWatermark(ctx,canvas.width,canvas.height,doc.watermark);
}
export function flatten(doc: ImageDocument): HTMLCanvasElement {
  const c = makeCanvas(doc.base.width, doc.base.height);
  paintDocument(c, doc);
  return c;
}
export function transformDocument(
  doc: ImageDocument,
  operation: 'left' | 'right' | 'flipX' | 'flipY',
  crop?: Rect
): ImageDocument {
  const source = flatten(doc),
    rotate = operation === 'left' || operation === 'right';
  const out = makeCanvas(
      crop?.w ?? (rotate ? source.height : source.width),
      crop?.h ?? (rotate ? source.width : source.height)
    ),
    ctx = out.getContext('2d')!;
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  else {
    ctx.translate(out.width / 2, out.height / 2);
    if (rotate) ctx.rotate(operation === 'left' ? -Math.PI / 2 : Math.PI / 2);
    else ctx.scale(operation === 'flipX' ? -1 : 1, operation === 'flipY' ? -1 : 1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
  }
  source.width = 0;
  source.height = 0;
  return { base: out, marks: [] };
}
export async function encodeDocument(doc: ImageDocument): Promise<string> {
  const canvas = flatten(doc);
  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    );
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
