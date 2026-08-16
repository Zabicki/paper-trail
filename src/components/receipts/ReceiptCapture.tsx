import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseErrorBody } from "@/lib/api-error";
import { downscaleImage } from "./image-downscale";
import ReceiptReview, { type ConfirmItem } from "./ReceiptReview";
import type { Category, Entry, ParsedReceipt } from "@/types";

interface ReceiptCaptureProps {
  expenseCategories: Category[];
  occurredOn: string;
  onBatchSaved: (entries: Entry[]) => void;
}

// Deliberately above the server's RECEIPT_PARSE_TIMEOUT_MS (30s). The server
// knows *why* a parse failed and answers with a typed Polish message; this
// timer only covers the case where no response arrives at all, so it must not
// fire first and replace a precise diagnosis with a generic one.
const CLIENT_TIMEOUT_MS = 35_000;

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
  const [savedCount, setSavedCount] = useState<number | null>(null);

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
  }

  async function handleFile(picked: File) {
    setSavedCount(null);
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
      // never face an unexplained pause of up to half a minute.
      setProgress("Odczytywanie paragonu… może potrwać do 30 sekund.");

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

  function handleCancel() {
    abortRef.current?.abort();
    toIdle();
  }

  async function handleConfirm(items: ConfirmItem[]) {
    setStatus("confirming");
    setError(null);

    let entries: Entry[] | null = null;
    let message: string | null = null;
    try {
      const response = await fetch("/api/receipts/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `occurredOn` is read here, at the confirm click, not at parse time:
        // the user can move the calendar mid-review and the entries belong to
        // whichever day it points at now. The response is then reconciled
        // against selectedDateRef by the parent, which is the S-02 F1 guard.
        body: JSON.stringify({ occurredOn, items }),
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
    setSavedCount(entries.length);
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
        {savedCount !== null && <p className="text-sm text-emerald-400">Zapisano wpisy z paragonu ({savedCount}).</p>}
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
          {/* accept="image/*" and nothing more. Listing image/heic inverts
              Safari 17+'s behaviour and makes it convert your JPEG *to* HEIC.
              No `capture` attribute either: it would force the camera and
              block picking an existing photo from the library. */}
          <input
            type="file"
            accept="image/*"
            aria-label="Zdjęcie paragonu"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              // Cleared so picking the same photo twice still fires a change.
              event.target.value = "";
              if (picked) {
                void handleFile(picked);
              }
            }}
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
      {savedCount !== null && <p className="text-sm text-emerald-400">Zapisano wpisy z paragonu ({savedCount}).</p>}
    </div>
  );
}
