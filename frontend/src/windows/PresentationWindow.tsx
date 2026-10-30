import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from '../i18n';
interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  created: number;
}
export function PresentationWindow() {
  const { lang } = useTranslation(),
    t = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  const canvas = useRef<HTMLCanvasElement>(null),
    strokes = useRef<Stroke[]>([]),
    drawing = useRef<Stroke | null>(null),
    [color, setColor] = useState('#ef4444'),
    [width, setWidth] = useState(5),
    [fade, setFade] = useState(true),
    [error, setError] = useState('');
  const clear = () => {
    strokes.current = [];
    drawing.current = null;
  };
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    void invoke('presentation_ready').catch(e=>setError(String(e)));
    let frame = 0;
    let last = 0;
    const paint = () => {
      const c = canvas.current;
      if (c) {
        const now = performance.now();
        if (now - last < 32) {
          frame = requestAnimationFrame(paint);
          return;
        }
        last = now;
        const ratio = window.devicePixelRatio;
        const width = Math.round(innerWidth * ratio),
          height = Math.round(innerHeight * ratio);
        if (c.width !== width || c.height !== height) {
          c.width = width;
          c.height = height;
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        if (fade)
          strokes.current = strokes.current.filter(
            (s) => s === drawing.current || now - s.created < 3000
          );
        for (const s of strokes.current) {
          ctx.globalAlpha =
            fade && s !== drawing.current ? Math.min(1, (3000 - (now - s.created)) / 1200) : 1;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          if (s.points.length === 1) {
            const p = s.points[0];
            ctx.lineTo(p.x + 0.1, p.y);
          }
          ctx.stroke();
        }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [fade]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void getCurrentWindow().close();
      if (e.key === 'Delete') clear();
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        strokes.current.pop();
      }
    };
    window.addEventListener('keydown', handler);
    const off = listen('presentation-restored', () => setError(''));
    return () => {
      window.removeEventListener('keydown', handler);
      void off.then((f) => f());
    };
  }, []);
  return (
    <div className="h-screen w-screen bg-transparent" data-el="presentation-canvas">
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const s = {
            points: [{ x: e.clientX, y: e.clientY }],
            color,
            width,
            created: performance.now(),
          };
          drawing.current = s;
          strokes.current.push(s);
        }}
        onPointerMove={(e) => {
          if (drawing.current) {
            drawing.current.points.push({ x: e.clientX, y: e.clientY });
            drawing.current.created = performance.now();
          }
        }}
        onPointerUp={(e) => {
          if (drawing.current) drawing.current.created = performance.now();
          drawing.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drawing.current = null;
        }}
      />
      <div className="absolute left-1/2 top-4 flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 p-2 text-xs text-foreground shadow-lg">
        <strong className="px-2">{t('演示画布', 'Presentation')}</strong>
        <input
          aria-label={t('颜色', 'Color')}
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <select
          aria-label={t('粗细', 'Width')}
          className="rounded border border-border bg-background p-1"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        >
          {[3, 5, 8, 12].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={fade} onChange={(e) => setFade(e.target.checked)} />
          {t('渐隐', 'Fade')}
        </label>
        <button
          className="rounded border border-border px-2 py-1"
          onClick={() => strokes.current.pop()}
        >
          {t('撤销', 'Undo')}
        </button>
        <button className="rounded border border-border px-2 py-1" onClick={clear}>
          {t('清空', 'Clear')}
        </button>
        <button
          className="rounded border border-border px-2 py-1"
          title={t(
            '鼠标穿透后，从托盘菜单“恢复演示操作”返回',
            'Restore controls from the tray menu after enabling click-through'
          )}
          onClick={() =>
            void invoke('presentation_passthrough', { enabled: true }).catch((e) =>
              setError(String(e))
            )
          }
        >
          {t('鼠标穿透（托盘恢复）', 'Click-through (restore in tray)')}
        </button>
        <button
          className="rounded bg-primary px-2 py-1 text-primary-foreground"
          onClick={() => void getCurrentWindow().close()}
        >
          {t('退出 Esc', 'Exit Esc')}
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}
