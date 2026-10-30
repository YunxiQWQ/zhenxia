import { WatermarkPanel } from '../components/WatermarkPanel';
import { DEFAULT_WATERMARK, type Watermark } from '../editor/watermark';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bold,
  Check,
  Copy,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Pin,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Square,
  Circle,
  Trash2,
  Type,
  Stamp,
  Undo2,
  X,
  Grid2X2,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '../i18n';
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
  type Point,
  type Rect,
  type Tool,
} from '../editor/model';
import {
  encodeDocument,
  flatten,
  makeCanvas,
  paintDocument,
  releaseRaster,
  transformDocument,
} from '../editor/paint';
import './image-editor.css';
import { useCaptureSettings } from '../hooks/useCaptureSettings';
import { shortcutAction } from '../utils/capturePreferences';
import { toolbarColors } from '../components/CaptureToolbar';
import { ScanText, Languages } from 'lucide-react';

interface Props {
  initialWatermark?: boolean;
  image: ImageBitmap;
  sessionId: string;
  sourceClipId: string | null;
  onCancel: () => void;
}
interface Drag {
  kind: 'draw' | 'move' | 'resize' | 'crop' | 'pan';
  pointer: number;
  start: Point;
  client: Point;
  marks: Mark[];
  mark?: Mark;
  rect?: Rect;
  pan: Point;
}
const COLORS = [
  '#ec6464',
  '#f6c85f',
  '#79dec2',
  '#70b1f5',
  '#c4a0f5',
  '#ffffff',
  '#242424',
  '#000000',
];
const tools: { id: Tool; en: string; zh: string; key: string; icon: LucideIcon }[] = [
  { id: 'select', en: 'Select', zh: '选择标注', key: 'V', icon: MousePointer2 },
  { id: 'pan', en: 'Pan', zh: '移动画布', key: 'H', icon: Hand },
  { id: 'crop', en: 'Crop', zh: '裁剪', key: 'C', icon: Crop },
  { id: 'rect', en: 'Rectangle', zh: '矩形', key: 'R', icon: Square },
  { id: 'ellipse', en: 'Ellipse', zh: '椭圆', key: 'O', icon: Circle },
  { id: 'arrow', en: 'Arrow', zh: '箭头', key: 'A', icon: ArrowUpRight },
  { id: 'line', en: 'Line', zh: '直线', key: 'L', icon: Minus },
  { id: 'pen', en: 'Pen', zh: '画笔', key: 'P', icon: Pencil },
  { id: 'text', en: 'Text', zh: '文字', key: 'T', icon: Type },
  { id: 'marker', en: 'Number', zh: '序号', key: 'N', icon: ListOrdered },
  { id: 'highlight', en: 'Highlight', zh: '高亮', key: 'B', icon: Highlighter },
  { id: 'mosaic', en: 'Mosaic', zh: '马赛克', key: 'M', icon: Grid2X2 },
  { id: 'eraser', en: 'Eraser', zh: '橡皮擦', key: 'E', icon: Eraser },
];

export default function ImageEditor({
  image,
  sessionId,
  sourceClipId,
  onCancel,
  initialWatermark = false,
}: Props) {
  const { preferences, systemTheme } = useCaptureSettings();
  const palette = toolbarColors(preferences, systemTheme);
  const [textResult, setTextResult] = useState<{ text: string; translated?: string | null } | null>(
    null
  );
  const panCode = useRef('');

  const { lang } = useTranslation();
  const l = (en: string, zh: string) => (lang === 'zh-CN' ? zh : en);
  const [history, dispatch] = useReducer(imageHistory, image, (bitmap): History<ImageDocument> => {
    const base = makeCanvas(bitmap.width, bitmap.height);
    base.getContext('2d')!.drawImage(bitmap, 0, 0);
    return { past: [], present: { base, marks: [] }, future: [] };
  });
  const [watermarkOpen, setWatermarkOpen] = useState(initialWatermark);
  const [watermarkDraft, setWatermarkDraft] = useState<Watermark>(DEFAULT_WATERMARK);
  const storedDoc = history.present;
  const doc = useMemo(
    () => (watermarkOpen ? { ...storedDoc, watermark: watermarkDraft } : storedDoc),
    [watermarkOpen, storedDoc, watermarkDraft]
  );
  const retainedRasters = useRef(new Set<HTMLCanvasElement>());
  useLayoutEffect(() => {
    const keep = new Set([...history.past, history.present, ...history.future].map((d) => d.base));
    for (const old of retainedRasters.current) if (!keep.has(old)) releaseRaster(old);
    retainedRasters.current = keep;
  }, [history]);
  useEffect(
    () => () => {
      for (const raster of retainedRasters.current) releaseRaster(raster);
      retainedRasters.current.clear();
    },
    []
  );
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#ec6464');
  const [width, setWidth] = useState(4);
  const [fontSize, setFontSize] = useState(24);
  const [bold, setBold] = useState(false);
  const [fill, setFill] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Mark[] | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [ratio, setRatio] = useState(0);
  const [text, setText] = useState<{ mark: Mark; value: string } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const [zoomValue, setZoomValue] = useState<number | null>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [resizeW, setResizeW] = useState(image.width);
  const [resizeH, setResizeH] = useState(image.height);
  const [lockRatio, setLockRatio] = useState(true);
  const [space, setSpace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null),
    alive = useRef(true),
    exporting = useRef(false);
  const selected = doc.marks.find((m) => m.id === selectedId);
  const fit = Math.min((size.w - 64) / doc.base.width, (size.h - 64) / doc.base.height, 1);
  const zoom = Math.max(0.02, zoomValue ?? fit);
  const left = (size.w - doc.base.width * zoom) / 2 + pan.x,
    top = (size.h - doc.base.height * zoom) / 2 + pan.y;
  const dirty = history.past.length > 0;
  const activeStyle = selected ?? { color, width, fontSize, bold, fill };

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setResizeW(doc.base.width);
    setResizeH(doc.base.height);
  }, [doc.base]);
  useLayoutEffect(() => {
    if (!canvas.current) return;
    paintDocument(
      canvas.current,
      doc,
      (preview ?? doc.marks).filter((m) => m.id !== text?.mark.id)
    );
  }, [doc, preview, text]);
  useLayoutEffect(() => {
    const c = overlay.current;
    if (!c) return;
    c.width = doc.base.width;
    c.height = doc.base.height;
    const ctx = c.getContext('2d')!,
      sel = (preview ?? doc.marks).find((m) => m.id === selectedId);
    if (crop) {
      ctx.fillStyle = '#0008';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.clearRect(crop.x, crop.y, crop.w, crop.h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.strokeStyle = '#ffffff60';
      for (const part of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(crop.x + crop.w * part, crop.y);
        ctx.lineTo(crop.x + crop.w * part, crop.y + crop.h);
        ctx.moveTo(crop.x, crop.y + crop.h * part);
        ctx.lineTo(crop.x + crop.w, crop.y + crop.h * part);
        ctx.stroke();
      }
    } else if (sel && !text) {
      const b = markBounds(sel),
        pad = 5 / zoom;
      ctx.strokeStyle = '#8ec8ff';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x + b.w - 4 / zoom, b.y + b.h - 4 / zoom, 8 / zoom, 8 / zoom);
    }
  }, [doc, preview, selectedId, crop, zoom, text]);
  useEffect(() => {
    // The original capture host waits for this editor's first painted frame.
    void invoke('present_capture', { sessionId }).catch((e) => setError(String(e)));
  }, [sessionId]);

  const commit = (marks: Mark[]) => {
    dispatch({ type: 'commit', value: { ...doc, marks } });
    setPreview(null);
    setStatus('');
  };
  const fitView = () => {
    setZoomValue(null);
    setPan({ x: 0, y: 0 });
  };
  const changeZoom = (value: number, anchor = { x: size.w / 2, y: size.h / 2 }) => {
    const next = Math.max(0.02, Math.min(16, value));
    const px = (anchor.x - left) / zoom,
      py = (anchor.y - top) / zoom;
    setPan({
      x: anchor.x - px * next - (size.w - doc.base.width * next) / 2,
      y: anchor.y - py * next - (size.h - doc.base.height * next) / 2,
    });
    setZoomValue(next);
  };
  const toPoint = (clientX: number, clientY: number, clamp = true): Point => {
    const r = stage.current!.getBoundingClientRect();
    const x = (clientX - r.left - left) / zoom,
      y = (clientY - r.top - top) / zoom;
    return clamp
      ? {
          x: Math.max(0, Math.min(doc.base.width, x)),
          y: Math.max(0, Math.min(doc.base.height, y)),
        }
      : { x, y };
  };
  const newMark = (kind: Mark['kind'], p: Point): Mark => ({
    id: crypto.randomUUID(),
    kind,
    start: p,
    end: p,
    points: [p],
    color,
    width,
    fontSize,
    bold,
    fill,
    text: '',
    number: Math.max(0, ...doc.marks.filter((m) => m.kind === 'marker').map((m) => m.number)) + 1,
  });
  const chooseTool = (id: Tool) => {
    if (textRef.current) submitText();
    setTool(id);
    setSelectedId(null);
    setCrop(null);
  };
  const selectMark = (m: Mark | undefined) => {
    setSelectedId(m?.id ?? null);
    if (m) {
      setColor(m.color);
      setWidth(m.width);
      setFontSize(m.fontSize);
      setBold(m.bold);
      setFill(m.fill);
    }
  };
  const updateStyle = (patch: Partial<Mark>) => {
    if (patch.color !== undefined) setColor(patch.color);
    if (patch.width !== undefined) setWidth(patch.width);
    if (patch.fontSize !== undefined) setFontSize(patch.fontSize);
    if (patch.bold !== undefined) setBold(patch.bold);
    if (patch.fill !== undefined) setFill(patch.fill);
    if (selected) commit(doc.marks.map((m) => (m.id === selected.id ? { ...m, ...patch } : m)));
    if (textRef.current)
      setText({ ...textRef.current, mark: { ...textRef.current.mark, ...patch } });
  };
  const submitText = () => {
    const value = textRef.current;
    if (!value) return;
    textRef.current = null;
    setText(null);
    if (!value.value.trim()) return;
    const mark = { ...value.mark, text: value.value };
    commit(
      doc.marks.some((m) => m.id === mark.id)
        ? doc.marks.map((m) => (m.id === mark.id ? mark : m))
        : [...doc.marks, mark]
    );
    setSelectedId(mark.id);
    setTool('select');
  };
  const pointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy || (e.target as HTMLElement).closest('button, input, textarea, select')) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (textRef.current) {
      submitText();
      return;
    }
    const p = toPoint(e.clientX, e.clientY, false),
      isPan = tool === 'pan' || space || e.button === 1;
    if (!isPan && (p.x < 0 || p.y < 0 || p.x > doc.base.width || p.y > doc.base.height)) {
      selectMark(undefined);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d: Drag = {
      kind: 'draw',
      pointer: e.pointerId,
      start: p,
      client: { x: e.clientX, y: e.clientY },
      pan,
      marks: doc.marks,
    };
    if (isPan) d.kind = 'pan';
    else if (tool === 'crop') {
      d.kind = 'crop';
      setCrop({ ...p, w: 0, h: 0 });
    } else if (tool === 'select') {
      const b = selected && markBounds(selected);
      if (selected && b && Math.hypot(p.x - b.x - b.w, p.y - b.y - b.h) < 11 / zoom) {
        d.kind = 'resize';
        d.mark = selected;
        d.rect = b;
      } else {
        const hit = [...doc.marks].reverse().find((m) => hitMark(m, p, 7 / zoom));
        selectMark(hit);
        if (!hit) return;
        d.kind = 'move';
        d.mark = hit;
      }
    } else if (tool === 'text') {
      const m = newMark('text', p);
      setText({ mark: m, value: '' });
      return;
    } else if (tool === 'marker') {
      const m = newMark('marker', p);
      commit([...doc.marks, m]);
      return;
    } else {
      d.mark = newMark(tool, p);
      setPreview([...doc.marks, d.mark]);
    }
    drag.current = d;
  };
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const p = toPoint(e.clientX, e.clientY);
    if (d.kind === 'pan') {
      setPan({ x: d.pan.x + e.clientX - d.client.x, y: d.pan.y + e.clientY - d.client.y });
      return;
    }
    if (d.kind === 'crop') {
      setCrop(boundedCrop(d.start, p, doc.base.width, doc.base.height, ratio));
      return;
    }
    if (!d.mark) return;
    let m: Mark;
    if (d.kind === 'move') m = moveMark(d.mark, p.x - d.start.x, p.y - d.start.y);
    else if (d.kind === 'resize') m = resizeMark(d.mark, d.rect!, p);
    else {
      let end = p;
      if (e.shiftKey && (d.mark.kind === 'rect' || d.mark.kind === 'ellipse')) {
        const side = Math.min(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y));
        end = {
          x: d.start.x + Math.sign(p.x - d.start.x) * side,
          y: d.start.y + Math.sign(p.y - d.start.y) * side,
        };
      }
      if (e.shiftKey && (d.mark.kind === 'arrow' || d.mark.kind === 'line')) {
        const angle =
            (Math.round(Math.atan2(p.y - d.start.y, p.x - d.start.x) / (Math.PI / 4)) * Math.PI) /
            4,
          length = Math.hypot(p.x - d.start.x, p.y - d.start.y);
        end = { x: d.start.x + Math.cos(angle) * length, y: d.start.y + Math.sin(angle) * length };
      }
      const pts = d.mark.points;
      const points =
        Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 0.5 / zoom
          ? [...pts, p]
          : pts;
      m = { ...d.mark, end, points };
      d.mark = m;
    }
    d.marks =
      d.kind === 'draw'
        ? [...doc.marks, m]
        : doc.marks.map((item) => (item.id === m.id ? m : item));
    setPreview(d.marks);
  };
  const pointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    // Include the release location, even when the final pointermove was coalesced.
    pointerMove(e);
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.kind !== 'pan' && d.kind !== 'crop' && d.mark) {
      const marks = d.kind === 'draw' && d.marks === doc.marks ? [...doc.marks, d.mark] : d.marks;
      if (marks !== doc.marks) commit(marks);
      else setPreview(null);
    }
  };
  const undo = () => {
    if (drag.current || busy) return;
    setCrop(null);
    setSelectedId(null);
    setPreview(null);
    dispatch({ type: 'undo' });
  };
  const redo = () => {
    if (drag.current || busy) return;
    setCrop(null);
    setSelectedId(null);
    setPreview(null);
    dispatch({ type: 'redo' });
  };
  const remove = () => {
    if (!selected) return;
    commit(doc.marks.filter((m) => m.id !== selected.id));
    setSelectedId(null);
  };
  const transform = (op: 'left' | 'right' | 'flipX' | 'flipY') => {
    if (textRef.current || busy) return;
    dispatch({ type: 'commit', value: transformDocument(doc, op) });
    setSelectedId(null);
    setCrop(null);
    fitView();
  };
  const applyCrop = () => {
    if (!crop || crop.w < 2 || crop.h < 2) return;
    const r = {
      x: Math.max(0, Math.round(crop.x)),
      y: Math.max(0, Math.round(crop.y)),
      w: Math.round(crop.w),
      h: Math.round(crop.h),
    };
    r.w = Math.min(r.w, doc.base.width - r.x);
    r.h = Math.min(r.h, doc.base.height - r.y);
    dispatch({ type: 'commit', value: transformDocument(doc, 'flipX', r) });
    setCrop(null);
    setTool('select');
    setSelectedId(null);
    fitView();
  };
  const applyResize = () => {
    const w = Math.round(resizeW),
      h = Math.round(resizeH);
    if (
      !(w >= 1 && h >= 1 && w <= 16000 && h <= 16000 && w * h <= 64000000) ||
      (w === doc.base.width && h === doc.base.height)
    )
      return;
    const source = flatten(doc),
      base = makeCanvas(w, h),
      ctx = base.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    source.width = 0;
    dispatch({ type: 'commit', value: { base, marks: [] } });
    setSelectedId(null);
    setCrop(null);
    fitView();
  };
  const exportImage = async (action: 'copy' | 'pin' | 'save' | 'done') => {
    if (exporting.current) return;
    let exportDoc = doc;
    const pending = textRef.current;
    if (pending) {
      if (pending.value.trim()) {
        const mark = { ...pending.mark, text: pending.value };
        const marks = doc.marks.some((m) => m.id === mark.id)
          ? doc.marks.map((m) => (m.id === mark.id ? mark : m))
          : [...doc.marks, mark];
        exportDoc = { base: doc.base, marks };
        commit(marks);
      }
      textRef.current = null;
      setText(null);
    }
    exporting.current = true;
    setBusy(true);
    setError('');
    try {
      const imageBase64 = await encodeDocument(exportDoc);
      if (!alive.current) return;
      if (action === 'done')
        await invoke('finish_screenshot', {
          sessionId,
          sourceClipId,
          imageBase64,
          elements: [],
          crop: null,
          mode: 'edit',
          copyToClipboard: false,
          pin: false,
        });
      else {
        await invoke('export_image_edit', { sessionId, imageBase64, action });
        if (alive.current)
          setStatus(
            action === 'copy'
              ? l('Copied. Paste into any app.', '已复制，可直接粘贴到其他软件')
              : action === 'pin'
                ? l('Pinned and added to history', '已贴图并加入历史')
                : l('Image saved', '图片已保存')
          );
      }
    } catch (e) {
      if (alive.current && !/cancel|取消/i.test(String(e))) setError(String(e));
    } finally {
      exporting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const recognizeImage = async (translate: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const imageBase64 = await encodeDocument(doc);
      const result = await invoke<{ text: string; translated?: string | null }>(
        'process_image_text',
        { imageBase64, translate }
      );
      if (alive.current) setTextResult(result);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const requestClose = () => {
    if (busy) return;
    if (dirty || textRef.current?.value) setConfirmClose(true);
    else onCancel();
  };
  useEffect(() => {
    window.addEventListener('zhenxia:editor-close-request', requestClose);
    return () => window.removeEventListener('zhenxia:editor-close-request', requestClose);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (textResult) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setTextResult(null);
        }
        return;
      }
      if (
        (e.target instanceof Element &&
          e.target.closest('input,textarea,select,[contenteditable="true"]')) ||
        confirmClose ||
        busy
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (crop) setCrop(null);
        else if (selectedId) setSelectedId(null);
        else requestClose();
        return;
      }
      const action = shortcutAction(e, preferences);
      if (action) {
        if (tools.some((t) => t.id === action)) {
          e.preventDefault();
          if (action === 'pan') {
            setSpace(true);
            panCode.current = e.code;
          } else chooseTool(action as Tool);
          return;
        }
        const actions: Record<string, () => void> = {
          undo,
          redo,
          save: () => void exportImage('save'),
          copy: () => void exportImage('copy'),
          pin: () => void exportImage('pin'),
          finish_editor: () => void exportImage('done'),
          confirm: () => {
            if (crop) applyCrop();
          },
          remove,
          rotate_left: () => transform('left'),
          rotate_right: () => transform('right'),
          flip_x: () => transform('flipX'),
          flip_y: () => transform('flipY'),
          fit: fitView,
          actual_size: () => changeZoom(1),
          zoom_in: () => changeZoom(zoom * 1.25),
          zoom_out: () => changeZoom(zoom * 0.8),
          watermark: () => {setWatermarkDraft(storedDoc.watermark??DEFAULT_WATERMARK);setWatermarkOpen(true)},
          ocr: () => void recognizeImage(false),
          translate: () => void recognizeImage(true),
        };
        if (actions[action]) {
          e.preventDefault();
          actions[action]();
          return;
        }
      }
      const k = e.key.toLowerCase();
      if (k.startsWith('arrow') && selected && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const moved = moveMark(
          selected,
          k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0,
          k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0
        );
        commit(doc.marks.map((m) => (m.id === moved.id ? moved : m)));
      }
    };
    const release = (e: KeyboardEvent) => {
      if (e.code === panCode.current) {
        setSpace(false);
        panCode.current = '';
      }
    };
    const blur = () => {
      setSpace(false);
      if (drag.current) {
        drag.current = null;
        setPreview(null);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', release);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', blur);
    };
  });
  const button = (
    Icon: LucideIcon,
    label: string,
    action: () => void,
    disabled = false,
    className = ''
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      className={`ie-icon ${className}`}
      onClick={action}
    >
      <Icon size={17} strokeWidth={1.7} />
    </button>
  );
  const activeTool = tools.find((t) => t.id === tool)!;
  const shape = selected?.kind ?? tool;
  const showText = shape === 'text' || shape === 'marker';
  const resizeInvalid =
    !Number.isFinite(resizeW) ||
    !Number.isFinite(resizeH) ||
    resizeW < 1 ||
    resizeH < 1 ||
    resizeW > 16000 ||
    resizeH > 16000 ||
    resizeW * resizeH > 64000000;
  return (
    <div
      className="image-editor"
      data-testid="image-editor"
      aria-label={l('Image editor', '图片编辑器')}
    >
      <header
        className="ie-header"
        style={{
          background: palette.background,
          color: palette.foreground,
          borderColor: palette.border,
        }}
        onPointerDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button'))
            void getCurrentWindow().startDragging();
        }}
      >
        <div className="ie-brand">
          <span className="ie-brand-icon">
            <ImageIcon size={19} />
          </span>
          <div>
            <strong>{l('Image editor', '图片编辑')}</strong>
            <span>
              {l('Zhenxia', '帧匣')} <i>/</i> {doc.base.width} × {doc.base.height}
            </span>
          </div>
          {dirty && <span className="ie-unsaved" title={l('Unsaved edits', '尚未保存的修改')} />}
        </div>
        <div className="ie-header-actions">
          <button
            title={l('Watermark', '水印')}
            onClick={() => {
              setWatermarkDraft(storedDoc.watermark ?? DEFAULT_WATERMARK);
              setWatermarkOpen(true);
            }}
          >
            <Stamp size={17} />
          </button>
          {storedDoc.watermark && (
            <button
              title={l('Remove watermark', '移除水印')}
              onClick={() =>
                dispatch({ type: 'commit', value: { ...storedDoc, watermark: undefined } })
              }
            >
              <X size={16} />
            </button>
          )}
          {button(
            Undo2,
            `${l('Undo', '撤销')} (${preferences.shortcuts.undo ?? ''})`,
            undo,
            !history.past.length
          )}
          {button(
            Redo2,
            l('Redo (Ctrl+Shift+Z)', '重做 (Ctrl+Shift+Z)'),
            redo,
            !history.future.length
          )}
          <span className="ie-divider" />
          <button
            className="ie-button"
            disabled={busy || !!text}
            onClick={() => void exportImage('save')}
          >
            <Save size={15} />
            <span>{l('Save as', '另存为')}</span>
          </button>
          <button
            className="ie-button"
            disabled={busy || !!text}
            onClick={() => void exportImage('pin')}
          >
            <Pin size={15} />
            <span>{l('Pin', '贴图')}</span>
          </button>
          <button
            className="ie-button"
            disabled={busy || !!text}
            onClick={() => void exportImage('copy')}
          >
            <Copy size={15} />
            <span>{l('Copy', '复制')}</span>
          </button>
          <button
            className="ie-button ie-primary"
            disabled={busy || !!text}
            onClick={() => void exportImage('done')}
          >
            <Check size={16} />
            <span>{busy ? l('Processing…', '处理中…') : l('Done', '保存到历史')}</span>
          </button>
          <span className="ie-divider" />
          {button(
            ScanText,
            l('Recognize text', '识别文字'),
            () => void recognizeImage(false),
            busy
          )}
          {button(
            Languages,
            l('Translate image', '翻译图片'),
            () => void recognizeImage(true),
            busy
          )}
          {button(X, l('Close editor', '关闭编辑器'), requestClose, busy, 'ie-close')}
        </div>
      </header>
      <div className="ie-body">
        <nav
          style={{ background: palette.background, color: palette.foreground }}
          className="ie-tools"
          aria-label={l('Editing tools', '编辑工具')}
        >
          {tools
            .filter((t) => !preferences.toolbar_hidden.includes(t.id as never) || t.id === 'select')
            .sort((a, b) => {
              const ai = preferences.toolbar_order.indexOf(a.id as never),
                bi = preferences.toolbar_order.indexOf(b.id as never);
              return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
            })
            .map((t, i) => (
              <div key={t.id} className={i === 3 || i === 11 ? 'ie-tool-group' : ''}>
                <button
                  type="button"
                  data-tool={t.id}
                  title={`${l(t.en, t.zh)}${preferences.shortcuts[t.id] ? ` (${preferences.shortcuts[t.id]})` : ''}`}
                  aria-label={l(t.en, t.zh)}
                  aria-pressed={tool === t.id}
                  className={`ie-tool ${tool === t.id ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => chooseTool(t.id)}
                >
                  <t.icon size={20} strokeWidth={1.6} />
                  <span>{l(t.en, t.zh)}</span>
                </button>
              </div>
            ))}
        </nav>
        <main className="ie-workspace">
          <div className="ie-contextbar">
            <span>
              <activeTool.icon size={14} />
              {l(activeTool.en, activeTool.zh)}
              {selected && <small> · {l('Selected', '已选中')}</small>}
            </span>
            <div>
              {button(RotateCcw, l('Rotate left', '向左旋转'), () => transform('left'), !!text)}
              {button(RotateCw, l('Rotate right', '向右旋转'), () => transform('right'), !!text)}
              <span className="ie-divider" />
              {button(
                FlipHorizontal2,
                l('Flip horizontal', '水平翻转'),
                () => transform('flipX'),
                !!text
              )}
              {button(
                FlipVertical2,
                l('Flip vertical', '垂直翻转'),
                () => transform('flipY'),
                !!text
              )}
            </div>
          </div>
          <div
            ref={stage}
            className="ie-stage"
            style={{
              cursor:
                tool === 'pan' || space ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
            }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={(e) => {
              if (drag.current?.pointer === e.pointerId) {
                drag.current = null;
                setPreview(null);
              }
            }}
            onLostPointerCapture={(e) => {
              if (drag.current?.pointer === e.pointerId) {
                drag.current = null;
                setPreview(null);
              }
            }}
            onDoubleClick={(e) => {
              if (tool !== 'select' || text) return;
              const p = toPoint(e.clientX, e.clientY),
                m = [...doc.marks]
                  .reverse()
                  .find((m) => m.kind === 'text' && hitMark(m, p, 3 / zoom));
              if (m) {
                selectMark(m);
                setText({ mark: m, value: m.text });
              }
            }}
            onWheel={(e) => {
              e.preventDefault();
              const r = stage.current!.getBoundingClientRect();
              if (e.shiftKey && !e.ctrlKey) setPan((p) => ({ ...p, x: p.x - e.deltaY }));
              else
                changeZoom(zoom * Math.exp(-e.deltaY * 0.0015), {
                  x: e.clientX - r.left,
                  y: e.clientY - r.top,
                });
            }}
          >
            <div
              className="ie-paper"
              style={{ left, top, width: doc.base.width * zoom, height: doc.base.height * zoom }}
            >
              <canvas ref={canvas} />
              <canvas ref={overlay} className="ie-overlay" />
            </div>
            {text && (
              <div
                className="ie-text-edit"
                style={{
                  left: left + text.mark.start.x * zoom,
                  top: top + text.mark.start.y * zoom,
                }}
              >
                <textarea
                  autoFocus
                  aria-label={l('Annotation text', '标注文字')}
                  value={text.value}
                  placeholder={l('Type here…', '输入文字…')}
                  style={{
                    fontSize: Math.max(12, text.mark.fontSize * zoom),
                    fontWeight: text.mark.bold ? 600 : 400,
                    color: text.mark.color,
                  }}
                  onChange={(e) => setText({ ...text, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitText();
                    } else if (e.key === 'Escape') {
                      textRef.current = null;
                      setText(null);
                    }
                  }}
                />
                <div>
                  <small>{l('Shift+Enter: new line', 'Shift+Enter 换行')}</small>
                  <button
                    onClick={() => {
                      textRef.current = null;
                      setText(null);
                    }}
                    aria-label={l('Cancel text', '取消文字')}
                  >
                    <X size={14} />
                  </button>
                  <button onClick={submitText} aria-label={l('Apply text', '确认文字')}>
                    <Check size={14} />
                  </button>
                </div>
              </div>
            )}
            {crop && !drag.current && (
              <div className="ie-crop-actions">
                <span>
                  {Math.round(crop.w)} × {Math.round(crop.h)}
                </span>
                <button onClick={() => setCrop(null)}>{l('Cancel', '取消')}</button>
                <button
                  className="ie-primary"
                  onClick={applyCrop}
                  disabled={crop.w < 2 || crop.h < 2}
                >
                  <Check size={14} />
                  {l('Apply crop', '应用裁剪')}
                </button>
              </div>
            )}
            <div className="ie-zoom">
              {button(Minus, l('Zoom out', '缩小'), () => changeZoom(zoom / 1.25))}
              <button
                className="ie-zoom-percent"
                title={l('Actual pixels', '实际像素')}
                onClick={() => changeZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              {button(Plus, l('Zoom in', '放大'), () => changeZoom(zoom * 1.25))}
              <span className="ie-divider" />
              {button(Scan, l('Fit image (Ctrl+0)', '适应画布 (Ctrl+0)'), fitView)}
              {button(Maximize2, l('Actual pixels (Ctrl+1)', '实际像素 (Ctrl+1)'), () =>
                changeZoom(1)
              )}
            </div>
          </div>
          <footer className="ie-footer">
            <span>
              {status ||
                l(
                  'Wheel: zoom · Space+drag: pan · Shift: constrain',
                  '滚轮缩放 · 空格拖动画布 · Shift 约束形状'
                )}
            </span>
            <span>
              {doc.marks.length} {l('annotations', '个标注')}
              <i />
              PNG
            </span>
          </footer>
        </main>
        <aside className="ie-properties">
          <section>
            <h3>
              {l('Properties', '工具属性')}
              <small>
                {selected ? l('Selection', '当前标注') : l(activeTool.en, activeTool.zh)}
              </small>
            </h3>
            {tool === 'crop' ? (
              <>
                <label className="ie-field-label">{l('Aspect ratio', '裁剪比例')}</label>
                <select
                  aria-label={l('Aspect ratio', '裁剪比例')}
                  value={ratio}
                  onChange={(e) => {
                    setRatio(Number(e.target.value));
                    setCrop(null);
                  }}
                >
                  <option value={0}>{l('Free', '自由裁剪')}</option>
                  <option value={1}>1 : 1</option>
                  <option value={16 / 9}>16 : 9</option>
                  <option value={4 / 3}>4 : 3</option>
                  <option value={3 / 4}>3 : 4</option>
                  <option value={9 / 16}>9 : 16</option>
                </select>
                <p>
                  {l(
                    'Drag over the image, then apply. Enter applies, Esc cancels.',
                    '在图片上拖出裁剪区域。Enter 应用，Esc 取消。'
                  )}
                </p>
              </>
            ) : tool === 'pan' ? (
              <p>
                {l(
                  'Drag to move. Scroll to zoom around the pointer. Double-click text with Select to edit it.',
                  '拖动平移，滚轮以鼠标位置缩放。使用选择工具双击文字可再次编辑。'
                )}
              </p>
            ) : (
              <>
                {shape !== 'eraser' && shape !== 'mosaic' && (
                  <>
                    <label className="ie-field-label">
                      {l('Color', '颜色')}
                      <input
                        type="color"
                        aria-label={l('Custom color', '自定义颜色')}
                        value={activeStyle.color}
                        onChange={(e) => updateStyle({ color: e.target.value })}
                      />
                    </label>
                    <div className="ie-colors">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          aria-label={`${l('Color', '颜色')} ${c}`}
                          aria-pressed={activeStyle.color === c}
                          style={{ background: c }}
                          className={activeStyle.color === c ? 'is-active' : ''}
                          onClick={() => updateStyle({ color: c })}
                        />
                      ))}
                    </div>
                  </>
                )}
                <label className="ie-field-label">
                  {showText
                    ? l('Font size', '字号')
                    : shape === 'mosaic' || shape === 'eraser'
                      ? l('Brush size', '笔刷大小')
                      : l('Stroke width', '线条粗细')}
                  <input
                    aria-label={showText ? l('Font size', '字号') : l('Stroke width', '线条粗细')}
                    type="number"
                    min={showText ? 8 : 1}
                    max={showText ? 160 : 40}
                    value={showText ? activeStyle.fontSize : activeStyle.width}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (
                        Number.isFinite(n) &&
                        n >= (showText ? 8 : 1) &&
                        n <= (showText ? 160 : 40)
                      )
                        updateStyle(showText ? { fontSize: n } : { width: n });
                    }}
                  />
                </label>
                <input
                  className="ie-range"
                  aria-label={l('Adjust size', '调整大小')}
                  type="range"
                  min={showText ? 8 : 1}
                  max={showText ? 96 : 30}
                  value={showText ? activeStyle.fontSize : activeStyle.width}
                  onChange={(e) =>
                    updateStyle(
                      showText
                        ? { fontSize: Number(e.target.value) }
                        : { width: Number(e.target.value) }
                    )
                  }
                />
                {shape === 'text' && (
                  <button
                    className={`ie-button ie-wide ${activeStyle.bold ? 'is-active' : ''}`}
                    aria-pressed={activeStyle.bold}
                    onClick={() => updateStyle({ bold: !activeStyle.bold })}
                  >
                    <Bold size={15} />
                    {l('Bold text', '粗体文字')}
                  </button>
                )}
                {(shape === 'rect' || shape === 'ellipse') && (
                  <label className="ie-checkbox">
                    <input
                      type="checkbox"
                      checked={activeStyle.fill}
                      onChange={(e) => updateStyle({ fill: e.target.checked })}
                    />
                    {l('Fill shape', '填充形状')}
                  </label>
                )}
                {selected && (
                  <div className="ie-selection-actions">
                    {button(
                      ArrowDown,
                      l('Send backward', '下移一层'),
                      () => {
                        const i = doc.marks.indexOf(selected);
                        if (i < 1) return;
                        const next = [...doc.marks];
                        [next[i], next[i - 1]] = [next[i - 1], next[i]];
                        commit(next);
                      },
                      doc.marks.indexOf(selected) === 0
                    )}
                    {button(
                      ArrowUp,
                      l('Bring forward', '上移一层'),
                      () => {
                        const i = doc.marks.indexOf(selected);
                        if (i === doc.marks.length - 1) return;
                        const next = [...doc.marks];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        commit(next);
                      },
                      doc.marks.indexOf(selected) === doc.marks.length - 1
                    )}
                    {button(Trash2, l('Delete annotation', '删除标注'), remove)}
                  </div>
                )}
                <p>
                  {tool === 'select'
                    ? l(
                        'Click a mark to move or resize it. Double-click text to edit. Delete removes the selection.',
                        '点击标注可移动，拖动右下角可缩放。双击文字编辑，Delete 删除。'
                      )
                    : shape === 'mosaic'
                      ? l(
                          'Pixels are sampled from the source image. The saved image matches this preview.',
                          '按原图像素生成马赛克，预览与导出使用同一绘制结果。'
                        )
                      : shape === 'eraser'
                        ? l(
                            'Restores the original image under the brush. The source image is preserved.',
                            '擦除标注并恢复对应原图，不擦掉原始图片。'
                          )
                        : l(
                            'Style changes also apply to selected marks.',
                            '选中标注后可修改颜色、大小和样式。'
                          )}
                </p>
              </>
            )}
          </section>
          <section>
            <h3>
              {l('Image size', '图片尺寸')}
              <small>px</small>
            </h3>
            <div className="ie-dimensions">
              <label>
                <span>W</span>
                <input
                  aria-label={l('Image width', '图片宽度')}
                  type="number"
                  min={1}
                  max={16000}
                  value={resizeW}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setResizeW(n);
                    if (lockRatio)
                      setResizeH(Math.max(1, Math.round((n * doc.base.height) / doc.base.width)));
                  }}
                />
              </label>
              <X size={11} />
              <label>
                <span>H</span>
                <input
                  aria-label={l('Image height', '图片高度')}
                  type="number"
                  min={1}
                  max={16000}
                  value={resizeH}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setResizeH(n);
                    if (lockRatio)
                      setResizeW(Math.max(1, Math.round((n * doc.base.width) / doc.base.height)));
                  }}
                />
              </label>
            </div>
            <label className="ie-checkbox">
              <input
                type="checkbox"
                checked={lockRatio}
                onChange={(e) => setLockRatio(e.target.checked)}
              />
              {l('Lock aspect ratio', '保持比例')}
            </label>
            <button
              className="ie-button ie-wide"
              disabled={
                busy ||
                !!text ||
                resizeInvalid ||
                (resizeW === doc.base.width && resizeH === doc.base.height)
              }
              onClick={applyResize}
            >
              <MoveUpRight size={14} />
              {l('Apply size', '应用尺寸')}
            </button>
            <p>
              {l(
                'Crop, rotate and resize merge marks into the image. Undo restores them.',
                '裁剪、旋转及调整尺寸会合并当前标注，可通过撤销恢复。'
              )}
            </p>
          </section>
          <section className="ie-layer-section">
            <h3>
              {l('Annotations', '标注')}
              <small>{doc.marks.length}</small>
            </h3>
            <div className="ie-layers">
              {!doc.marks.length ? (
                <div className="ie-empty">
                  <Pencil size={22} />
                  <p>{l('Choose a tool to start', '选择左侧工具开始标注')}</p>
                </div>
              ) : (
                [...doc.marks].reverse().map((m) => {
                  const t = tools.find((t) => t.id === m.kind)!;
                  return (
                    <button
                      key={m.id}
                      className={selectedId === m.id ? 'is-active' : ''}
                      onClick={() => {
                        setTool('select');
                        selectMark(m);
                      }}
                    >
                      <t.icon size={14} />
                      <span>
                        {m.kind === 'text'
                          ? m.text.split('\n')[0]
                          : `${l(t.en, t.zh)}${m.kind === 'marker' ? ` ${m.number}` : ''}`}
                      </span>
                      <span className="ie-layer-dot" style={{ background: m.color }} />
                    </button>
                  );
                })
              )}
            </div>
          </section>
          <div className="ie-origin-note">
            <Check size={12} />
            {l('Original kept in clipboard history', '原图保留在剪贴板历史')}
          </div>
        </aside>
      </div>
      {error && (
        <div className="ie-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label={l('Dismiss error', '关闭错误提示')}>
            <X size={16} />
          </button>
        </div>
      )}
      {watermarkOpen && (
        <WatermarkPanel
          value={watermarkDraft}
          onChange={setWatermarkDraft}
          onApply={() => {
            dispatch({ type: 'commit', value: { ...storedDoc, watermark: watermarkDraft } });
            setWatermarkOpen(false);
          }}
          onCancel={() => setWatermarkOpen(false)}
        />
      )}
      {textResult && (
        <div className="ie-modal-backdrop">
          <section
            className="ie-modal"
            role="dialog"
            aria-modal="true"
            aria-label={l('Text result', '文字结果')}
            style={{ width: 'min(640px,90vw)' }}
          >
            <h2>
              {textResult.translated
                ? l('Image translation', '图片翻译')
                : l('Recognized text', '识别文字')}
            </h2>
            <textarea
              aria-label={l('Recognized text', '识别文字')}
              readOnly
              value={textResult.text}
              className="min-h-32 w-full rounded-lg border border-border bg-transparent p-3"
            />
            {textResult.translated && (
              <textarea
                aria-label={l('Translation result', '翻译结果')}
                readOnly
                value={textResult.translated}
                className="mt-3 min-h-32 w-full rounded-lg border border-border bg-transparent p-3"
              />
            )}
            <div>
              <button className="ie-button" onClick={() => setTextResult(null)}>
                {l('Close', '关闭')}
              </button>
              <button
                className="ie-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(textResult.translated ?? textResult.text)
                    .catch((e) => setError(String(e)))
                }
              >
                {l('Copy', '复制')}
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmClose && (
        <div className="ie-modal-backdrop">
          <div
            className="ie-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={l('Unsaved edits', '尚未保存的修改')}
          >
            <ImageIcon size={24} />
            <h2>{l('Keep your changes?', '保存这次修改？')}</h2>
            <p>
              {l(
                'The original image stays in history. Save this edit as a new image, or discard these changes.',
                '原图仍保留在历史里。可以将修改另存为一条新记录，或放弃本次修改。'
              )}
            </p>
            <div>
              <button className="ie-button" onClick={() => setConfirmClose(false)}>
                {l('Continue editing', '继续编辑')}
              </button>
              <button className="ie-button" onClick={onCancel}>
                {l('Discard', '放弃修改')}
              </button>
              <button
                className="ie-button ie-primary"
                onClick={() => {
                  setConfirmClose(false);
                  void exportImage('done');
                }}
              >
                {l('Save to history', '保存到历史')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
