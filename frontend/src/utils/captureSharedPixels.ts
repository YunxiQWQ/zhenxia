import { invoke } from '@tauri-apps/api/core';
import type { CapturePixelLease } from './captureBitmap';

interface SharedFrameEvent {
  additionalData?: { kind?: string; sessionId?: string; requestId?: string };
  getBuffer: () => ArrayBuffer;
}
export interface CaptureBridge {
  addEventListener: (
    event: 'sharedbufferreceived',
    handler: (event: SharedFrameEvent) => void
  ) => void;
  releaseBuffer: (buffer: ArrayBuffer) => void;
}

// One listener owns late events too, so cancellation/fallback never leaves an
// unclaimed shared mapping waiting for browser garbage collection.
export function createCapturePixelReader(
  bridge: CaptureBridge,
  share: (sessionId: string, requestId: string) => Promise<boolean>,
  fallback: (sessionId: string) => Promise<ArrayBuffer>,
  timeoutMs = 1500
) {
  const pending = new Map<string, { sessionId: string; accept: (buffer: ArrayBuffer) => void }>();
  let sequence = 0;
  bridge.addEventListener('sharedbufferreceived', (event) => {
    const data = event.additionalData;
    if (data?.kind !== 'zhenxia-capture') return;
    const buffer = event.getBuffer();
    const request = data.requestId ? pending.get(data.requestId) : undefined;
    if (!request || request.sessionId !== data.sessionId) {
      bridge.releaseBuffer(buffer);
      return;
    }
    request.accept(buffer);
  });
  return (sessionId: string): Promise<CapturePixelLease> =>
    new Promise((resolve, reject) => {
      const requestId = `${sessionId}:${++sequence}`;
      let settled = false;
      const clean = () => {
        settled = true;
        pending.delete(requestId);
        clearTimeout(timer);
      };
      const useFallback = () => {
        if (settled) return;
        clean();
        fallback(sessionId).then((buffer) => resolve({ buffer, release: () => {} }), reject);
      };
      const timer = setTimeout(useFallback, timeoutMs);
      pending.set(requestId, {
        sessionId,
        accept: (buffer) => {
          if (settled) {
            bridge.releaseBuffer(buffer);
            return;
          }
          clean();
          let released = false;
          resolve({
            buffer,
            release: () => {
              if (!released) {
                released = true;
                bridge.releaseBuffer(buffer);
              }
            },
          });
        },
      });
      share(sessionId, requestId).then(
        (shared) => {
          if (!shared) useFallback();
        },
        () => useFallback()
      );
    });
}

let reader: ReturnType<typeof createCapturePixelReader> | undefined;
export async function readCapturePixels(
  sessionId: string
): Promise<ArrayBuffer | CapturePixelLease> {
  const bridge = (window as unknown as { chrome?: { webview?: CaptureBridge } }).chrome?.webview;
  if (!bridge?.addEventListener || !bridge.releaseBuffer)
    return invoke<ArrayBuffer>('get_capture_pixels', { sessionId });
  reader ??= createCapturePixelReader(
    bridge,
    (sessionId, requestId) => invoke<boolean>('share_capture_pixels', { sessionId, requestId }),
    (sessionId) => invoke<ArrayBuffer>('get_capture_pixels', { sessionId })
  );
  return reader(sessionId);
}
