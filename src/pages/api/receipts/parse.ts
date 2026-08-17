import type { APIRoute } from "astro";
import { CF_AI_TOKEN, CF_ACCOUNT_ID } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { listCategoriesForEntryForm } from "@/lib/services/entries";
import { normaliseReceiptImage } from "@/lib/receipt-image";
import { parseReceipt } from "@/lib/services/receipts";

// Multipart, not JSON-with-base64: base64 inflates a body by a third before it
// even reaches the Worker, and the Worker has to decode it again. Binary on the
// wire, encoded once, immediately before the provider call.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// The pre-buffer gate's threshold, deliberately ABOVE MAX_IMAGE_BYTES. It is
// compared against Content-Length, which covers the whole multipart envelope
// (boundaries plus part headers) and not just the image part — so gating it on
// MAX_IMAGE_BYTES exactly would reject an image that is legitimately at the
// limit. 64 KB is far more envelope than a single-part form can produce.
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

// Self-guards with getUser() below rather than joining PROTECTED_ROUTES — see
// the convention comment in src/middleware.ts.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Checked here rather than inside the service so an unconfigured deploy
  // answers before reading a 10MB body off the wire. Both halves are required
  // to build the Gateway URL, so either one missing is 503.
  if (!CF_AI_TOKEN || !CF_ACCOUNT_ID) {
    return new Response(JSON.stringify({ error: "Odczyt paragonów nie jest skonfigurowany" }), { status: 503 });
  }

  // Pre-buffer gate. The image.size check below cannot protect the buffer it
  // exists to protect: formData() materialises the ENTIRE body first, so
  // image.size does not exist until those bytes are already in the isolate. A
  // 90 MB upload would reach the 128 MB isolate ceiling and be killed (error
  // 1102), answering 500 instead of the actionable 413 below. Cloudflare
  // enforces the real body length against the declared header, so this is
  // effective against honest and dishonest clients alike.
  //
  // A missing or unparseable header yields Number(null) === 0 / NaN and falls
  // through by design — image.size stays the authoritative check, and it is
  // what still catches a chunked request that declares no length.
  const declaredBytes = Number(context.request.headers.get("content-length"));
  if (declaredBytes > MAX_MULTIPART_BYTES) {
    return new Response(JSON.stringify({ error: "Zdjęcie jest za duże (limit 10 MB)", field: "image" }), {
      status: 413,
    });
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Nieprawidłowe dane formularza" }), { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return new Response(JSON.stringify({ error: "Brak zdjęcia paragonu", field: "image" }), { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return new Response(JSON.stringify({ error: "Zdjęcie jest za duże (limit 10 MB)", field: "image" }), {
      status: 413,
    });
  }

  // Expense only, and recency-ordered — the same list the manual entry form
  // gets. An empty list means there is nothing to classify into, so parsing
  // would burn a paid call to produce items the user could not confirm.
  const categories = await listCategoriesForEntryForm(supabase, "expense");
  if (categories.length === 0) {
    return new Response(JSON.stringify({ error: "Najpierw dodaj przynajmniej jedną kategorię wydatków" }), {
      status: 400,
    });
  }

  const normalised = await normaliseReceiptImage(image);
  const result = await parseReceipt(normalised, categories);

  if (!result.ok) {
    // One status and one message per failure reason. Collapsing these would
    // leave the user unable to tell "try again" from "this will never work".
    if (result.reason === "timeout") {
      return new Response(JSON.stringify({ error: "Odczyt paragonu trwał zbyt długo — spróbuj ponownie" }), {
        status: 504,
      });
    }
    if (result.reason === "unparsable") {
      return new Response(JSON.stringify({ error: "Nie udało się odczytać odpowiedzi z paragonu" }), { status: 502 });
    }
    if (result.reason === "network") {
      return new Response(JSON.stringify({ error: "Brak połączenia z usługą odczytu paragonów" }), { status: 502 });
    }
    return new Response(JSON.stringify({ error: "Usługa odczytu paragonów zwróciła błąd" }), { status: 502 });
  }

  return new Response(JSON.stringify(result.receipt), { status: 200 });
};
