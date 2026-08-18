import { Buffer } from "node:buffer";
import { z } from "zod";
import { CF_AI_TOKEN, CF_ACCOUNT_ID } from "astro:env/server";
// Shared with the client's sum check rather than copied. The two used to be
// byte-identical local functions; see the header of src/lib/money.ts for why
// that mattered here specifically.
import { roundToCents } from "@/lib/money";
import { truncateCodePoints } from "@/lib/text";
import type { Category, ParsedReceipt, ParsedReceiptItem } from "@/types";

// A product decision, not a platform limit: there is no wall-clock cap on a
// Worker as long as the client stays connected. The ceiling is how long a user
// will plausibly stare at a progress indicator before deciding the app is
// broken — which is why the wait is never silent (see the progress copy in
// ReceiptCapture).
//
// Raised from 30s to 60s: cutting a parse off that the provider would have
// answered costs the user the whole receipt and a re-photograph, which is a
// worse outcome than a longer wait they can see progressing and cancel.
//
// Two paired constants: ReceiptCapture's CLIENT_TIMEOUT_MS must stay ABOVE this
// one, so the server's typed diagnosis wins the race. Change them together.
export const RECEIPT_PARSE_TIMEOUT_MS = 60_000;

// The single string a provider swap turns on. AI Gateway's Unified API takes
// `provider/model`; the endpoint and header contract below are identical
// whichever provider is named, which is the whole reason routing goes through
// the Gateway rather than straight at Google.
//
// The naming *pattern* is documented (google/…, openai/…, anthropic/…); the
// precise Gemini 3 tier string is not, and no call has been made against a real
// gateway yet. If the first live parse returns a provider error naming the
// model, this constant is the only thing that needs to change — the 502 path
// logs the provider's message for exactly that reason.
export const RECEIPT_MODEL = "google/gemini-3-flash";

// Which AI Gateway the request routes through. NOT optional in practice:
// without this header the Unified API silently uses the account's `default`
// gateway, and Unified Billing credits are funded per gateway — so a request
// to an unfunded `default` fails with 402 code 2021 ("Insufficient balance")
// even when the account has credits. That failure is indistinguishable from
// having bought no credits at all, which cost real debugging time once.
//
// A plain constant rather than a third secret: the name is not sensitive, it
// is the same for local and production, and every additional optional secret
// is one more way for a deploy to come up silently misconfigured.
export const RECEIPT_GATEWAY_ID = "paper-trail-gateway";

const GATEWAY_ENDPOINT = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;

// Matches createEntriesBatchSchema's cap and entries.description's bound, so a
// parse can never produce something the confirm endpoint would reject.
const MAX_ITEMS = 100;
const NAME_MAX = 200;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A discriminated result rather than thrown strings: the caller maps each
// reason to a different status code and a different Polish message, and a
// thrown Error would collapse that distinction at exactly the point it matters.
export type ReceiptParseFailure = "timeout" | "provider_error" | "network" | "unparsable";

export type ReceiptParseResult = { ok: true; receipt: ParsedReceipt } | { ok: false; reason: ReceiptParseFailure };

// Guaranteed-JSON is not guaranteed-correct: response_format constrains shape,
// not truthfulness or types under load. So the body is re-parsed here even
// though the request asked for a schema.
//
// Numbers arrive as numbers *usually*. The union tolerates a stringified
// amount and normalises a Polish comma decimal, because the alternative is
// discarding a correctly-read price over a formatting slip.
const numericish = z.union([z.number(), z.string()]).transform((value) => {
  if (typeof value === "number") {
    return value;
  }
  return Number(value.replace(/\s/g, "").replace(",", "."));
});

const modelResponseSchema = z.object({
  receiptDate: z.string().nullish(),
  total: numericish.nullish(),
  items: z
    .array(
      z.object({
        name: z.string(),
        amount: numericish,
        categoryId: z.union([z.number(), z.string()]).nullish(),
      }),
    )
    .nullish(),
});

function buildPrompt(categories: Category[]): string {
  const categoryList = categories.map((category) => `${String(category.id)} — ${category.name}`).join("\n");

  return [
    "Analizujesz zdjęcie polskiego paragonu fiskalnego.",
    "Zwróć wyłącznie JSON zgodny z podanym schematem.",
    "",
    "Kategorie użytkownika (użyj DOKŁADNIE tych identyfikatorów):",
    categoryList,
    "",
    "Zasady:",
    "1. Linie RABAT, OPUST i podobne obniżki NIE są osobnymi pozycjami. Wlicz rabat w cenę pozycji, której dotyczy, i nigdy nie zwracaj go jako produktu.",
    "2. Jedna pozycja na jedną drukowaną linię towaru, z ceną końcową tej linii. Linię typu `2 x 3,49` zwróć jako jedną pozycję o kwocie 6.98.",
    "3. Kwoty zwracaj jako liczby z kropką dziesiętną, nigdy z przecinkiem.",
    "4. Każdej pozycji przypisz jedno categoryId z listy powyżej. Jeśli żadna kategoria nie pasuje, zwróć null.",
    "5. NIGDY nie wymyślaj pozycji, żeby suma się zgadzała. Lepiej zwrócić mniej pozycji niż zmyśloną.",
    "6. total to wydrukowana na paragonie SUMA PLN, a nie suma policzona przez Ciebie.",
    "7. receiptDate to data z paragonu w formacie YYYY-MM-DD, albo null jeśli nieczytelna.",
    "8. Jeśli zdjęcie nie przedstawia paragonu, zwróć pustą listę pozycji.",
  ].join("\n");
}

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "parsed_receipt",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["receiptDate", "total", "items"],
      properties: {
        receiptDate: { type: ["string", "null"] },
        total: { type: ["number", "null"] },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "amount", "categoryId"],
            properties: {
              name: { type: "string" },
              amount: { type: "number" },
              categoryId: { type: ["integer", "null"] },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Everything a model must not be trusted to do itself. Four independent
 * sources converge on the same finding: models tamper with line values to
 * force the sum to match. Nothing here corrects an amount — it only removes
 * what cannot be stored and reports how much it removed.
 */
function sanitise(parsed: z.infer<typeof modelResponseSchema>, allowedCategoryIds: Set<number>): ParsedReceipt {
  const rawItems = parsed.items ?? [];

  let droppedItems = 0;
  const items: ParsedReceiptItem[] = [];

  for (const item of rawItems) {
    // entries.amount is `numeric(10,2) check (amount > 0)` — a zero or
    // negative line literally cannot be stored, so it is dropped here rather
    // than failing the whole batch at confirm time. In practice these are
    // RABAT rows the model emitted as products despite rule 1.
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      droppedItems += 1;
      continue;
    }

    const categoryId = typeof item.categoryId === "string" ? Number(item.categoryId) : (item.categoryId ?? null);

    items.push({
      // Code points, not .slice(): a cut landing mid-surrogate emits a lone
      // surrogate PostgREST cannot store, and the confirm is one atomic
      // statement — so one over-long emoji name would lose the whole receipt.
      name: truncateCodePoints(item.name, NAME_MAX),
      amount: roundToCents(item.amount),
      // A hallucinated id must not reach the confirm endpoint, where it would
      // 404 the entire receipt. Replaced with null so the user reassigns one
      // row instead of losing every row.
      categoryId: typeof categoryId === "number" && allowedCategoryIds.has(categoryId) ? categoryId : null,
    });
  }

  const total = typeof parsed.total === "number" && Number.isFinite(parsed.total) ? roundToCents(parsed.total) : null;
  const receiptDate =
    typeof parsed.receiptDate === "string" && DATE_PATTERN.test(parsed.receiptDate) ? parsed.receiptDate : null;

  return {
    receiptDate,
    total,
    // The cap is a garbled-parse guard, not a real-receipt limit — no paragon
    // has 100 lines. droppedItems deliberately does NOT count the overflow:
    // it names lines removed for being unstorable, which is what the UI note
    // tells the user about.
    items: items.slice(0, MAX_ITEMS),
    droppedItems,
  };
}

/**
 * Sends one receipt photo and the user's expense categories to the model and
 * returns validated, sanitised line items.
 *
 * The caller is responsible for having checked that both secrets are set —
 * this function returns `provider_error` rather than throwing if they are not,
 * so no code path can 500 on a missing key.
 */
export async function parseReceipt(
  image: { bytes: Uint8Array; contentType: string },
  categories: Category[],
): Promise<ReceiptParseResult> {
  if (!CF_AI_TOKEN || !CF_ACCOUNT_ID) {
    return { ok: false, reason: "provider_error" };
  }

  // ~60x faster than the btoa + String.fromCharCode idiom every tutorial
  // shows (1.19ms vs 71.87ms on a 12MB image), against a 10ms Free-plan CPU
  // budget already largely spent on Astro's SSR render. Never swap this out.
  const base64 = Buffer.from(image.bytes).toString("base64");

  let response: Response;
  try {
    response = await fetch(GATEWAY_ENDPOINT(CF_ACCOUNT_ID), {
      method: "POST",
      headers: {
        authorization: `Bearer ${CF_AI_TOKEN}`,
        "content-type": "application/json",
        // NOT cf-aig-collect-log: false, which drops the whole log entry
        // including the cost and latency metadata we want. This one keeps the
        // metadata and suppresses body storage. Body logging is ON by default,
        // so leaving this off would persist every receipt image in
        // Cloudflare's log store — silently contradicting the entire
        // store-nothing design this feature is built on.
        "cf-aig-collect-log-payload": "false",
        "cf-aig-gateway-id": RECEIPT_GATEWAY_ID,
      },
      body: JSON.stringify({
        model: RECEIPT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(categories) },
              { type: "image_url", image_url: { url: `data:${image.contentType};base64,${base64}` } },
            ],
          },
        ],
        response_format: RESPONSE_FORMAT,
      }),
      // Not Promise.race, which leaves the request in flight and only stops
      // listening. This tears the connection down.
      signal: AbortSignal.timeout(RECEIPT_PARSE_TIMEOUT_MS),
    });
  } catch (error) {
    // AbortSignal.timeout() rejects with a DOMException named TimeoutError.
    // A manual .abort() gives AbortError — that one belongs to the client and
    // must never surface here as a provider timeout.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    // The mandatory catch. A bare rejection escaping as an unhandled promise
    // is the regression flagged twice in prior reviews.
    console.error("[receipts] gateway fetch failed", error);
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    // Reading the body consumes it, which is what matters — an unconsumed
    // body leaks the connection. It also makes a wrong RECEIPT_MODEL string
    // diagnosable on the first live call instead of an opaque 502.
    const detail = await response.text().catch(() => "");
    console.error("[receipts] gateway returned", response.status, detail.slice(0, 500));
    return { ok: false, reason: "provider_error" };
  }

  let content: unknown;
  try {
    const body = await response.json<{ choices?: { message?: { content?: string } }[] }>();
    const raw = body.choices?.[0]?.message?.content;
    if (typeof raw !== "string") {
      return { ok: false, reason: "unparsable" };
    }
    content = JSON.parse(raw);
  } catch (error) {
    console.error("[receipts] could not read model response", error);
    return { ok: false, reason: "unparsable" };
  }

  const parsed = modelResponseSchema.safeParse(content);
  if (!parsed.success) {
    console.error("[receipts] model response failed schema", parsed.error.issues[0]);
    return { ok: false, reason: "unparsable" };
  }

  return { ok: true, receipt: sanitise(parsed.data, new Set(categories.map((category) => category.id))) };
}
