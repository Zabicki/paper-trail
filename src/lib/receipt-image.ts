// Server-side safety net for receipt photos the browser could not downscale
// itself: HEIC from an iPhone, EXIF-rotated originals, or an oversized file
// from a device whose OffscreenCanvas path failed. The happy path is the
// client-side downscale (src/components/receipts/image-downscale.ts); this
// module exists for everything that falls through it.
//
// `env` comes from "cloudflare:workers" — NOT Astro.locals.runtime, which
// @astrojs/cloudflare v13 removed. Nearly every Astro-on-Cloudflare snippet
// online predates that removal, and reaching for it fails at runtime inside
// workerd rather than at type-check.
import { env } from "cloudflare:workers";

// Anthropic's standard-tier long-edge cap, and close enough to every other
// provider's that going above it just means the provider downscales for us.
const TARGET_WIDTH = 1568;

// The threshold for "the client already handled this". Deliberately above
// TARGET_WIDTH: re-encoding a 1900px photo to save 300px of width would burn a
// paid transform to shave a few percent off the request body.
const PASSTHROUGH_MAX_WIDTH = 2000;

// Formats every candidate provider accepts directly. Anything else — HEIC
// above all — has to be converted or the model call fails on content type.
const PASSTHROUGH_FORMATS = new Set(["image/jpeg", "image/png", "image/webp"]);

const FALLBACK_CONTENT_TYPE = "image/jpeg";

export interface NormalisedImage {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Returns bytes ready to base64-encode into the model request.
 *
 * `.info()` is never billed; `.transform().output()` counts against the free
 * 5,000 transforms/month. So info gates transform, rather than transforming
 * unconditionally — on the common path (a JPEG the client already shrank)
 * this costs nothing and returns the original bytes untouched.
 *
 * NOTE: the local `env.IMAGES` mock supports only width/height/rotate/format
 * and silently ignores anything else — a probe passing blur/quality/fit and a
 * bogus option returned HTTP 200 with a valid JPEG every time. Any transform
 * parameter beyond those must be verified with `wrangler dev --remote`, never
 * against `astro dev`.
 */
export async function normaliseReceiptImage(file: File): Promise<NormalisedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // .info() and .input() each consume the stream they are given, so every
  // binding call needs its own. Streamed straight off the File rather than from
  // `new Blob([bytes])`: a Blob is re-readable, so file.stream() is safe to call
  // more than once, and it avoids a second full-size copy of the upload living
  // in the isolate alongside `bytes` (which the passthrough and fallback returns
  // below still need). At the 10 MB limit that copy is not free — see the
  // Content-Length gate in src/pages/api/receipts/parse.ts.
  let format: string;
  let width: number;
  try {
    const info = await env.IMAGES.info(file.stream());
    // An SVG comes back without dimensions. Nothing photographs a receipt as
    // SVG, so treat it as "needs normalising" rather than special-casing it.
    if (!("width" in info)) {
      throw new Error("no raster dimensions");
    }
    format = info.format;
    width = info.width;
  } catch {
    // Undecodable by the Images binding. Not fatal and not worth a distinct
    // error: hand the original bytes to the provider and let its own decoder
    // decide. A genuinely unreadable image comes back as an empty item list,
    // which the UI already handles.
    return { bytes, contentType: file.type || FALLBACK_CONTENT_TYPE };
  }

  if (PASSTHROUGH_FORMATS.has(format) && width <= PASSTHROUGH_MAX_WIDTH) {
    return { bytes, contentType: format };
  }

  try {
    const output = await env.IMAGES.input(file.stream())
      .transform({ width: TARGET_WIDTH, fit: "scale-down" })
      .output({ format: FALLBACK_CONTENT_TYPE, quality: 80 });

    const transformed = new Uint8Array(await output.response().arrayBuffer());
    return { bytes: transformed, contentType: FALLBACK_CONTENT_TYPE };
  } catch {
    // A failed transform must not lose the upload. Falling back to the
    // original bytes means an oversized photo costs a slower request rather
    // than an error the user cannot act on.
    return { bytes, contentType: format };
  }
}
