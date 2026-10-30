export interface Watermark {
  text: string;
  color: string;
  opacity: number;
  fontSize: number;
  angle: number;
  tiled: boolean;
  position: 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';
  image?: HTMLCanvasElement;
  imageScale: number;
}
export const DEFAULT_WATERMARK: Watermark = {
  text: '',
  color: '#ffffff',
  opacity: 0.3,
  fontSize: 32,
  angle: -25,
  tiled: false,
  position: 'bottom-right',
  imageScale: 0.2,
};
export function paintWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mark?: Watermark
) {
  if (!mark || (!mark.text && !mark.image)) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, mark.opacity));
  ctx.font = `600 ${mark.fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = mark.color;
  const iw = mark.image
      ? w * Math.max(0.02, Math.min(0.8, mark.imageScale))
      : Math.max(1, ctx.measureText(mark.text).width),
    ih = mark.image ? (iw * mark.image.height) / mark.image.width : mark.fontSize * 1.4;
  const draw = (x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((mark.angle * Math.PI) / 180);
    if (mark.image) ctx.drawImage(mark.image, -iw / 2, -ih / 2, iw, ih);
    else {
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 2;
      ctx.fillText(mark.text, 0, 0);
    }
    ctx.restore();
  };
  if (mark.tiled) {
    const sx = Math.max(80, iw + 50),
      sy = Math.max(60, ih * 3);
    for (let y = sy / 2; y < h + sy; y += sy) for (let x = sx / 2; x < w + sx; x += sx) draw(x, y);
  } else {
    const margin = 24;
    const x = mark.position.includes('left')
      ? margin + iw / 2
      : mark.position.includes('right')
        ? w - margin - iw / 2
        : w / 2;
    const y = mark.position.startsWith('top')
      ? margin + ih / 2
      : mark.position.startsWith('bottom')
        ? h - margin - ih / 2
        : h / 2;
    draw(x, y);
  }
  ctx.restore();
}
