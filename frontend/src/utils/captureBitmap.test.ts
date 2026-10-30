import { afterEach, expect, it, vi } from 'vitest';
import { decodeCaptureBitmap } from './captureBitmap';

afterEach(() => vi.unstubAllGlobals());
it('passes exact binary pixels to the bitmap without PNG encoding or base64 fetching', async () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 100, 200, 255]);
  const bitmap = {} as ImageBitmap;
  const makeBitmap = vi.fn().mockResolvedValue(bitmap);
  const fetch = vi.fn();
  vi.stubGlobal('createImageBitmap', makeBitmap);
  vi.stubGlobal('fetch', fetch);
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
  expect(
    await decodeCaptureBitmap(
      { width: 2, height: 1, raw_rgba: true, image_base64: '' },
      async () => pixels.buffer
    )
  ).toBe(bitmap);
  const [image, options] = makeBitmap.mock.calls[0];
  expect(image.data).toEqual(pixels);
  expect([image.width, image.height]).toEqual([2, 1]);
  expect(options).toEqual({ colorSpaceConversion: 'none' });
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a truncated frame before it can be shown', async () => {
  await expect(
    decodeCaptureBitmap(
      { width: 2, height: 1, raw_rgba: true, image_base64: '' },
      async () => new ArrayBuffer(4)
    )
  ).rejects.toThrow('Invalid screenshot pixel buffer');
});
it('keeps history images on the existing PNG path', async () => {
  const blob = new Blob(['fixture'], { type: 'image/png' });
  const makeBitmap = vi.fn().mockResolvedValue({});
  const readPixels = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => blob }));
  vi.stubGlobal('createImageBitmap', makeBitmap);
  await decodeCaptureBitmap(
    { width: 1, height: 1, raw_rgba: false, image_base64: 'AQID' },
    readPixels
  );
  expect(makeBitmap).toHaveBeenCalledWith(blob, { colorSpaceConversion: 'none' });
  expect(readPixels).not.toHaveBeenCalled();
});
