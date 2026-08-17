// Fixes the *upload*, not the CPU bill: a 12 MB body over mobile data is bad
// UX long before base64 encoding becomes a Worker problem. Everything this
// cannot handle falls through to the server-side safety net in
// src/lib/receipt-image.ts, which is exactly what env.IMAGES is bound for.

// Anthropic's standard-tier long-edge cap, and close enough to every other
// candidate provider's that going above it just pays to ship pixels the model
// downscales away again. Kept in step with TARGET_WIDTH in receipt-image.ts.
export const TARGET_LONG_EDGE = 1568;

export interface DownscaleResult {
  blob: Blob;
  // False both when the photo was already small enough and when the browser
  // could not decode it at all. The caller does not need to tell those apart —
  // in both cases the original file goes up untouched.
  resized: boolean;
}

/**
 * Shrinks a picked photo to `TARGET_LONG_EDGE` on its long edge, re-encoded as
 * JPEG.
 *
 * Never rejects. Every step here is a browser capability that legitimately may
 * be absent: Chrome decodes HEIC only on macOS 104+ and Android — never on
 * Windows — and Firefox not at all. A failure is not an error condition, it is
 * the fallback path, so it returns the original `File` and lets `env.IMAGES`
 * normalise it server-side.
 */
export async function downscaleImage(file: File): Promise<DownscaleResult> {
  try {
    // `imageOrientation: "from-image"` bakes the EXIF rotation into the
    // bitmap. Without it a portrait phone photo reaches the model on its side,
    // and OCR on a rotated paragon is the failure that looks like a bad model.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const longEdge = Math.max(bitmap.width, bitmap.height);
      // Never scale *up*. Re-encoding an already-small photo at quality 0.8
      // costs detail the model needs and saves nothing.
      if (longEdge <= TARGET_LONG_EDGE) {
        return { blob: file, resized: false };
      }

      const scale = TARGET_LONG_EDGE / longEdge;
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) {
        return { blob: file, resized: false };
      }
      context.drawImage(bitmap, 0, 0, width, height);

      return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 }), resized: true };
    } finally {
      // Releases the decoded bitmap now rather than at the next GC — a
      // full-resolution phone photo is tens of megabytes once decoded, and the
      // page may go through several receipts in one sitting.
      bitmap.close();
    }
  } catch {
    return { blob: file, resized: false };
  }
}
