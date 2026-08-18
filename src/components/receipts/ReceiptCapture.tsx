import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Camera } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseErrorBody } from "@/lib/api-error";
import { downscaleImage } from "./image-downscale";
import ReceiptReview, { type ConfirmItem } from "./ReceiptReview";
import type { Category, Entry, ParsedReceipt } from "@/types";

interface ReceiptCaptureProps {
  expenseCategories: Category[];
  occurredOn: string;
  onBatchSaved: (entries: Entry[]) => void;
}

// Deliberately above the server's RECEIPT_PARSE_TIMEOUT_MS (60s). The server
// knows *why* a parse failed and answers with a typed Polish message; this
// timer only covers the case where no response arrives at all, so it must not
// fire first and replace a precise diagnosis with a generic one. The 5s margin
// is what guarantees that ordering — keep it when either value moves.
const CLIENT_TIMEOUT_MS = 65_000;

// Whether to offer a direct-camera button at all.
//
// `capture="environment"` is only honoured by mobile browsers; desktop ignores it
// and opens the ordinary file dialog, which would make a button reading "Zrób
// zdjęcie" open a file browser — a small lie, and two controls doing the same
// thing. A coarse pointer is the reliable, synchronous proxy for "phone or
// tablet". enumerateDevices() would name actual cameras but is async and
// permission-shaped, which is far too much for choosing a button.
//
// Read through useSyncExternalStore rather than a useState + useEffect pair:
// matchMedia IS an external store, so this is the shape React documents for it.
// It gets SSR safety from the server snapshot (this island is server-rendered,
// so touching `window` during render would crash the build) and, for free,
// correctness when the pointer type changes under a running page — a tablet
// whose keyboard is attached or detached.
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribeToPointerType(onStoreChange: () => void): () => void {
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => {
    query.removeEventListener("change", onStoreChange);
  };
}

function getPointerIsCoarse(): boolean {
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

// No camera button in the server-rendered markup: it is the choice that cannot
// be wrong before hydration tells us what kind of device this is.
function getPointerIsCoarseOnServer(): boolean {
  return false;
}

type Status = "idle" | "parsing" | "review" | "confirming";

export default function ReceiptCapture({ expenseCategories, occurredOn, onBatchSaved }: ReceiptCaptureProps) {
  // Collapsed to a single button by default, so the dashboard's visual weight —
  // and with it the ≤4-interaction budget for the *manual* entry path directly
  // above — is unchanged for anyone not using receipts today.
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // The date is carried alongside the count because a receipt filed to another
  // day deliberately does not splice into the visible list (DayView's
  // selectedDateRef guard), and a bare "Zapisano (4)" over an unchanged list
  // reads as a failed save. Naming the day is what makes the absence legible.
  const [saved, setSaved] = useState<{ count: number; date: string } | null>(null);
  // The idempotency key for the confirm POST (review finding F4). Minted once
  // per successful parse and held across retries, which is precisely what makes
  // a retry safe: without it, a POST that commits server-side but loses its
  // response leaves the user reading "Spróbuj ponownie" over a button that
  // writes the whole receipt a second time.
  //
  // Per PARSE, not per confirm attempt — re-minting it on each attempt would
  // give every retry a fresh key and reopen the hole. It is cleared by toIdle()
  // alongside `parsed`, so the next receipt gets its own.
  const [batchId, setBatchId] = useState<string | null>(null);

  // See the module-scope comment on COARSE_POINTER_QUERY for why this is a store
  // subscription rather than a one-shot check.
  const touchDevice = useSyncExternalStore(subscribeToPointerType, getPointerIsCoarse, getPointerIsCoarseOnServer);

  const abortRef = useRef<AbortController | null>(null);

  // The repo's async guard (DayView.tsx:37-92) scoped to the island's lifetime
  // rather than to one effect, because the work starts from a click rather
  // than a render. It does a different job from the AbortSignal alongside it:
  // the signal tears the in-flight request down, this stops the setState that
  // would otherwise land afterwards.
  const cancelled = useRef<boolean>(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      abortRef.current?.abort();
    },
    [],
  );

  // Read through a function, never as `cancelled.current` inline. TypeScript
  // narrows a ref's `.current` to `false` after the first check and does not
  // widen it again across an `await`, so every later check in the same
  // function reads as provably dead code and fails no-unnecessary-condition —
  // when flipping mid-await is the entire point of the guard.
  const isCancelled = () => cancelled.current;

  // The URL is created where the file is picked; this only owns revoking it —
  // when it is replaced by the next receipt, and when the island unmounts.
  // Without it every discarded receipt leaks its full-size bitmap for the life
  // of the page, and this flow is built to be used several times in a sitting.
  useEffect(() => {
    if (imageUrl === null) return;
    return () => {
      URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function toIdle() {
    abortRef.current = null;
    setStatus("idle");
    setProgress("");
    setParsed(null);
    setImageUrl(null);
    setBatchId(null);
  }

  async function handleFile(picked: File) {
    setSaved(null);
    setError(null);
    setParsed(null);
    setImageUrl(URL.createObjectURL(picked));
    setStatus("parsing");
    setProgress("Przygotowywanie zdjęcia…");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { blob } = await downscaleImage(picked);
      if (isCancelled() || controller.signal.aborted) return;

      // Continuous visible progress throughout, per the NFR — the user must
      // never face an unexplained pause of up to a minute. The stated ceiling
      // here has to track RECEIPT_PARSE_TIMEOUT_MS: copy that promises less than
      // the timeout allows turns a slow-but-working parse into an apparent hang.
      setProgress("Odczytywanie paragonu… może potrwać do 60 sekund.");

      const form = new FormData();
      form.append("image", blob, "paragon.jpg");

      const response = await fetch("/api/receipts/parse", {
        method: "POST",
        body: form,
        // Two signals, two meanings. AbortSignal.timeout() rejects with a
        // DOMException named TimeoutError; the controller's .abort() gives
        // AbortError. Collapsing them would report a user-initiated cancel as
        // a provider timeout.
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CLIENT_TIMEOUT_MS)]),
      });
      if (isCancelled()) return;

      if (!response.ok) {
        // The route answers with a distinct Polish message per failure — 503
        // unconfigured, 413 too large, 504 timeout, 502 provider — so it is
        // shown rather than replaced with a generic one. This is also what
        // makes the secrets-unset case explain itself instead of throwing.
        const body = await parseErrorBody(response);
        if (isCancelled()) return;
        toIdle();
        setError(body.error);
        return;
      }

      const receipt = await response.json<ParsedReceipt>();
      if (isCancelled()) return;
      setParsed(receipt);
      // Minted here, with the parse it belongs to, so every confirm attempt for
      // this receipt carries the same key.
      setBatchId(crypto.randomUUID());
      setStatus("review");
      setProgress("");
    } catch (caught) {
      if (isCancelled()) return;
      // A user-initiated cancel has already returned the UI to idle. Reporting
      // it would blame the provider for something the user did.
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      // The mandatory catch. A bare rejection surfacing only as a
      // console-logged unhandled rejection is the S-01 F6 / S-03 F7 regression.
      toIdle();
      setError(
        caught instanceof DOMException && caught.name === "TimeoutError"
          ? "Odczyt paragonu trwał zbyt długo — spróbuj ponownie."
          : "Nie udało się połączyć z serwerem. Spróbuj ponownie.",
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  // Shared by both inputs, so the camera path and the gallery path cannot drift.
  function handlePicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Cleared so picking the same photo twice still fires a change.
    event.target.value = "";
    if (picked) {
      void handleFile(picked);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    toIdle();
  }

  // `saveDate` rather than the `occurredOn` prop — named apart from it on
  // purpose, because they are no longer the same thing.
  async function handleConfirm(items: ConfirmItem[], saveDate: string) {
    // Unreachable in practice — the review panel only renders once a parse has
    // succeeded, which is where batchId is set — but sending the confirm without
    // a key would silently produce a non-idempotent write, so it fails loudly
    // instead. Thrown, not rendered, for the reason given at the bottom of this
    // function: the panel owns the button and the message.
    if (batchId === null) {
      throw new Error("Coś poszło nie tak. Spróbuj ponownie.");
    }

    setStatus("confirming");
    setError(null);

    let entries: Entry[] | null = null;
    let message: string | null = null;
    try {
      const response = await fetch("/api/receipts/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The date now comes from the review panel's own field, which is
        // pre-filled from the paragon's printed date where there is a usable
        // one. It is still not captured at parse time — the user can change it
        // right up to the confirm click, and this reads whatever it says then.
        // The response is reconciled against selectedDateRef by the parent,
        // which is the S-02 F1 guard and is what correctly declines to splice a
        // receipt filed to another day into the visible list.
        //
        // `batchId` is the opposite: fixed at parse time and deliberately NOT
        // re-read per attempt, so a retry is recognised as the same write.
        body: JSON.stringify({ occurredOn: saveDate, batchId, items }),
      });
      if (response.ok) {
        entries = await response.json<Entry[]>();
      } else {
        message = (await parseErrorBody(response)).error;
      }
    } catch {
      message = "Nie udało się połączyć z serwerem. Spróbuj ponownie.";
    }

    if (isCancelled()) return;

    if (entries === null) {
      setStatus("review");
      // Thrown rather than rendered here: the review panel owns the button
      // that triggered this and is where the message belongs.
      throw new Error(message ?? "Coś poszło nie tak. Spróbuj ponownie.");
    }

    onBatchSaved(entries);
    setSaved({ count: entries.length, date: saveDate });
    toIdle();
  }

  if (!expanded) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setExpanded(true);
          }}
        >
          Dodaj z paragonu
        </Button>
        {saved !== null && (
          <p className="text-sm text-emerald-400">
            Zapisano wpisy z paragonu ({saved.count}) na {saved.date}.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Persistent rather than dismissible, and stated plainly: these are the
          facts, not a reassurance. Do not embellish them. */}
      <p className="text-muted-foreground text-sm">
        Zdjęcie paragonu i nazwy Twoich kategorii są wysyłane do Cloudflare, a przez Cloudflare do dostawcy modelu. Nie
        są używane do trenowania modeli. Dostawca przechowuje je do 55 dni na potrzeby wykrywania nadużyć. PaperTrail
        nie zapisuje zdjęcia — zostaje tylko w pamięci przeglądarki do czasu zamknięcia panelu.
      </p>

      {status === "idle" && (
        <div className="flex flex-col gap-2">
          {/* The direct-camera route, and on a phone the primary one — a paragon
              is photographed at the till, not found in a gallery. Without this,
              `accept="image/*"` alone does still reach the camera, but only as
              one choice inside the OS sheet, which nothing on screen advertises.

              A <label> wrapping a visually-hidden input rather than a Button
              with a ref-and-click: the native activation behaviour is what makes
              this work on iOS, and the label's own text becomes the input's
              accessible name (so no aria-label here — it would override it). */}
          {touchDevice && (
            <label className={cn(buttonVariants({ variant: "default" }), "min-h-11 cursor-pointer")}>
              <Camera aria-hidden="true" className="size-4 shrink-0" />
              Zrób zdjęcie
              {/* capture="environment" asks for the REAR camera. Omitting the
                  value would let a phone open the selfie camera. */}
              <input type="file" accept="image/*" capture="environment" onChange={handlePicked} className="sr-only" />
            </label>
          )}

          {touchDevice && <span className="text-muted-foreground text-xs">lub wybierz zdjęcie z galerii:</span>}

          {/* accept="image/*" and nothing more. Listing image/heic inverts
              Safari 17+'s behaviour and makes it convert your JPEG *to* HEIC.
              Still no `capture` here on purpose: this is the input that must
              keep reaching an existing photo, which is why the camera got its
              own control above rather than this one changing behaviour. */}
          <input
            type="file"
            accept="image/*"
            aria-label="Zdjęcie paragonu"
            onChange={handlePicked}
            className="file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80 text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-md file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          <div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setExpanded(false);
                setError(null);
              }}
            >
              Zwiń
            </Button>
          </div>
        </div>
      )}

      {status === "parsing" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{progress}</p>
          <div>
            <Button type="button" variant="outline" className="min-h-11" onClick={handleCancel}>
              Anuluj
            </Button>
          </div>
        </div>
      )}

      {(status === "review" || status === "confirming") && parsed !== null && (
        <ReceiptReview
          parsed={parsed}
          imageUrl={imageUrl}
          expenseCategories={expenseCategories}
          occurredOn={occurredOn}
          onConfirm={handleConfirm}
          onDiscard={toIdle}
        />
      )}

      {error !== null && <p className="text-destructive text-sm">{error}</p>}
      {saved !== null && (
        <p className="text-sm text-emerald-400">
          Zapisano wpisy z paragonu ({saved.count}) na {saved.date}.
        </p>
      )}
    </div>
  );
}
