import { getBodyPhoto, resolvePublicUrlForPart, uploadAsPng } from "@/lib/snap";
import { CATEGORY_TO_BODY_PART, type Category } from "@/types";

export interface TryOnRequest {
  category: Category;
  productImageUrl: string;
  // Hex string ("#FF7AAF") — only used by category === "hair".
  paletteHex?: string;
  // When set, skip the per-body-part lookup and use this URL as the source
  // photo. The corrective retry pipeline uses this to submit mutated variants
  // without disturbing the user's saved body shots.
  srcImageUrlOverride?: string;
  // When true, the worker skips the GPT-4o-mini vision preflight. We use
  // this on corrective retries where the original photo already passed the
  // preflight — re-running it would add latency without changing the answer.
  skipPreflight?: boolean;
}

export interface TryOnResult {
  resultImageUrl: string;
  taskId: string;
}

// Thrown when the proxy returns a non-2xx response. `code` is YouCam's numeric
// error code if the worker surfaced it; the corrective retry pipeline reads it
// to decide whether the failure is fixable by mutating the source photo.
export class TryOnError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "TryOnError";
    this.code = code;
    // Codes 2 and 4 = YouCam body-part detection / framing issues, which the
    // mutate-and-retry pipeline can sometimes fix. "preflight" means GPT
    // already rejected the photo — mutating won't change that judgment.
    // Everything else (network, plan limits) is non-retryable.
    this.retryable = code === "2" || code === "4";
  }
}

const PROXY_URL = process.env.EXPO_PUBLIC_TRYON_PROXY_URL;
const ONME_API_TOKEN = process.env.EXPO_PUBLIC_ONME_API_TOKEN;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ONME_API_TOKEN) h["X-Onme-Token"] = ONME_API_TOKEN;
  return h;
}

export async function runTryOn(req: TryOnRequest): Promise<TryOnResult> {
  if (!PROXY_URL) {
    throw new Error(
      "EXPO_PUBLIC_TRYON_PROXY_URL not set — deploy worker/ and set in .env.local",
    );
  }

  const part = CATEGORY_TO_BODY_PART[req.category];
  // Hair-color is the picky endpoint: YouCam rejects some JPGs as
  // "Unsupported image type". For hair (and only hair) re-upload the local
  // photo as a freshly-encoded PNG capped at 1024px first. Caches by part
  // are bypassed because the cached URL might be a JPG that already failed.
  let srcImageUrl: string;
  if (req.srcImageUrlOverride) {
    srcImageUrl = req.srcImageUrlOverride;
  } else if (req.category === "hair") {
    const local = await getBodyPhoto(part);
    srcImageUrl = local
      ? await uploadAsPng(local)
      : await resolvePublicUrlForPart(part);
  } else {
    srcImageUrl = await resolvePublicUrlForPart(part);
  }

  const res = await fetch(`${PROXY_URL}/tryon`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      category: req.category,
      srcImageUrl,
      productImageUrl: req.productImageUrl,
      paletteHex: req.paletteHex,
      skipPreflight: req.skipPreflight,
    }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new TryOnError(
      payload?.error ?? `Try-on failed (${res.status})`,
      payload?.code,
    );
  }
  return (await res.json()) as TryOnResult;
}

export interface DiagnoseRequest {
  category: Category;
  srcImageUrl: string;
  errorMessage: string;
  triedStrategies: string[];
}

export interface DiagnoseResult {
  strategy: string | null;
  reason: string;
}

// Ask the worker (which calls GPT-4o-mini vision) to recommend the next
// mutation strategy after the static plan has been exhausted.
export async function diagnoseStrategy(
  req: DiagnoseRequest,
): Promise<DiagnoseResult> {
  if (!PROXY_URL) return { strategy: null, reason: "no proxy" };
  try {
    const res = await fetch(`${PROXY_URL}/diagnose`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify(req),
    });
    if (!res.ok) return { strategy: null, reason: `${res.status}` };
    return (await res.json()) as DiagnoseResult;
  } catch (err) {
    return { strategy: null, reason: String(err) };
  }
}
