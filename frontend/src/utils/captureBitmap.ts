interface CapturePixels {
  width: number;
  height: number;
  raw_rgba: boolean;
  image_base64: string;
}

export interface CapturePixelLease {
  buffer: ArrayBuffer;
  release: () => void;
}

// Raw capture pixels arrive as ArrayBuffer, never an array serialized as JSON.
// Existing history editor sessions retain their PNG source and decoding path.
export async function decodeCaptureBitmap(
  source: CapturePixels,
  readPixels: () => Promise<ArrayBuffer | CapturePixelLease>
): Promise<ImageBitmap> {
  if (source.raw_rgba) {
    const frame = await readPixels();
    const pixels = frame instanceof ArrayBuffer ? frame : frame.buffer;
    try {
      const expected = source.width * source.height * 4;
      if (
        !(pixels instanceof ArrayBuffer) ||
        !Number.isSafeInteger(expected) ||
        expected <= 0 ||
        pixels.byteLength !== expected
      )
        throw new Error('Invalid screenshot pixel buffer');
      return await createImageBitmap(
        // Shared mappings are read-only. ImageData owns a writable copy, so
        // downstream canvas operations can never write into protected memory.
        new ImageData(
          frame instanceof ArrayBuffer
            ? new Uint8ClampedArray(pixels)
            : new Uint8ClampedArray(new Uint8Array(pixels)),
          source.width,
          source.height
        ),
        { colorSpaceConversion: 'none' }
      );
    } finally {
      if (!(frame instanceof ArrayBuffer)) frame.release();
    }
  }
  const blob = await fetch(`data:image/png;base64,${source.image_base64}`).then((r) => r.blob());
  return createImageBitmap(blob, { colorSpaceConversion: 'none' });
}
