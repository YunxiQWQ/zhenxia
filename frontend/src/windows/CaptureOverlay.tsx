import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GripVertical, X, Copy } from 'lucide-react';
import { tGlobal } from '../i18n';
import { useCaptureSettings } from '../hooks/useCaptureSettings';
import { CaptureToolbarButtons, toolbarStyle } from '../components/CaptureToolbar';
import { CAPTURE_ACTIONS, shortcutAction, type CaptureAction } from '../utils/capturePreferences';
import { flushSync } from 'react-dom';
import { decodeCaptureBitmap } from '../utils/captureBitmap';
import { readCapturePixels } from '../utils/captureSharedPixels';

// The full editor loads only when opening a history image; F1 stays on its
// existing capture path and shares the original native window.
const ImageEditor = lazy(() => import('./ImageEditor'));

// ── Types ──────────────────────────────────────────────────────────────────
interface CaptureWindowCandidate {
  id: number;
  title: string;
  class_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  kind: string;
}

interface CaptureDesktop {
  intent?: string;
  session_id: string;
  image_base64: string;
  raw_rgba: boolean;
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
  scale: number;
  windows: CaptureWindowCandidate[];
  is_edit: boolean;
  parent_clip_id: string | null;
}

interface AnnotationElement {
  kind: string;
  color: [number, number, number, number];
  width: number;
  fontSize: number;
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
  points: [number, number][];
  text: string;
  number: number;
  bg?: [number, number, number, number];
}

type ToolType =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'text'
  | 'marker'
  | 'highlight'
  | 'mosaic'
  | 'eraser';

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
const BRAND = {
  graphite: '#1e1e1e',
  mint: '#79DEC2',
  warmWhite: '#fafafa',
  red: '#E85D5D',
};

const COLORS: [number, number, number, number][] = [
  [232, 93, 93, 255], // red
  [121, 222, 194, 255], // mint
  [255, 255, 255, 255], // white
  [24, 33, 39, 255], // graphite
  [255, 200, 60, 255], // yellow
  [80, 160, 255, 255], // blue
];

const WIDTHS = [2, 4, 6, 10];

// ── Component ──────────────────────────────────────────────────────────────
export function CaptureOverlay() {
  const { preferences, systemTheme } = useCaptureSettings();
  const [redoStack, setRedoStack] = useState<AnnotationElement[][]>([]);
  const [result, setResult] = useState<{ text: string; translated?: string | null } | null>(null);
  const [completedSelection, setCompletedSelection] = useState(0);
  const autoHandled = useRef(false);
  const actionSerial = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 700, height: 46, palette: 44 });
  const [manualToolbar, setManualToolbar] = useState<{ x: number; y: number } | null>(null);
  const toolbarDrag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  const [session, setSession] = useState<CaptureDesktop | null>(null);
  const [tool, setTool] = useState<ToolType>('select');
  const [colorIdx, setColorIdx] = useState(1); // mint default
  const [widthIdx, setWidthIdx] = useState(1);
  const [fontSize] = useState(24);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [elements, setElements] = useState<AnnotationElement[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationElement[][]>([]);
  const [candidates, setCandidates] = useState<CaptureWindowCandidate[]>([]);
  const [candidateIdx, setCandidateIdx] = useState(-1);
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<[number, number][]>([]);
  const [markerCounter, setMarkerCounter] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hoverRect, setHoverRect] = useState<SelectionRect | null>(null);
  const hoverRequest = useRef(0);
  const lastHover = useRef(0);
  const selecting = useRef(false);
  const dragMoved = useRef(false);
  const selectionDrag = useRef<{ kind: string; rect: SelectionRect | null }>({
    kind: 'new',
    rect: null,
  });
  const [imageEl, setImageEl] = useState<ImageBitmap | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio || 1,
  }));
  const drawing = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const activePointer = useRef<number | null>(null);
  const hasSelection = !!selection;
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const measure = () => {
      const rect = bar.getBoundingClientRect();
      const palette = paletteRef.current?.getBoundingClientRect().height ?? 44;
      setToolbarSize((old) =>
        old.width === rect.width && old.height === rect.height && old.palette === palette
          ? old
          : { width: rect.width, height: rect.height, palette }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    if (paletteRef.current) observer.observe(paletteRef.current);
    return () => observer.disconnect();
  }, [hasSelection, isDrawing, tool, session?.is_edit]);
  useEffect(() => {
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // A hidden, empty editor is reused; no desktop bitmap survives between captures.
  useEffect(() => {
    const idleUrl = new URLSearchParams(location.search).get('window')
      ? 'index.html?window=screenshot'
      : 'index.html';
    let generation = 0;
    let active = true;
    let decoded: ImageBitmap | null = null;
    const reset = () => {
      generation++;
      drawing.current = false;
      dragOrigin.current = null;
      selecting.current = false;
      activePointer.current = null;
      hoverRequest.current++;
      if (decoded) {
        decoded.close();
        decoded = null;
      }
      for (const canvas of [canvasRef.current, overlayCanvasRef.current])
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      setImageEl(null);
      setSession(null);
      setSelection(null);
      setElements([]);
      setUndoStack([]);
      setManualToolbar(null);
      toolbarDrag.current = null;
      setRedoStack([]);
      setResult(null);
      setCompletedSelection(0);
      autoHandled.current = false;
      actionSerial.current++;
      setCandidates([]);
      setCandidateIdx(-1);
      setHoverRect(null);
      setTextInput(null);
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentPoints([]);
      setMarkerCounter(1);
      setBusy(false);
      setError('');
      setTool('select');
      history.replaceState(null, '', idleUrl);
    };
    const load = async (id: string) => {
      reset();
      const request = generation;
      try {
        const s = await invoke<CaptureDesktop>('get_capture_session', { sessionId: id });
        if (!active || request !== generation) return;
        const metadata = { ...s, image_base64: '' };
        // Browser-native decoding avoids a per-byte JavaScript base64 copy and
        // lets reset explicitly close the decoded graphics resource.
        const image = await decodeCaptureBitmap(s, () => readCapturePixels(id));
        if (!active || request !== generation) {
          image.close();
          return;
        }
        decoded = image;
        history.replaceState(
          null,
          '',
          `index.html?window=screenshot&session=${encodeURIComponent(id)}${metadata.parent_clip_id ? '&clip=' + encodeURIComponent(metadata.parent_clip_id) : ''}`
        );
        const commit = () => {
          setSession(metadata);
          if (metadata.is_edit) setSelection({ x: 0, y: 0, w: metadata.width, h: metadata.height });
          setImageEl(image);
        };
        // Native capture events arrive while the window is hidden. Commit the
        // ready frame now, rather than waiting for a background React render.
        if (metadata.is_edit) commit();
        else flushSync(commit);
      } catch (e) {
        if (active && request === generation) {
          setError(String(e));
          void invoke('cancel_screenshot', { sessionId: id });
        }
      }
    };
    const change = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) void load(id);
    };
    window.addEventListener('zhenxia:capture-session', change);
    window.addEventListener('zhenxia:capture-reset', reset);
    void invoke<string | null>('capture_view_ready')
      .then((id) => {
        if (active && id)
          window.dispatchEvent(new CustomEvent('zhenxia:capture-session', { detail: id }));
      })
      .catch(console.error);
    return () => {
      active = false;
      generation++;
      if (decoded) decoded.close();
      window.removeEventListener('zhenxia:capture-session', change);
      window.removeEventListener('zhenxia:capture-reset', reset);
    };
  }, []);

  // Redraw canvas when session/image/selection/elements change
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!canvas || !overlay || !session) return;
    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');
    if (!ctx || !octx) return;

    if (overlay.width !== session.width) overlay.width = session.width;
    if (overlay.height !== session.height) overlay.height = session.height;

    // Dim outside selection
    octx.clearRect(0, 0, session.width, session.height);
    const shown = selection ?? hoverRect;
    if (shown) {
      const selection = shown;
      octx.fillStyle = 'rgba(0,0,0,0.45)';
      octx.fillRect(0, 0, session.width, session.height);
      octx.clearRect(selection.x, selection.y, selection.w, selection.h);
      // Mint border
      octx.strokeStyle = BRAND.mint;
      octx.lineWidth = 2;
      octx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      // Handles
      const hs = 8;
      octx.fillStyle = BRAND.mint;
      for (const [hx, hy] of [
        [selection.x, selection.y],
        [selection.x + selection.w / 2, selection.y],
        [selection.x + selection.w, selection.y],
        [selection.x, selection.y + selection.h / 2],
        [selection.x + selection.w, selection.y + selection.h / 2],
        [selection.x, selection.y + selection.h],
        [selection.x + selection.w / 2, selection.y + selection.h],
        [selection.x + selection.w, selection.y + selection.h],
      ]) {
        octx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      // Size label
      octx.fillStyle = BRAND.graphite;
      octx.fillRect(selection.x, selection.y - 24, 100, 20);
      octx.fillStyle = BRAND.warmWhite;
      octx.font = '12px sans-serif';
      octx.fillText(
        `${Math.round(selection.w)} × ${Math.round(selection.h)}`,
        selection.x + 6,
        selection.y - 9
      );
    }

    // Draw annotation elements
    for (const el of elements) {
      drawElement(octx, el);
    }

    // Draw in-progress element
    if (isDrawing && drawStart && currentPoints.length > 0) {
      const preview: AnnotationElement = {
        kind:
          tool === 'pen'
            ? 'pen'
            : tool === 'highlight'
              ? 'highlight'
              : tool === 'mosaic'
                ? 'mosaic'
                : tool === 'eraser'
                  ? 'eraser'
                  : tool,
        color: COLORS[colorIdx],
        width: WIDTHS[widthIdx],
        fontSize,
        x: drawStart.x,
        y: drawStart.y,
        w: (currentPoints[currentPoints.length - 1]?.[0] ?? 0) - drawStart.x,
        h: (currentPoints[currentPoints.length - 1]?.[1] ?? 0) - drawStart.y,
        x2: currentPoints[currentPoints.length - 1]?.[0] ?? 0,
        y2: currentPoints[currentPoints.length - 1]?.[1] ?? 0,
        points: currentPoints,
        text: '',
        number: markerCounter,
      };
      drawElement(octx, preview);
    }
  }, [
    session,
    selection,
    hoverRect,
    elements,
    isDrawing,
    drawStart,
    currentPoints,
    tool,
    colorIdx,
    widthIdx,
    fontSize,
    markerCounter,
  ]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session || !imageEl || session.is_edit) return;
    canvas.width = session.width;
    canvas.height = session.height;
    canvas.getContext('2d')?.drawImage(imageEl, 0, 0);
    // Native window stays hidden until the frozen desktop is decoded and drawn.
    // Do not wait for requestAnimationFrame: hidden webviews may suspend it.
    void invoke('present_capture', { sessionId: session.session_id }).catch((e) =>
      setError(String(e))
    );
  }, [session, imageEl]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!session || session.is_edit) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (result) setResult(null);
        else void handleCancel();
        return;
      }
      if (
        e.target instanceof Element &&
        e.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const action = shortcutAction(e, preferences);
      if (action) {
        e.preventDefault();
        void handleAction(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Mouse handlers ───────────────────────────────────────────────────────
  const getPos = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    };
  };

  const handleMouseDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (textInput || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointer.current = e.pointerId;
    const pos = getPos(e);
    drawing.current = true;
    dragOrigin.current = pos;
    lastPointer.current = pos;
    setDrawStart(pos);
    setIsDrawing(true);

    if (tool === 'select') {
      selecting.current = true;
      dragMoved.current = false;
      hoverRequest.current++;
      let kind = 'new';
      if (selection) {
        const tolerance = 9 * ((session?.width ?? viewport.width) / viewport.width);
        const horizontal =
          Math.abs(pos.x - selection.x) < tolerance
            ? 'w'
            : Math.abs(pos.x - selection.x - selection.w) < tolerance
              ? 'e'
              : '';
        const vertical =
          Math.abs(pos.y - selection.y) < tolerance
            ? 'n'
            : Math.abs(pos.y - selection.y - selection.h) < tolerance
              ? 's'
              : '';
        if (
          pos.x >= selection.x - tolerance &&
          pos.x <= selection.x + selection.w + tolerance &&
          pos.y >= selection.y - tolerance &&
          pos.y <= selection.y + selection.h + tolerance
        )
          kind = horizontal + vertical || 'move';
      }
      selectionDrag.current = { kind, rect: selection };
      if (kind === 'new') setSelection(hoverRect ?? { x: pos.x, y: pos.y, w: 0, h: 0 });
      setHoverRect(null);
    } else if (tool === 'text') {
      setTextInput({ x: pos.x, y: pos.y, value: '' });
      drawing.current = false;
      setIsDrawing(false);
    } else if (tool === 'marker') {
      const el: AnnotationElement = {
        kind: 'marker',
        color: COLORS[colorIdx],
        width: WIDTHS[widthIdx],
        fontSize,
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
        x2: 0,
        y2: 0,
        points: [],
        text: '',
        number: markerCounter,
      };
      setRedoStack([]);
      setUndoStack((s) => [...s, elements]);
      setElements((s) => [...s, el]);
      setMarkerCounter((n) => n + 1);
      drawing.current = false;
      setIsDrawing(false);
    } else {
      setCurrentPoints([[pos.x, pos.y]]);
    }
  };

  const updateSelection = (pos: { x: number; y: number }, drawStart: { x: number; y: number }) => {
    if (!dragMoved.current) return;
    const { kind, rect } = selectionDrag.current;
    if (rect && kind === 'move') {
      setSelection({
        ...rect,
        x: Math.max(0, Math.min((session?.width ?? rect.w) - rect.w, rect.x + pos.x - drawStart.x)),
        y: Math.max(
          0,
          Math.min((session?.height ?? rect.h) - rect.h, rect.y + pos.y - drawStart.y)
        ),
      });
    } else if (rect && kind !== 'new') {
      let left = rect.x,
        right = rect.x + rect.w,
        top = rect.y,
        bottom = rect.y + rect.h;
      if (kind.includes('w')) left = Math.max(0, Math.min(pos.x, right - 4));
      if (kind.includes('e')) right = Math.min(session?.width ?? pos.x, Math.max(pos.x, left + 4));
      if (kind.includes('n')) top = Math.max(0, Math.min(pos.y, bottom - 4));
      if (kind.includes('s')) bottom = Math.min(session?.height ?? pos.y, Math.max(pos.y, top + 4));
      setSelection({ x: left, y: top, w: right - left, h: bottom - top });
    } else
      setSelection({
        x: Math.min(drawStart.x, pos.x),
        y: Math.min(drawStart.y, pos.y),
        w: Math.abs(pos.x - drawStart.x),
        h: Math.abs(pos.y - drawStart.y),
      });
  };

  const handleMouseMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = getPos(e);
    lastPointer.current = pos;
    if (drawing.current && (e.buttons & 1) === 0) {
      handleMouseUp(e);
      return;
    }
    const drawStart = dragOrigin.current;
    if (!drawing.current || !drawStart) {
      if (
        !selection &&
        tool === 'select' &&
        session &&
        !session.is_edit &&
        performance.now() - lastHover.current > 100
      ) {
        lastHover.current = performance.now();
        const generation = ++hoverRequest.current;
        invoke<CaptureWindowCandidate[]>('hit_test_candidates', {
          x: pos.x + session.origin_x,
          y: pos.y + session.origin_y,
        })
          .then((items) => {
            if (generation !== hoverRequest.current || selecting.current) return;
            const candidates = items.map((c) => ({
              ...c,
              x: c.x - session.origin_x,
              y: c.y - session.origin_y,
            }));
            setCandidates(candidates);
            setCandidateIdx(candidates.length ? 0 : -1);
            const candidate = candidates[0];
            setHoverRect(
              candidate
                ? { x: candidate.x, y: candidate.y, w: candidate.width, h: candidate.height }
                : null
            );
          })
          .catch(console.error);
      }
      return;
    }
    if (Math.hypot(pos.x - drawStart.x, pos.y - drawStart.y) > 3) dragMoved.current = true;

    if (tool === 'select') {
      updateSelection(pos, drawStart);
    } else if (tool === 'pen' || tool === 'highlight' || tool === 'mosaic' || tool === 'eraser') {
      setCurrentPoints((s) => [...s, [pos.x, pos.y]]);
    } else {
      setCurrentPoints([[pos.x, pos.y]]);
    }
  };

  const handleMouseUp = (e?: { clientX: number; clientY: number }) => {
    const drawStart = dragOrigin.current;
    if (!drawing.current || !drawStart) return;
    const pos = e ? getPos(e) : (lastPointer.current ?? drawStart);
    drawing.current = false;
    dragOrigin.current = null;
    setIsDrawing(false);
    selecting.current = false;
    hoverRequest.current++;
    const pointerId = activePointer.current;
    activePointer.current = null;
    if (pointerId !== null && overlayCanvasRef.current?.hasPointerCapture(pointerId))
      overlayCanvasRef.current.releasePointerCapture(pointerId);

    if (tool === 'select') {
      if (Math.hypot(pos.x - drawStart.x, pos.y - drawStart.y) > 3) dragMoved.current = true;
      updateSelection(pos, drawStart);
      setCompletedSelection((n) => n + 1);
      setDrawStart(null);
      return;
    }

    if (tool === 'text' || tool === 'marker') {
      setDrawStart(null);
      return;
    }

    const lastPt = [pos.x, pos.y];
    const el: AnnotationElement = {
      kind: tool,
      color:
        tool === 'highlight'
          ? ([...COLORS[colorIdx].slice(0, 3), 100] as [number, number, number, number])
          : COLORS[colorIdx],
      width: WIDTHS[widthIdx],
      fontSize,
      x: drawStart.x,
      y: drawStart.y,
      w: lastPt[0] - drawStart.x,
      h: lastPt[1] - drawStart.y,
      x2: lastPt[0],
      y2: lastPt[1],
      points: currentPoints,
      text: '',
      number: markerCounter,
    };
    setRedoStack([]);
    setUndoStack((s) => [...s, elements]);
    setElements((s) => [...s, el]);
    setCurrentPoints([]);
    setDrawStart(null);
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleUndo = () => {
    if (!undoStack.length) return;
    setRedoStack((stack) => [...stack, elements]);
    setElements(undoStack[undoStack.length - 1]);
    setUndoStack(undoStack.slice(0, -1));
  };
  const handleRedo = () => {
    if (!redoStack.length) return;
    setUndoStack((stack) => [...stack, elements]);
    setElements(redoStack[redoStack.length - 1]);
    setRedoStack(redoStack.slice(0, -1));
  };
  const handleToolAction = useCallback(
    async (action: 'ocr' | 'translate' | 'save') => {
      if (!session || busy || !selection || selection.w < 4 || selection.h < 4) return;
      const serial = ++actionSerial.current;
      setBusy(true);
      setError('');
      try {
        const value = await invoke<{ text?: string; translated?: string | null }>(
          'screenshot_tool_action',
          {
            sessionId: session.session_id,
            crop: { x: selection.x, y: selection.y, width: selection.w, height: selection.h },
            elements,
            action,
          }
        );
        if (serial === actionSerial.current && value.text !== undefined)
          setResult({ text: value.text, translated: value.translated });
      } catch (e) {
        if (serial === actionSerial.current && !String(e).includes('cancel')) setError(String(e));
      } finally {
        if (serial === actionSerial.current) setBusy(false);
      }
    },
    [busy, elements, selection, session]
  );
  const launchRegionWorkflow = useCallback(
    async (kind: 'scroll' | 'record') => {
      if (!session || !selection) return;
      if (selection.w < 32 || selection.h < 96) {
        setError('请选择至少32×96像素的区域 / Select a larger region');
        return;
      }
      setBusy(true);
      try {
        const region = {
          x: Math.round(session.origin_x + selection.x),
          y: Math.round(session.origin_y + selection.y),
          width: Math.round(selection.w),
          height: Math.round(selection.h),
        };
        await invoke('cancel_screenshot', { sessionId: session.session_id });
        await invoke('start_region_workflow', { kind, region });
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [session, selection]
  );
  const [watermarkRequested, setWatermarkRequested] = useState(false);
  useEffect(() => {
    if (session && !session.is_edit) setWatermarkRequested(false);
  }, [session]);
  const handleAction = async (action: string) => {
    if (action === 'cancel') {
      void handleCancel();
      return;
    }
    if (busy) return;
    if (CAPTURE_ACTIONS.slice(0, 10).some((a) => a[0] === action)) {
      if (selection || action === 'select') setTool(action as ToolType);
      return;
    }
    if ((action === 'scroll' || action === 'record') && selection && session) {
      void launchRegionWorkflow(action);
    } else if (action === 'undo') handleUndo();
    else if (action === 'redo') handleRedo();
    else if (action === 'confirm' || action === 'copy') void handleConfirm(true, false);
    else if (action === 'pin') void handleConfirm(false, true);
    else if (action === 'next_candidate') handleCycleCandidate();
    else if (action === 'ocr' || action === 'translate' || action === 'save')
      void handleToolAction(action);
    else if ((action === 'edit' || action === 'watermark') && session) {
      setBusy(true);
      try {
        setWatermarkRequested(action === 'watermark');
        await invoke('edit_capture_selection', {
          sessionId: session.session_id,
          elements,
          crop: selection
            ? { x: selection.x, y: selection.y, width: selection.w, height: selection.h }
            : null,
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (
      completedSelection &&
      !autoHandled.current &&
      selection &&
      selection.w > 4 &&
      selection.h > 4 &&
      ['ocr', 'translate', 'scroll', 'record'].includes(session?.intent ?? '')
    ) {
      autoHandled.current = true;
      if (session?.intent === 'scroll' || session?.intent === 'record')
        void launchRegionWorkflow(session.intent);
      else if (session?.intent === 'ocr' || session?.intent === 'translate')
        void handleToolAction(session.intent);
    }
  }, [completedSelection, session, selection, handleToolAction, launchRegionWorkflow]);

  const handleCancel = async () => {
    if (!session) {
      void invoke('close_screenshot_overlay');
      return;
    }
    try {
      await invoke('cancel_screenshot', { sessionId: session.session_id });
    } catch {
      await invoke('close_screenshot_overlay').catch(console.error);
    }
  };

  const handleConfirm = async (copy: boolean, pin: boolean) => {
    if (!session || busy) return;
    setBusy(true);
    try {
      await invoke('finish_screenshot', {
        sessionId: session.session_id,
        imageBase64: null,
        crop:
          selection && selection.w > 4 && selection.h > 4
            ? { x: selection.x, y: selection.y, width: selection.w, height: selection.h }
            : null,
        elements,
        mode: session.is_edit ? 'edit' : 'capture',
        sourceClipId: session.parent_clip_id,
        copyToClipboard: copy,
        pin,
      });
    } catch (e) {
      setError(String(e));
      console.error('Finish screenshot failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const handleCycleCandidate = () => {
    if (candidates.length === 0) return;
    const next = (candidateIdx + 1) % candidates.length;
    setCandidateIdx(next);
    const c = candidates[next];
    if (selection) setSelection({ x: c.x, y: c.y, w: c.width, h: c.height });
    else setHoverRect({ x: c.x, y: c.y, w: c.width, h: c.height });
  };

  const handleTextSubmit = () => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    const el: AnnotationElement = {
      kind: 'text',
      color: COLORS[colorIdx],
      width: WIDTHS[widthIdx],
      fontSize,
      x: textInput.x,
      y: textInput.y,
      w: textInput.value.length * fontSize * 0.6,
      h: fontSize * 1.25,
      x2: 0,
      y2: 0,
      points: [],
      text: textInput.value,
      number: 0,
    };
    setRedoStack([]);
    setUndoStack((s) => [...s, elements]);
    setElements((s) => [...s, el]);
    setTextInput(null);
  };

  const fit = session?.is_edit
    ? Math.min((viewport.width - 48) / session.width, (viewport.height - 120) / session.height, 1)
    : null;
  const bounds =
    session && fit
      ? {
          left: (viewport.width - session.width * fit) / 2,
          top: 32,
          width: session.width * fit,
          height: session.height * fit,
        }
      : {
          left: 0,
          top: 0,
          width: session ? session.width / viewport.dpr : viewport.width,
          height: session ? session.height / viewport.dpr : viewport.height,
        };

  // ── Toolbar position ─────────────────────────────────────────────────────
  const toolbarPos = (() => {
    if (!selection || !session) return { x: 20, y: 20 };
    const ratio = bounds.width / session.width;
    const tx = Math.max(
      8,
      Math.min(bounds.left + selection.x * ratio, viewport.width - toolbarSize.width - 8)
    );
    const height = toolbarSize.height + (tool === 'select' ? 0 : toolbarSize.palette + 8);
    const below = bounds.top + (selection.y + selection.h) * ratio + 12;
    const ty =
      below + height <= viewport.height - 8
        ? below
        : bounds.top + selection.y * ratio - height - 12;
    return { x: tx, y: Math.max(8, Math.min(ty, viewport.height - height - 8)) };
  })();

  // ── Render ───────────────────────────────────────────────────────────────
  if (session?.is_edit && imageEl) {
    return (
      <Suspense fallback={<div className="h-screen bg-[#1e1e1e]" />}>
        <ImageEditor
          initialWatermark={watermarkRequested}
          key={session.session_id}
          image={imageEl}
          sessionId={session.session_id}
          sourceClipId={session.parent_clip_id}
          onCancel={() => void handleCancel()}
        />
      </Suspense>
    );
  }

  if (!session) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: BRAND.graphite }}
      >
        <button onClick={handleCancel} className="text-sm" style={{ color: BRAND.mint }}>
          {error || tGlobal('Loading capture…')}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full select-none overflow-hidden"
      style={{ cursor: 'crosshair', background: session?.is_edit ? '#1e1e1e' : 'transparent' }}
    >
      {/* Frozen desktop */}
      <canvas ref={canvasRef} className="absolute" style={bounds} />
      {/* Overlay (dim + selection + annotations) */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute"
        style={{ ...bounds, touchAction: 'none' }}
        onPointerDown={handleMouseDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerCancel={() => handleMouseUp()}
        onLostPointerCapture={() => handleMouseUp()}
      />

      {error && (
        <button
          className="absolute left-4 top-4 z-50 rounded bg-red-950 px-4 py-2 text-sm text-white"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}
      {busy && (
        <div
          role="status"
          className="absolute left-4 top-4 z-40 rounded-lg border px-4 py-2 text-sm"
          style={toolbarStyle(preferences, systemTheme)}
        >
          {tGlobal('Processing…')}
        </div>
      )}
      {error && /安装|组件|model|component/i.test(error) && (
        <button
          className="absolute left-4 top-16 z-50 rounded-lg border px-4 py-2 text-xs"
          style={toolbarStyle(preferences, systemTheme)}
          onClick={() =>
            void handleCancel()
              .then(() => invoke('open_settings_section', { section: 'components' }))
              .catch((e) => setError(String(e)))
          }
        >
          {tGlobal('Manage components')}
        </button>
      )}
      {/* Window candidates hint */}
      {candidates.length > 1 && selection && (
        <div
          className="absolute z-20 flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{
            left: selection.x,
            top: selection.y - 32,
            background: BRAND.graphite,
            color: BRAND.warmWhite,
            border: `1px solid ${BRAND.mint}40`,
          }}
        >
          <button
            className="rounded px-1 hover:opacity-80"
            style={{ color: BRAND.mint }}
            onClick={handleCycleCandidate}
          >
            ⇄ 切换层级 ({candidateIdx + 1}/{candidates.length})
          </button>
          <span className="opacity-60">
            {candidates[candidateIdx]?.title?.slice(0, 30) || '窗口'}
          </span>
        </div>
      )}

      {/* Text input */}
      {textInput && (
        <div className="absolute z-30" style={{ left: textInput.x, top: textInput.y }}>
          <input
            autoFocus
            className="rounded border px-2 py-1 text-sm outline-none"
            style={{
              borderColor: COLORS[colorIdx].join(','),
              background: 'rgba(24,33,39,0.9)',
              color: BRAND.warmWhite,
              fontSize: `${fontSize}px`,
            }}
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleTextSubmit();
              if (e.key === 'Escape') setTextInput(null);
            }}
            onBlur={handleTextSubmit}
          />
        </div>
      )}

      {/* Toolbar — SnowAir style: dark rounded floating bar */}
      {selection && !isDrawing && (
        <div
          ref={toolbarRef}
          className="absolute z-20 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5 rounded-xl px-2 py-1.5 shadow-lg"
          style={{
            width: 'max-content',
            left: manualToolbar?.x ?? toolbarPos.x,
            top: manualToolbar?.y ?? toolbarPos.y,
            border: '1px solid',
            ...toolbarStyle(preferences, systemTheme),
          }}
        >
          <button
            type="button"
            aria-label={tGlobal('Move toolbar')}
            title={tGlobal('Move toolbar')}
            className="mr-1 cursor-move opacity-50"
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              toolbarDrag.current = {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                left: manualToolbar?.x ?? toolbarPos.x,
                top: manualToolbar?.y ?? toolbarPos.y,
              };
            }}
            onPointerMove={(e) => {
              const drag = toolbarDrag.current;
              if (!drag || drag.id !== e.pointerId) return;
              setManualToolbar({
                x: Math.max(
                  8,
                  Math.min(viewport.width - toolbarSize.width - 8, drag.left + e.clientX - drag.x)
                ),
                y: Math.max(
                  8,
                  Math.min(
                    viewport.height - toolbarSize.height - toolbarSize.palette - 8,
                    drag.top + e.clientY - drag.y
                  )
                ),
              });
            }}
            onPointerUp={(e) => {
              toolbarDrag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              toolbarDrag.current = null;
            }}
            onLostPointerCapture={() => {
              toolbarDrag.current = null;
            }}
          >
            <GripVertical size={16} />
          </button>
          <CaptureToolbarButtons
            preferences={preferences}
            theme={systemTheme}
            active={tool}
            onAction={(action: CaptureAction) => void handleAction(action)}
            disabled={
              busy
                ? preferences.toolbar_order.filter((x) => x !== 'cancel')
                : [...(undoStack.length ? [] : ['undo']), ...(redoStack.length ? [] : ['redo'])]
            }
          />
          {tool !== 'select' && (
            <div
              ref={paletteRef}
              className="absolute left-2 top-full mt-2 flex items-center gap-1 rounded-lg border px-2 py-2 shadow-lg"
              style={toolbarStyle(preferences, systemTheme)}
            >
              {/* Colors */}
              {COLORS.map((c, i) => (
                <button
                  key={i}
                  className="mx-0.5 h-5 w-5 rounded-full border-2 transition-transform"
                  style={{
                    background: `rgba(${c.join(',')})`,
                    borderColor: colorIdx === i ? BRAND.mint : 'transparent',
                    transform: colorIdx === i ? 'scale(1.2)' : 'scale(1)',
                  }}
                  onClick={() => setColorIdx(i)}
                />
              ))}

              <span className="mx-1 h-5 w-px" style={{ background: 'rgba(255,255,255,0.15)' }} />

              {/* Widths */}
              {WIDTHS.map((w, i) => (
                <button
                  key={i}
                  className="mx-0.5 flex h-6 w-6 items-center justify-center rounded"
                  style={{
                    background: widthIdx === i ? 'rgba(121,222,194,0.2)' : 'transparent',
                  }}
                  onClick={() => setWidthIdx(i)}
                >
                  <span
                    className="rounded-full"
                    style={{
                      width: w + 2,
                      height: w + 2,
                      background: widthIdx === i ? BRAND.mint : BRAND.warmWhite,
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && (
        <section
          data-el="capture-result"
          className="absolute left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(640px,90vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-4 shadow-xl"
          style={toolbarStyle(preferences, systemTheme)}
        >
          <div className="mb-3 flex items-center justify-between">
            <strong>{tGlobal(result.translated ? 'Translate' : 'Recognize text')}</strong>
            <button aria-label={tGlobal('Close')} onClick={() => setResult(null)}>
              <X size={17} />
            </button>
          </div>
          <textarea
            aria-label={tGlobal('Recognized text')}
            className="border-current/20 min-h-36 w-full resize-y rounded-lg border bg-transparent p-3 text-sm outline-none"
            value={result.text}
            readOnly
          />
          {result.translated && (
            <textarea
              aria-label={tGlobal('Translation result')}
              className="border-current/20 mt-3 min-h-36 w-full resize-y rounded-lg border bg-transparent p-3 text-sm outline-none"
              value={result.translated}
              readOnly
            />
          )}
          <div className="mt-3 flex justify-end">
            <button
              className="border-current/20 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
              onClick={() =>
                void navigator.clipboard
                  .writeText(result.translated ?? result.text)
                  .catch((e) => setError(String(e)))
              }
            >
              <Copy size={13} />
              {tGlobal('Copy')}
            </button>
          </div>
        </section>
      )}
      {/* Hint bar */}
      <div
        className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs"
        style={{
          background: 'rgba(24,33,39,0.8)',
          color: 'rgba(244,244,236,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {tGlobal('Drag to select')} · {preferences.shortcuts.next_candidate || '–'}:{' '}
        {tGlobal('Window layers')} · {preferences.shortcuts.confirm || '–'}: {tGlobal('Confirm')} ·
        Esc: {tGlobal('Cancel')}
      </div>
    </div>
  );
}

// ── Drawing helpers ────────────────────────────────────────────────────────
function drawElement(ctx: CanvasRenderingContext2D, el: AnnotationElement) {
  const rgba = `rgba(${el.color.join(',')})`;
  ctx.strokeStyle = rgba;
  ctx.fillStyle = rgba;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (el.kind) {
    case 'rect':
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      break;
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(
        el.x + el.w / 2,
        el.y + el.h / 2,
        Math.abs(el.w / 2),
        Math.abs(el.h / 2),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const dx = el.x2 - el.x;
      const dy = el.y2 - el.y;
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(12, el.width * 4);
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLen * Math.cos(angle - Math.PI / 6),
        el.y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLen * Math.cos(angle + Math.PI / 6),
        el.y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
      break;
    }
    case 'pen':
    case 'highlight':
    case 'eraser': {
      if (el.points.length < 2) break;
      if (el.kind === 'highlight') {
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = el.width * 3;
      }
      if (el.kind === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = el.width * 4;
      }
      ctx.beginPath();
      ctx.moveTo(el.points[0][0], el.points[0][1]);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i][0], el.points[i][1]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'mosaic': {
      // Simple pixelated effect using semi-transparent squares
      const size = Math.max(8, el.width * 3);
      ctx.fillStyle = 'rgba(128,128,128,0.6)';
      for (const [px, py] of el.points) {
        ctx.fillRect(Math.floor(px / size) * size, Math.floor(py / size) * size, size, size);
      }
      break;
    }
    case 'text': {
      ctx.font = `${el.fontSize}px "Microsoft YaHei", sans-serif`;
      if (el.bg) {
        const metrics = ctx.measureText(el.text);
        ctx.fillStyle = `rgba(${el.bg.join(',')})`;
        ctx.fillRect(el.x - 4, el.y - el.fontSize, metrics.width + 8, el.fontSize * 1.3);
      }
      ctx.fillStyle = rgba;
      ctx.fillText(el.text, el.x, el.y);
      break;
    }
    case 'marker': {
      const r = Math.max(14, el.fontSize * 0.6);
      ctx.beginPath();
      ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(el.number), el.x, el.y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      break;
    }
    default:
      break;
  }
}
