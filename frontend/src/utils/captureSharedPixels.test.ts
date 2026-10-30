import { afterEach, expect, it, vi } from 'vitest';
import { CaptureBridge, createCapturePixelReader } from './captureSharedPixels';
import { decodeCaptureBitmap } from './captureBitmap';

function bridgeFixture() {
  let listener: Parameters<CaptureBridge['addEventListener']>[1];
  const bridge = {
    addEventListener: vi.fn((_name, fn) => {
      listener = fn;
    }),
    releaseBuffer: vi.fn(),
  } as CaptureBridge & { releaseBuffer: ReturnType<typeof vi.fn> };
  return {
    bridge,
    send: (requestId: string, buffer: ArrayBuffer, sessionId = 'frame') =>
      listener({
        additionalData: { kind: 'zhenxia-capture', sessionId, requestId },
        getBuffer: () => buffer,
      }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('receives the one-shot mapping and releases it exactly once', async () => {
  const f = bridgeFixture(),
    fallback = vi.fn(),
    share = vi.fn().mockResolvedValue(true);
  const read = createCapturePixelReader(f.bridge, share, fallback);
  const promise = read('frame'),
    buffer = new ArrayBuffer(4);
  f.send(share.mock.calls[0][1], buffer);
  const frame = await promise;
  expect(frame.buffer).toBe(buffer);
  frame.release();
  frame.release();
  expect(f.bridge.releaseBuffer).toHaveBeenCalledExactlyOnceWith(buffer);
  expect(fallback).not.toHaveBeenCalled();
});
it('falls back on unsupported runtimes', async () => {
  const f = bridgeFixture(),
    buffer = new ArrayBuffer(4),
    fallback = vi.fn().mockResolvedValue(buffer);
  const read = createCapturePixelReader(f.bridge, async () => false, fallback);
  const frame = await read('frame');
  expect(frame.buffer).toBe(buffer);
  expect(fallback).toHaveBeenCalledExactlyOnceWith('frame');
});
it('releases late mappings after timeout rather than applying them to another frame', async () => {
  vi.useFakeTimers();
  const f = bridgeFixture(),
    share = vi.fn().mockResolvedValue(true),
    fallback = vi.fn().mockResolvedValue(new ArrayBuffer(4));
  const read = createCapturePixelReader(f.bridge, share, fallback, 20);
  const promise = read('frame');
  await vi.advanceTimersByTimeAsync(25);
  await promise;
  const late = new ArrayBuffer(4);
  f.send(share.mock.calls[0][1], late);
  expect(f.bridge.releaseBuffer).toHaveBeenCalledExactlyOnceWith(late);
  expect(fallback).toHaveBeenCalledOnce();
});
it('distinguishes overlapping requests for the same session', async () => {
  const f = bridgeFixture(),
    share = vi.fn().mockResolvedValue(true),
    fallback = vi.fn();
  const read = createCapturePixelReader(f.bridge, share, fallback);
  const a = read('frame'),
    b = read('frame'),
    first = new ArrayBuffer(4),
    second = new ArrayBuffer(8);
  expect(share.mock.calls[0][1]).not.toBe(share.mock.calls[1][1]);
  f.send(share.mock.calls[1][1], second);
  f.send(share.mock.calls[0][1], first);
  const [one, two] = await Promise.all([a, b]);
  expect(one.buffer).toBe(first);
  expect(two.buffer).toBe(second);
  one.release();
  two.release();
});
it('copies the read-only view and releases it only after bitmap decoding completes', async () => {
  const buffer = new Uint8Array([10, 20, 30, 255]).buffer,
    release = vi.fn();
  let done: (image: ImageBitmap) => void = () => {};
  const decode = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      })
  );
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  );
  const promise = decodeCaptureBitmap(
    { width: 1, height: 1, raw_rgba: true, image_base64: '' },
    async () => ({ buffer, release })
  );
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  expect(decode.mock.calls[0][0].data.buffer).not.toBe(buffer);
  done({} as ImageBitmap);
  await promise;
  expect(release).toHaveBeenCalledOnce();
});
it('releases an invalid frame without presenting it', async () => {
  const release = vi.fn();
  await expect(
    decodeCaptureBitmap({ width: 2, height: 1, raw_rgba: true, image_base64: '' }, async () => ({
      buffer: new ArrayBuffer(4),
      release,
    }))
  ).rejects.toThrow('Invalid screenshot pixel buffer');
  expect(release).toHaveBeenCalledOnce();
});
