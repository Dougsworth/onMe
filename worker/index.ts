// Cloudflare Worker: proxies YouCam Online Editor try-on calls so the
// sk- bearer token never ships in the mobile binary.
//
// Single endpoint:
//   POST /tryon  { category, srcImageUrl, productImageUrl }
//     → starts a task, polls until success/error, returns { resultImageUrl }
//
// The YouCam API takes public HTTPS URLs directly. The app uploads selfies
// to Supabase Storage first to get a public URL.
//
// Deploy:
//   cd worker
//   npx wrangler login
//   npx wrangler secret put PERFECTCORP_API_KEY   # paste sk-... from YouCam
//   npx wrangler deploy

type Category =
  | "watch"
  | "ring"
  | "necklace"
  | "earring"
  | "bracelet"
  | "outfit"
  | "hair";

interface Env {
  PERFECTCORP_API_KEY: string;
  // Optional — when present, every /tryon request runs through a GPT-4o-mini
  // vision preflight that rejects photos guaranteed to fail at YouCam.
  OPENAI_API_KEY?: string;
  // Optional — when present, /scan-look uses SerpAPI's Google Lens engine
  // for true reverse-image visual product matching instead of GPT's
  // text-based web search.
  SERPAPI_KEY?: string;
  // Optional — when present, /detect uses Replicate's grounding-dino for
  // pixel-perfect bounding boxes (so Lens crops are tight, not approximate).
  REPLICATE_API_TOKEN?: string;
  // Required in production — clients must send X-Onme-Token: <ONME_API_TOKEN>.
  // Without this, anyone with the worker URL can drain our YouCam / OpenAI /
  // Replicate / SerpAPI budgets (every endpoint chains paid APIs). When unset
  // the worker runs in "dev open" mode (logs a warning per request).
  ONME_API_TOKEN?: string;
  // Comma-separated host allowlist for srcImageUrl / productImageUrl /
  // imageUrl. Hosts not in this list are rejected as 400. Defaults to the
  // Supabase project + YouCam plugin host when unset.
  IMAGE_HOST_ALLOWLIST?: string;
}

interface TryOnReq {
  category: Category;
  srcImageUrl: string;
  productImageUrl: string;
  // Hex color, only used when category === "hair".
  paletteHex?: string;
}

const HOST = "https://yce-api-01.makeupar.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function buildRequest(req: TryOnReq): { path: string; body: unknown } {
  const { category, srcImageUrl, productImageUrl, paletteHex } = req;

  if (category === "hair") {
    if (!paletteHex) {
      throw new Error("paletteHex is required for category=hair");
    }
    return {
      path: "/s2s/v2.0/task/hair-color",
      body: {
        src_file_url: srcImageUrl,
        pattern: { name: "full", parameter: {} },
        palettes: [{ color: paletteHex }],
      },
    };
  }

  if (category === "outfit") {
    return {
      path: "/s2s/v3.0/task/cloth",
      body: {
        src_file_url: srcImageUrl,
        ref_file_url: productImageUrl,
        garment_category: "auto",
      },
    };
  }

  const path = `/s2s/v2.0/task/2d-vto/${category}`;
  // need_remove_background: true → YouCam strips the product photo's
  // background server-side before compositing. We turn this ON for every
  // category because our product images come from SerpAPI / Lens / Yandex
  // and rarely have clean isolated backgrounds. Without this, the
  // surrounding pixels of the product photo get baked into the render and
  // produce halos / strap artifacts at edges.
  //
  // Shadow + ambient tuning is a quality lever — the YouCam defaults are
  // very flat. We bump shadow intensity and lower ambient light slightly
  // so items sit on the body with more depth.
  const parameter = (() => {
    switch (category) {
      case "ring":
        return {
          ring_need_remove_background: true,
          ring_wearing_finger: 3,
          ring_wearing_location: 0,
          ring_shadow_intensity: 0.25,
          ring_ambient_light_intensity: 0.9,
        };
      case "watch":
        return {
          watch_need_remove_background: true,
          watch_wearing_location: 0,
          watch_shadow_intensity: 0.3,
          watch_ambient_light_intensity: 0.85,
        };
      case "bracelet":
        return {
          bracelet_need_remove_background: true,
          bracelet_wearing_location: 0,
          bracelet_shadow_intensity: 0.4,
          bracelet_ambient_light_intensity: 0.85,
        };
      case "earring":
        return {
          earring_need_remove_background: true,
          earring_shadow_intensity: 0.4,
          earring_ambient_light_intensity: 0.85,
          earring_occluded_type: 0,
          earring_is_right_ear: true,
        };
      case "necklace":
        return {
          necklace_need_remove_background: true,
          necklace_shadow_intensity: 0.55,
          necklace_ambient_light_intensity: 0.5,
        };
    }
  })();

  const body: Record<string, unknown> = {
    src_file_url: srcImageUrl,
    source_info: { name: srcImageUrl },
    ref_file_urls: [productImageUrl],
    ref_file_ids: [],
    object_infos: [{ name: productImageUrl, parameter }],
  };
  if (category !== "necklace") {
    body.refmsk_file_urls = [];
    body.refmsk_file_ids = [];
  }
  return { path, body };
}

async function startTask(req: TryOnReq, key: string): Promise<{ taskId: string; basePath: string }> {
  const { path, body } = buildRequest(req);
  const url = `${HOST}${path}`;
  console.log("[tryon] →", url, JSON.stringify(body).slice(0, 500));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("[tryon] ←", res.status, text.slice(0, 600));
  if (!res.ok) {
    throw new Error(`Start ${req.category} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { data?: { task_id?: string } };
  if (!json.data?.task_id) {
    throw new Error(`No task_id in response: ${text.slice(0, 300)}`);
  }
  return { taskId: json.data.task_id, basePath: path };
}

interface PollPayload {
  data?: {
    task_status?: string;
    error?: string;
    error_message?: string;
    results?: unknown;
    result?: unknown;
  };
}

// Thrown when YouCam reports a render failure we can show the user verbatim
// (e.g. "Hand size should fit in range."). The fetch handler turns these into
// 422 responses with structured fields so the client can render them cleanly.
class TryOnError extends Error {
  readonly userFacing: string;
  readonly code?: string;
  readonly debug?: string;
  constructor(userFacing: string, code?: string, debug?: string) {
    super(userFacing);
    this.userFacing = userFacing;
    this.code = code;
    this.debug = debug;
  }
}

// YouCam's numeric `error` codes when no `error_message` is provided.
const ERROR_CODE_HINTS: Record<string, string> = {
  "2": "We couldn't find the right body part in your photo. Try a clearer shot.",
  "3": "That photo isn't quite usable — try better light or framing.",
  "4": "Frame the body part a bit differently — too close or too far.",
};

// Pattern-match against `error_message` so we surface useful guidance even
// when YouCam's response leaks Python tracebacks. The first match wins.
const FRIENDLY_PATTERNS: { match: RegExp; message: string }[] = [
  { match: /face alignment/i,           message: "We couldn't read your face clearly. Try a brighter, head-on shot." },
  { match: /hand size/i,                message: "Hand framing's off — fill more of the frame, palm forward." },
  { match: /face.*too\s*small|src_face_too_small/i, message: "Face is too small in the photo. Get closer or zoom in." },
  { match: /face.*too\s*(big|large)/i,  message: "Face is too close — step back a bit." },
  { match: /(below.*min.*image.*size|min_image_size)/i, message: "That photo is too low-resolution. Try a higher-quality shot." },
  { match: /(no.*body.*part|cannot.*detect|not.*detected|detection.*fail)/i, message: "We couldn't spot the body part. Try a clearer shot." },
  { match: /download.*image|fetch.*image/i, message: "Couldn't load your photo. Check your connection and retry." },
];

// Strings that indicate a leaked internal/traceback rather than user-facing
// copy. If error_message matches none of FRIENDLY_PATTERNS but does match
// one of these, we fall back to the generic message.
const INTERNAL_NOISE = [
  /nonetype/i,
  /\btraceback\b/i,
  /subscriptable/i,
  /attributeerror/i,
  /keyerror/i,
  /typeerror/i,
  /\bvalueerror\b/i,
  /\binternal server error\b/i,
];

function isLeakedInternal(msg: string): boolean {
  return INTERNAL_NOISE.some((re) => re.test(msg));
}

function friendlyFromPayload(payload: PollPayload, fallback: string): string {
  const msg = payload.data?.error_message?.trim();
  if (msg) {
    for (const { match, message } of FRIENDLY_PATTERNS) {
      if (match.test(msg)) return message;
    }
    if (!isLeakedInternal(msg)) return msg;
  }
  const code = payload.data?.error;
  if (code && ERROR_CODE_HINTS[code]) return ERROR_CODE_HINTS[code];
  return fallback;
}

function extractResultUrl(payload: PollPayload): string | null {
  const data = payload.data;
  if (!data) return null;
  const candidates: unknown[] = [
    (data.results as { url?: string } | undefined)?.url,
    (data.result as { url?: string } | undefined)?.url,
    Array.isArray(data.results) ? (data.results[0] as { url?: string } | undefined)?.url : undefined,
    Array.isArray(data.results)
      ? (data.results[0] as { dst_image?: string } | undefined)?.dst_image
      : undefined,
    (data.results as { dst_image?: string } | undefined)?.dst_image,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

async function pollTask(basePath: string, taskId: string, key: string): Promise<string> {
  const url = `${HOST}${basePath}/${taskId}`;
  const deadline = Date.now() + 180_000;
  let attempt = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    attempt += 1;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const text = await res.text();
    lastBody = `http=${res.status} body=${text.slice(0, 500)}`;
    console.log("[poll]", attempt, lastBody);
    if (!res.ok) continue;
    let json: PollPayload;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const status = json.data?.task_status;
    if (status === "success") {
      const resultUrl = extractResultUrl(json);
      if (resultUrl) return resultUrl;
      throw new Error(`Success but no result URL — full payload: ${text.slice(0, 600)}`);
    }
    if (status === "error") {
      const friendly = friendlyFromPayload(json, "Try-on couldn't render that photo.");
      throw new TryOnError(friendly, json.data?.error, text.slice(0, 600));
    }
  }
  throw new Error(`Timed out after ${attempt} polls. Last response: ${lastBody}`);
}

// ---- Preflight: GPT-4o-mini vision check before submitting to YouCam ----
//
// Each entry is a list of REJECT-ONLY conditions. We deliberately phrase
// preflight as "reject only when X is true" rather than "require X" so GPT
// doesn't over-police photos that YouCam would actually render fine.

const REJECT_REASONS: Record<Category, string[]> = {
  watch: [
    "no wrist or arm visible at all",
    "the entire arm is covered (long sleeve fully covering the wrist)",
    "image is severely blurry or almost entirely black",
  ],
  bracelet: [
    "no wrist or arm visible at all",
    "the entire arm is covered (long sleeve fully covering the wrist)",
    "image is severely blurry or almost entirely black",
  ],
  ring: [
    "no hand or fingers visible at all",
    "fingers are completely clenched into a fist with no flat surface",
    "image is severely blurry or almost entirely black",
  ],
  necklace: [
    "no face or neck visible at all",
    "subject is shown only from the back of the head",
    "image is severely blurry or almost entirely black",
  ],
  earring: [
    "no face visible at all",
    "no ear is visible (e.g., back of head only, or both ears completely covered by hair/hat)",
    "image is severely blurry or almost entirely black",
  ],
  outfit: [
    "no person visible at all",
    "only a face/head is shown (no body)",
    "image is severely blurry or almost entirely black",
  ],
  hair: [
    "no head or hair visible at all",
    "subject is wearing a full hat/wrap covering all hair",
    "image is severely blurry or almost entirely black",
  ],
};

interface PreflightResult {
  ok: boolean;
  reason?: string;
}

async function preflight(
  category: Category,
  srcImageUrl: string,
  key: string,
): Promise<PreflightResult> {
  const reasons = REJECT_REASONS[category]
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join("\n");
  const system = `You're a lenient gatekeeper for a ${category} virtual try-on. Default to GOOD. ONLY return BAD when at least one of these conditions is unambiguously true:

${reasons}

Borderline framing, mediocre lighting, slight tilts, partial visibility — all GOOD. The downstream renderer is robust; your job is just to catch impossible inputs.

Reply with EXACTLY one of:
GOOD
or
BAD: <one short reason matching the conditions above, 10 words or less>`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 40,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: "Is this photo usable for the try-on?" },
            { type: "image_url", image_url: { url: srcImageUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn("[preflight] non-200, failing open:", res.status, text.slice(0, 200));
    return { ok: true };
  }
  const json = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = (json.choices?.[0]?.message?.content ?? "").trim();
  console.log("[preflight]", category, "→", reply.slice(0, 120));
  if (/^good\b/i.test(reply)) return { ok: true };
  const reason = reply.replace(/^bad\s*:\s*/i, "").trim() || "Photo isn't quite usable";
  return { ok: false, reason };
}

// ---- TikTok extraction via tikwm.com (no auth, free, ~1 req/sec) ----

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(url);
}

interface TikTokInfo {
  videoId: string;
  videoUrl: string;
  coverUrl: string;
  title: string;
  duration: number;
  author: { username: string; nickname: string; avatar: string };
}

async function extractTikTokDebug(
  url: string,
): Promise<{ info: TikTokInfo | null; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { tried: [] };

  // Try multiple tikwm hosts and request shapes — they sometimes block
  // Cloudflare-egress IPs depending on the variant.
  const attempts = [
    {
      label: "GET tikwm.com",
      url: `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      method: "GET" as const,
    },
    {
      label: "POST tikwm.com",
      url: "https://www.tikwm.com/api/",
      method: "POST" as const,
      body: `url=${encodeURIComponent(url)}&hd=1`,
    },
    {
      label: "GET api2.tikwm.com",
      url: `https://api2.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      method: "GET" as const,
    },
  ];

  for (const a of attempts) {
    const attemptLog: Record<string, unknown> = { label: a.label };
    try {
      const res = await fetch(a.url, {
        method: a.method,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          ...(a.method === "POST"
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
          Accept: "application/json, text/plain, */*",
        },
        body: a.method === "POST" ? a.body : undefined,
        signal: AbortSignal.timeout(15000),
      });
      attemptLog.status = res.status;
      const text = await res.text();
      attemptLog.bodyPreview = text.slice(0, 300);
      (debug.tried as Record<string, unknown>[]).push(attemptLog);
      if (!res.ok) continue;
      const json = JSON.parse(text) as {
        code?: number;
        msg?: string;
        data?: {
          id?: string;
          hdplay?: string;
          play?: string;
          cover?: string;
          origin_cover?: string;
          title?: string;
          duration?: number;
          author?: { unique_id?: string; nickname?: string; avatar?: string };
        };
      };
      if (json.code !== 0 || !json.data) continue;
      const d = json.data;
      return {
        info: {
          videoId: d.id ?? "",
          videoUrl: d.hdplay || d.play || "",
          coverUrl: d.origin_cover || d.cover || "",
          title: d.title ?? "",
          duration: d.duration ?? 0,
          author: {
            username: d.author?.unique_id ?? "",
            nickname: d.author?.nickname ?? "",
            avatar: d.author?.avatar ?? "",
          },
        },
        debug,
      };
    } catch (err) {
      attemptLog.error = err instanceof Error ? err.message : String(err);
      (debug.tried as Record<string, unknown>[]).push(attemptLog);
    }
  }

  return { info: null, debug };
}

// ---- Scan Look: detect wearable items + scrape real products for them ----
//
// Two-stage pipeline (one GPT-4o-mini vision call + one web-search call per
// detected item):
//   1. Vision: list every wearable item across the image(s)
//   2. Web search: for each detection, find the actual product on the web
//      and return brand/name/price/image_url/buy_link
//
// Web-scraped image URLs are returned as-is — the client uploads them to
// Supabase before sending to YouCam (since YouCam can't fetch arbitrary hosts).

interface ScanLookCatalogItem {
  id: string;
  category: string;
  brand: string;
  name: string;
  caption: string;
}

interface ScanLookRequest {
  imageUrls: string[];
  catalog: ScanLookCatalogItem[];
}

interface RealProduct {
  brand: string;
  name: string;
  price: string;
  imageUrl: string;
  buyLink: string;
}

interface BBox {
  // Normalized 0-1 of image dimensions, top-left origin.
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ScanDetection {
  category: string;
  description: string;
  catalogId: string | null;
  confidence: number;
  bbox: BBox | null;
  // Which frame index in imageUrls this detection was seen on (best frame).
  frameIdx: number;
  real: RealProduct | null;
}

interface ScanLookResponse {
  detections: ScanDetection[];
}

async function detectItems(
  imageUrls: string[],
  catalog: ScanLookCatalogItem[],
  key: string,
): Promise<Omit<ScanDetection, "real">[]> {
  const catalogSummary = catalog
    .map(
      (c) => `[${c.id}] ${c.brand} · ${c.name} (${c.category}${c.caption ? ` · ${c.caption}` : ""})`,
    )
    .join("\n");

  const system = `You analyze fashion photos / video frames for OnMe (a virtual try-on app) and surface every wearable item you can see.

GOAL: be generous in detection — better to surface a borderline item than miss a real one — but be PRECISE with categories and rich with descriptions.

CATEGORIES (pick exactly one):
- watch, ring, necklace, earring, bracelet, outfit, hair (try-on supported)
- sunglasses, glasses, hat, bag, scarf, shoes, belt, makeup (shop-only, still surface them)

CRITICAL — CATEGORY DISAMBIGUATION (common mistakes to avoid):
- "necklace" = a chain/cord/strand resting AROUND the neck, hanging in front of skin or fabric. NOT: a printed chain graphic, a printed pendant motif, a logo on a t-shirt, or rope detail on clothing.
- "outfit" = a top / dress / jacket / pants / hoodie etc. If you see a t-shirt with a graphic print of a chain or pendant, the category is "outfit", NOT "necklace". The graphic is part of the description, not the item.
- "earring" = visible jewelry piercing the ear lobe / cartilage. NOT: hair detail near the ear, an airpod, or a hat strap.
- "ring" = jewelry encircling a finger. NOT: a bracelet on the wrist, a watch face, or a logo on clothing.
- "bag" = a carried/held container with handles. NOT: a backpack strap interpreted alone, NOT a logo on clothing.
- "hair" = the actual hairstyle/color of the person, only when notable enough to matter. Don't return generic "brown hair".
- When in doubt between a clothing item and a jewelry/accessory item, default to "outfit". Jewelry must be physically separate from the fabric, on bare skin or clearly hanging.

DESCRIPTION (this is the SINGLE most important field — it's the search query that finds the real product):
- 25 words max. Pack as much identifying detail as possible.
- READ AND INCLUDE every visible cue under these headings (skip ones that don't apply):
  1. Color(s) — be specific about shade ("muted dusty rose", "deep forest green", NOT just "pink" or "green"). Note any color-blocking.
  2. Pattern — solid / striped (and stripe direction + width) / floral / plaid / tie-dye / camo / abstract / graphic / animal print / paisley / polka dot. Mention scale ("micro floral", "oversized check").
  3. Print / graphic content — if there's a graphic on the item, describe WHAT it depicts as specifically as you can (e.g., "Spy x Family anime characters in pink and yellow", "Chicago Bulls logo", "vintage rock band tour list").
  4. Material / texture — denim, leather, knit, satin, mesh, terry, corduroy, sequins, tulle, ribbed, cable knit, suede, patent.
  5. Silhouette / cut / fit — cropped, oversized, fitted, baggy, A-line, bodycon, boxy, relaxed, tapered, wide-leg, high-waist, low-rise.
  6. Construction details — neckline (crew, V, scoop, square, halter, off-shoulder), sleeve length (short, long, ¾, sleeveless, puff, balloon), garment length (mini, midi, maxi, knee-length).
  7. Hardware / closures — zips, buttons, drawstring, snap, lace-up, tie, buckle, hook-and-eye, magnetic. Mention metal color (gold, silver, gunmetal).
  8. Distinguishing marks — logos (state location: chest, sleeve, hem), embroidery, distressing, washes (acid wash, stone wash, raw hem), contrast stitching, panels, pockets.
  9. ANY VISIBLE BRAND TEXT — if you can read a label, tag, monogram, or printed brand name on the garment, include it verbatim in quotes (e.g., "Stüssy" stitched on chest). This is the highest-value detail by far.

- Examples of EXCELLENT descriptions:
  - "Cream cropped knit cardigan with pearl-button front, balloon sleeves, scallop hem, faint micro-cable texture across body."
  - "Black solid halter bikini top with gold ring hardware at bust, matching low-rise tie-side bottoms."
  - "Loose vintage-wash mid-blue baggy denim jeans, raw frayed hem, contrast white stitching, rear logo patch reads 'LEVI'S 501'."
  - "White cotton oversized tee, Trigun Stampede Vash Stampede graphic across chest in red and yellow text, crew neck, dropped shoulders."

- Examples of BAD descriptions (too vague — these will return generic same-category junk):
  - "Black t-shirt." → describe the print, fit, neckline.
  - "Silver necklace." → chain style? pendant shape? clasp?
  - "Jeans." → wash, cut, rise, distressing, brand patch?

ITEMS TO INCLUDE:
- Items worn, held, displayed, or featured (flatlay, products on a shelf, creator reviewing a product).
- Outfit pieces even if only torso is visible.

CATALOG (id · brand · name · category · caption):
${catalogSummary}

BBOX: For EACH detection, return a tight bounding box around the item only (NOT the whole person). Normalized [0,1], top-left origin: { "x": left, "y": top, "w": width, "h": height }. The pipeline reverse-image-searches the crop, so a tight box matters.

Also return frameIdx — which frame (0-indexed) best shows this item.

Rules:
- Match each detection to the closest catalog entry by visual + semantic similarity. Use null when nothing matches reasonably (still keep the detection!).
- Confidence 0–1: how sure of the DETECTION.
- Cap at 6 detections (most prominent items).
- If frames are clearly NOT fashion (e.g. landscape, food, gameplay), return empty.

Return JSON ONLY:
{
  "detections": [
    {
      "category": "outfit",
      "description": "White cotton oversized tee, Trigun anime character graphic across chest in red and yellow text, crew neck, dropped shoulders.",
      "catalogId": "outfit-1",
      "confidence": 0.85,
      "bbox": {"x": 0.10, "y": 0.42, "w": 0.80, "h": 0.45},
      "frameIdx": 0
    }
  ]
}`;

  const userContent: { type: string; text?: string; image_url?: { url: string; detail: string } }[] = [
    { type: "text", text: `Identify every wearable item across these ${imageUrls.length} frame(s) and match each to the catalog.` },
  ];
  // Bumped from "low" → "high" so GPT can actually read brand labels,
  // graphic prints, hardware details, and stitching. The cost difference
  // is small for 1-3 frames and the description quality jump is huge.
  for (const url of imageUrls.slice(0, 5)) {
    userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      // Bumped from 600 — richer per-detection descriptions plus 6 detections
      // can blow past 600 tokens, leading to JSON truncation and parse fails.
      max_tokens: 1200,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.warn("[scan-look] detect non-200:", res.status, text.slice(0, 300));
    return [];
  }
  const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  const reply = (json.choices?.[0]?.message?.content ?? "").trim();
  console.log("[scan-look] detect:", reply.slice(0, 400));
  try {
    const parsed = JSON.parse(reply) as { detections?: ScanDetection[] };
    if (!Array.isArray(parsed.detections)) return [];
    const catalogIds = new Set(catalog.map((c) => c.id));
    return parsed.detections
      .filter((d) => d && typeof d.category === "string")
      .slice(0, 6)
      .map((d: ScanDetection) => {
        const rawBox = (d as unknown as { bbox?: BBox }).bbox;
        const validBox =
          rawBox &&
          [rawBox.x, rawBox.y, rawBox.w, rawBox.h].every(
            (n) => typeof n === "number" && n >= 0 && n <= 1.5,
          )
            ? {
                x: Math.max(0, Math.min(1, rawBox.x)),
                y: Math.max(0, Math.min(1, rawBox.y)),
                w: Math.max(0, Math.min(1, rawBox.w)),
                h: Math.max(0, Math.min(1, rawBox.h)),
              }
            : null;
        const frameIdx = typeof (d as unknown as { frameIdx?: number }).frameIdx === "number"
          ? (d as unknown as { frameIdx: number }).frameIdx
          : 0;
        return {
          category: d.category,
          description: typeof d.description === "string" ? d.description : "",
          catalogId: d.catalogId && catalogIds.has(d.catalogId) ? d.catalogId : null,
          confidence: typeof d.confidence === "number" ? d.confidence : 0,
          bbox: validBox,
          frameIdx: Math.max(0, Math.min(imageUrls.length - 1, frameIdx)),
        };
      });
  } catch (err) {
    console.warn("[scan-look] parse failed:", err);
    return [];
  }
}

// Looks up a real product on the open web for a given detection. Uses
// OpenAI's web_search tool so we get current shopping results, not training-
// data-frozen knowledge. Returns null when nothing reasonable is found.
async function findRealProduct(
  detection: { category: string; description: string },
  key: string,
): Promise<RealProduct | null> {
  const query = `${detection.category} ${detection.description}`;
  const system = `You are a shopping assistant. Search the web for ONE real product matching the user's description and return it as JSON.

CRITICAL RULES:
1. imageUrl MUST be a DIRECT image asset URL — it MUST end with .jpg, .jpeg, .png, or .webp. URLs ending in .html, .com/, or product page paths are forbidden. If no direct image URL is available, set imageUrl to "".
2. buyLink MUST be the product page URL (any HTML page is fine).
3. price include the currency symbol.

Return ONLY a single JSON object, no markdown, no commentary:
{
  "brand": "<actual brand>",
  "name": "<product name>",
  "price": "<e.g. $480>",
  "imageUrl": "<direct image URL ending in .jpg|.jpeg|.png|.webp>",
  "buyLink": "<product page URL>"
}

If nothing reasonable found, return all empty strings:
{"brand": "", "name": "", "price": "", "imageUrl": "", "buyLink": ""}`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      max_output_tokens: 400,
      input: [
        { role: "system", content: system },
        { role: "user", content: `Find a real product for: ${query}` },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.warn("[lookup] non-200:", res.status, text.slice(0, 300));
    return null;
  }

  // Responses API output format: extract the assistant's text response.
  let raw = "";
  try {
    const json = JSON.parse(text);
    // Try common output paths in the Responses API
    raw = json.output_text ?? "";
    if (!raw && Array.isArray(json.output)) {
      for (const item of json.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && typeof c.text === "string") raw += c.text;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[lookup] parse outer failed:", err);
    return null;
  }

  console.log("[lookup]", query.slice(0, 60), "→", raw.slice(0, 200));

  // Extract JSON from the response text — model may wrap it in prose.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as RealProduct;
    if (!parsed.brand || !parsed.name) return null;
    // Reject imageUrls that aren't actual image assets.
    const img = parsed.imageUrl ?? "";
    const validImg = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(img) ? img : "";
    return {
      brand: parsed.brand,
      name: parsed.name,
      price: parsed.price ?? "",
      imageUrl: validImg,
      buyLink: parsed.buyLink ?? "",
    };
  } catch {
    return null;
  }
}

// SerpAPI Google Lens — true reverse visual search. One call per frame
// returns the actual products visible in the image (not text-best-guess).
// Each detection is then paired to the closest match by category keyword.

interface LensMatch {
  title: string;
  source: string;
  link: string;
  image: string;
  price: string;
}

// SerpAPI Google Shopping — text-based product search. Used as a fallback
// when reverse-image search returns nothing useful. Returns real products
// with prices from Google Shopping's index, normalized to LensMatch shape.
async function googleShopping(query: string, key: string): Promise<LensMatch[]> {
  if (!query) return [];
  const url =
    `https://serpapi.com/search.json?engine=google_shopping` +
    `&q=${encodeURIComponent(query.slice(0, 200))}&num=10&api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn("[shopping]", res.status);
      return [];
    }
    const json = (await res.json()) as { shopping_results?: unknown[] };
    const results = Array.isArray(json.shopping_results) ? json.shopping_results : [];
    console.log("[shopping] got", results.length, "for", query.slice(0, 60));
    return results.slice(0, 20).map((m) => {
      const o = m as Record<string, unknown>;
      const link =
        typeof o.product_link === "string"
          ? o.product_link
          : typeof o.link === "string"
            ? o.link
            : "";
      const priceObj = o.price as { extracted_value?: number } | string | undefined;
      return {
        title: typeof o.title === "string" ? o.title : "",
        source: typeof o.source === "string" ? o.source : "",
        link,
        image: typeof o.thumbnail === "string" ? o.thumbnail : "",
        price:
          typeof priceObj === "string"
            ? priceObj
            : typeof o.extracted_price === "number"
              ? `$${o.extracted_price}`
              : "",
      };
    });
  } catch (err) {
    console.warn("[shopping] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// Yandex reverse image search via SerpAPI. Yandex's index catches
// visually-near-identical images on the open web that Google Lens misses
// (well-known among OSINT / fashion sleuths). Run this in parallel with
// Lens, then merge results before re-ranking.
async function yandexReverseImage(imageUrl: string, key: string): Promise<LensMatch[]> {
  const url =
    `https://serpapi.com/search.json?engine=yandex_images&url=${encodeURIComponent(imageUrl)}` +
    `&api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn("[yandex]", res.status);
      return [];
    }
    const json = (await res.json()) as {
      image_results?: unknown[];
      inline_images?: unknown[];
    };
    const raw = Array.isArray(json.image_results)
      ? json.image_results
      : Array.isArray(json.inline_images)
        ? json.inline_images
        : [];
    console.log("[yandex] got", raw.length, "for", imageUrl.slice(-60));
    return raw.slice(0, 25).map((m) => {
      const o = m as Record<string, unknown>;
      const thumb = o.thumbnail as { link?: string } | string | undefined;
      const thumbLink =
        typeof thumb === "string" ? thumb : typeof thumb === "object" ? thumb?.link : undefined;
      return {
        title: typeof o.title === "string" ? o.title : "",
        source: typeof o.source === "string" ? o.source : "",
        link: typeof o.link === "string" ? o.link : "",
        image:
          typeof o.original_image === "string"
            ? o.original_image
            : typeof o.original === "string"
              ? o.original
              : typeof thumbLink === "string"
                ? thumbLink
                : "",
        price: "",
      };
    });
  } catch (err) {
    console.warn("[yandex] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// GPT-4o-mini exact-match reranker. Sends the ORIGINAL detection crop +
// each candidate's thumbnail in a single multi-image call, asks for an
// exact-match score per candidate. Returns the candidates re-sorted with
// near-misses dropped. This is what closes the "similar style" gap —
// Lens / Yandex give us the bag of candidates, GPT-4o picks the actual
// same product.
async function rerankByExactness(
  originalImageUrl: string,
  candidates: LensMatch[],
  openaiKey: string,
): Promise<LensMatch[]> {
  if (candidates.length <= 1) return candidates;
  // Cap at 8 candidates — keeps the multi-image call fast and cheap, and
  // beyond ~8 the long tail is rarely the right answer anyway.
  const top = candidates.filter((c) => c.image).slice(0, 8);
  if (top.length === 0) return candidates;

  const system = `You're scoring product matches for a fashion try-on app.

The FIRST image is the target — pay attention ONLY to the FASHION ITEM (clothing / shoes / jewelry / accessory) being worn or shown. Ignore the person, their face, the room, the lighting, the camera angle, and any background. We are not matching people or scenes — only the product.

The next ${top.length} images are candidates from visual search.

For EACH candidate, score how likely the FASHION ITEM in the candidate is the EXACT SAME product as the target item:
- 1.0 = same product (same brand, same model, same colorway, same pattern/print). Could be a stock photo on the retailer site.
- 0.7 = same product, different colorway or minor variant.
- 0.55 = same character/pattern/motif used on the same garment type (e.g. both are graphic tees with the same anime character).
- 0.3 = similar style and category but a different product (different print, different cut, different brand).
- 0.0 = wrong category, no clear product visible, or just a person/scene with no clear matching item.

CRITICAL: a candidate that just shows the same person, same room, same setting but a DIFFERENT or unclear garment scores 0.0 — you are not matching environments, you are matching products.

Be strict. When unsure, score lower.

Return EXACTLY this JSON, nothing else:
{"scores":[<score0>,<score1>,...,<score${top.length - 1}>]}`;

  const userContent: { type: string; text?: string; image_url?: { url: string; detail: string } }[] = [
    {
      type: "text",
      text: `Score each candidate against the target. Return scores in candidate order (0..${top.length - 1}).`,
    },
    { type: "image_url", image_url: { url: originalImageUrl, detail: "low" } },
  ];
  for (const c of top) {
    userContent.push({ type: "image_url", image_url: { url: c.image, detail: "low" } });
  }

  let scores: number[] = [];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 200,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn("[rerank] non-200:", res.status, text.slice(0, 200));
      return candidates;
    }
    const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const reply = (json.choices?.[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(reply) as { scores?: unknown };
    if (Array.isArray(parsed.scores)) {
      scores = parsed.scores.map((s) => (typeof s === "number" ? s : 0));
    }
  } catch (err) {
    console.warn("[rerank] failed:", err instanceof Error ? err.message : err);
    return candidates;
  }

  if (scores.length !== top.length) {
    console.warn("[rerank] score count mismatch:", scores.length, "vs", top.length);
    return candidates;
  }

  console.log("[rerank] scores:", scores.map((s) => s.toFixed(2)).join(", "));

  // Best score must clear 0.55 for visual search to count as successful.
  // The model occasionally scores unrelated thumbnails at 0.4 (it's hedging
  // on partial color/composition similarity), so anything below 0.55 means
  // "no real match in the visual pool" and we let the chain fall through
  // to text-based Shopping/eBay (which actually searches the description).
  const ranked = top
    .map((c, i) => ({ c, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  if (best < 0.55) {
    console.log("[rerank] best", best.toFixed(2), "< 0.55, signaling fall-through");
    return [];
  }
  // Keep matches within 0.15 of the best — surfaces close-tie alternatives
  // (different colorways of the same product, sister listings) without
  // letting weaker hits dilute the result.
  return ranked
    .filter(({ score }) => score >= best - 0.15)
    .map(({ c }) => c);
}

// SerpAPI eBay — surfaces long-tail listings Google misses (vintage,
// reseller, regional). Often hits when Google Shopping returns nothing,
// because eBay's index includes individual seller listings, not just
// retailer feeds. Free tier covers this through the same SERPAPI key.
async function serpapiEbay(query: string, key: string): Promise<LensMatch[]> {
  if (!query) return [];
  const url =
    `https://serpapi.com/search.json?engine=ebay` +
    `&_nkw=${encodeURIComponent(query.slice(0, 200))}` +
    `&ebay_domain=ebay.com&api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn("[ebay]", res.status);
      return [];
    }
    const json = (await res.json()) as { organic_results?: unknown[] };
    const results = Array.isArray(json.organic_results) ? json.organic_results : [];
    console.log("[ebay] got", results.length, "for", query.slice(0, 60));
    return results.slice(0, 20).map((m) => {
      const o = m as Record<string, unknown>;
      const priceObj = o.price as { raw?: string; extracted?: number } | string | undefined;
      const price =
        typeof priceObj === "string"
          ? priceObj
          : typeof priceObj === "object" && priceObj
            ? priceObj.raw ??
              (typeof priceObj.extracted === "number" ? `$${priceObj.extracted}` : "")
            : "";
      return {
        title: typeof o.title === "string" ? o.title : "",
        source: "eBay",
        link: typeof o.link === "string" ? o.link : "",
        image: typeof o.thumbnail === "string" ? o.thumbnail : "",
        price,
      };
    });
  } catch (err) {
    console.warn("[ebay] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// SerpAPI Google Images — broadest fallback. No prices, but pulls real
// product imagery from anywhere on the open web. Used last in the chain.
async function googleImages(query: string, key: string): Promise<LensMatch[]> {
  if (!query) return [];
  const url =
    `https://serpapi.com/search.json?engine=google_images` +
    `&q=${encodeURIComponent(query.slice(0, 200))}&num=20&api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn("[images]", res.status);
      return [];
    }
    const json = (await res.json()) as { images_results?: unknown[] };
    const results = Array.isArray(json.images_results) ? json.images_results : [];
    console.log("[images] got", results.length, "for", query.slice(0, 60));
    return results.slice(0, 20).map((m) => {
      const o = m as Record<string, unknown>;
      return {
        title: typeof o.title === "string" ? o.title : "",
        source: typeof o.source === "string" ? o.source : "",
        link: typeof o.link === "string" ? o.link : "",
        image:
          typeof o.original === "string"
            ? o.original
            : typeof o.thumbnail === "string"
              ? o.thumbnail
              : "",
        price: "",
      };
    });
  } catch (err) {
    console.warn("[images] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// Domains that host the IMAGE but aren't actually product pages we can sell
// from. Yandex and Lens both surface these heavily because the same image
// often appears across socials/forums/news. Strip them before reranking so
// the chain falls through to text-based product search instead of returning
// an unbuyable creator's TikTok page as the "match".
const SOCIAL_DOMAINS = [
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "pinterest.",
  "reddit.com",
  "tumblr.com",
  "wikipedia.org",
  "wikimedia.org",
  "istockphoto.com",
  "shutterstock.com",
  "gettyimages.com",
  "alamy.com",
  "dreamstime.com",
  "linkedin.com",
  // Forum / model-ID / image-search aggregators that wrap retailer links
  // inside discussions instead of being the product page itself.
  "quora.com",
  "inkppl.com",
  "modelmayhem.com",
  "whatsthatname.com",
  "tineye.com",
  "imgur.com",
  "flickr.com",
  "deviantart.com",
];

function isSocialOrStockDomain(source: string, link: string): boolean {
  const haystack = `${source} ${link}`.toLowerCase();
  return SOCIAL_DOMAINS.some((d) => haystack.includes(d));
}

// Domains / TLDs that surface in reverse-image search but consistently
// lead to dead pages, dropshipping fronts, or scam clones. Yandex in
// particular indexes a lot of Russian / CN sphere pages that have a
// keyword-stuffed URL but no real product behind it. Strip these before
// the reranker so only legitimate retail links survive.
const SHADY_TLD_PATTERNS = [
  // Russian / CN sphere — high false-positive rate for fashion shopping
  ".ru/",
  ".su/",
  ".by/",
  ".ua/",
  ".kz/",
  // Generic cheap TLDs heavily used by dropshipping clones
  ".icu/",
  ".top/",
  ".xyz/",
  ".ml/",
  ".tk/",
  ".ga/",
  ".cf/",
  ".pw/",
  ".cyou/",
  ".buzz/",
  ".click/",
  ".rest/",
  ".monster/",
];

const SHADY_DOMAINS = [
  // Specific bad actors users have flagged
  "daloka.ru",
  "fgipe.ch",
  "restore.fgipe.ch",
  // Add more here as they come up
];

// URL-level patterns that mark scrape / SEO-clone pages even when the
// host itself looks innocent. Yandex's smart camera in particular forwards
// to a lot of cached / parked pages that simply 200 with the wrong content.
const SHADY_URL_PATTERNS = [
  "yandexsmartcamera",
];

function hasShadyUrlPattern(link: string): boolean {
  const lower = link.toLowerCase();
  return SHADY_URL_PATTERNS.some((p) => lower.includes(p));
}

function isShadyDomain(source: string, link: string): boolean {
  const haystack = `${source.toLowerCase()} ${link.toLowerCase()}`;
  // Check explicit blocklist first (cheap exact match).
  if (SHADY_DOMAINS.some((d) => haystack.includes(d))) return true;
  // Then sniff TLDs. We require a trailing slash so ".ru/" won't match
  // legitimate words like "kohl.ruhr" — only catches actual ".ru/" hosts.
  return SHADY_TLD_PATTERNS.some((p) => haystack.includes(p));
}

// Real retailer domains — matches here get a heavy ranking boost so they
// beat wiki/blog/aggregator pages even when those have category keywords.
// Lens and Yandex both happily return non-shopping pages first; this
// boost pushes the actual buyable product to the top of the result list.
const RETAILER_DOMAINS = [
  // Fast fashion / direct-to-consumer
  "shein.com",
  "asos.com",
  "zara.com",
  "hm.com",
  "uniqlo.com",
  "fashionnova.com",
  "prettylittlething.com",
  "boohoo.com",
  "missguided.com",
  "lulus.com",
  "princess polly",
  "revolve.com",
  "shopbop.com",
  // Big-box / department stores
  "amazon.com",
  "amazon.co",
  "ebay.com",
  "walmart.com",
  "target.com",
  "nordstrom.com",
  "macys.com",
  "kohls.com",
  "dickssportinggoods.com",
  "footlocker.com",
  // Boutique / luxury / curated
  "ssense.com",
  "farfetch.com",
  "net-a-porter.com",
  "matchesfashion.com",
  "mytheresa.com",
  "endclothing.com",
  // Marketplaces
  "etsy.com",
  "depop.com",
  "vinted.com",
  "grailed.com",
  "redbubble.com",
  // Beauty / specialty
  "sephora.com",
  "ulta.com",
  "nyxcosmetics.com",
  // Branded retailers people actually wear
  "lululemon.com",
  "nike.com",
  "adidas.com",
  "newbalance.com",
  "vans.com",
  "stussy.com",
  "supremenewyork.com",
  "shop.app",
  // Resale & sneaker marketplaces
  "stockx.com",
  "goat.com",
  "flightclub.com",
  "stadium goods",
  // Big online sportswear stores
  "jdsports.com",
  "jdsports.co",
  "footaction.com",
  "champssports.com",
  "finishline.com",
  // International department stores (English-speaking)
  "selfridges.com",
  "harrods.com",
  "johnlewis.com",
  "myer.com.au",
  // Streetwear / Y2K
  "urbanoutfitters.com",
  "freepeople.com",
  "anthropologie.com",
  // Kids / surf / extras
  "asos.de",
  "asos.fr",
  "boohooman.com",
  "cupshe.com",
  "miumiu.com",
  "gap.com",
  "oldnavy.com",
  "bananarepublic.com",
  "abercrombie.com",
  "hollisterco.com",
  "gymshark.com",
  "outdoorvoices.com",
  "alo.yoga",
];

function isRetailerDomain(source: string, link: string): boolean {
  const haystack = `${source} ${link}`.toLowerCase();
  return RETAILER_DOMAINS.some((d) => haystack.includes(d));
}

// Dedupes a list of LensMatch by image URL (primary key) then by title.
// Different engines often return the same product through different pages.
// Also strips social/stock domains AND shady TLDs (Russian dropshippers,
// generic .xyz/.icu cheap TLDs) that consistently return dead links.
function dedupeMatches(matches: LensMatch[]): LensMatch[] {
  const seen = new Set<string>();
  const out: LensMatch[] = [];
  for (const m of matches) {
    if (isSocialOrStockDomain(m.source, m.link)) continue;
    if (isShadyDomain(m.source, m.link)) continue;
    if (hasShadyUrlPattern(m.link)) continue;
    const key = m.image || m.title.toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// Hard retailer-only filter for VISUAL search results (Lens, Yandex).
// Yandex in particular surfaces a lot of SEO scrape clones that pass HEAD
// checks but contain unrelated content. After this filter, the only results
// that reach the user are from a domain we've vetted as a real shop.
//
// Empty result → caller falls through to text-based Shopping/eBay/Images,
// which already index real retailers by design.
function filterToRetailersOnly(matches: LensMatch[]): LensMatch[] {
  return matches.filter((m) => isRetailerDomain(m.source, m.link));
}

// HEAD-checks a URL with a tight timeout. Returns true if the URL responds
// with a 2xx/3xx (i.e. it's actually reachable). Used to vet the top match
// before returning it — no point handing the user a dead link. Capped to
// ~3s so we don't blow the request budget.
async function isLinkReachable(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
      signal: AbortSignal.timeout(3000),
    });
    // 2xx / 3xx is fine. 4xx (404 in particular) → dead.
    return res.status < 400;
  } catch {
    // Some sites reject HEAD entirely with 405 / 403 — fall back to GET
    // with stream-then-abort to avoid downloading the whole page.
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-512" },
        signal: AbortSignal.timeout(3000),
      });
      return res.status < 400;
    } catch {
      return false;
    }
  }
}

// HEAD-checks the top N matches in order, dropping any that are dead.
// First reachable match becomes [0] in the returned list (followed by the
// remaining unchecked matches so the UI still has fallbacks). Returns []
// if none of the top N are reachable — caller should fall through to
// text-based fallbacks instead of showing a dead link.
async function pickReachable(matches: LensMatch[], topN: number): Promise<LensMatch[]> {
  if (matches.length === 0) return [];
  const headSet = matches.slice(0, topN);
  const checks = await Promise.all(
    headSet.map(async (m) => ({ m, ok: m.link ? await isLinkReachable(m.link) : false })),
  );
  const firstOk = checks.findIndex((c) => c.ok);
  if (firstOk === -1) {
    console.warn(
      "[reachable] top",
      topN,
      "matches all dead — falling through to text search",
    );
    return [];
  }
  // Promote the first reachable match to position 0; keep the rest of the
  // ranked list behind it (some may also be dead, but the UI mostly only
  // shows the top result so this is fine).
  const reordered = [
    checks[firstOk].m,
    ...checks.slice(0, firstOk).filter((c) => c.ok).map((c) => c.m),
    ...checks.slice(firstOk + 1).map((c) => c.m),
    ...matches.slice(topN),
  ];
  return reordered;
}

// Chained product lookup with multi-engine visual search + LLM re-ranking:
//   Stage 1 (visual, in parallel): Google Lens + Yandex reverse image.
//   Stage 2: dedupe and merge candidates, then rerank with GPT-4o-mini
//            (asks the model which candidates are exactly the same product).
//   Stage 3 (text fallback if Stage 2 empty): Shopping → eBay → Images.
//
// The reranker is the brain — Lens and Yandex give us the bag, GPT-4o-mini
// picks the actual same product (or drops everything if nothing's close).
async function findProductChain(
  imageUrl: string,
  category: string | undefined,
  hint: string | undefined,
  serpKey: string,
  openaiKey: string | undefined,
): Promise<{
  matches: LensMatch[];
  via: "lens+yandex" | "lens" | "yandex" | "shopping" | "ebay" | "images" | "none";
}> {
  // Stage 1 — fan-out to both visual search engines.
  const [lens, yandex] = await Promise.all([
    lensSearch(imageUrl, serpKey, hint),
    yandexReverseImage(imageUrl, serpKey),
  ]);
  const visualRaw = dedupeMatches([...lens, ...yandex]);
  // Hard retailer filter — anything not on the known-shop allowlist gets
  // dropped. This kills the dead-link / scrape-clone problem that even
  // HEAD checks miss (a scrape farm 200's just fine but serves wrong
  // content). If filtering leaves nothing, we fall through to text search
  // which is far more reliable for actual buy links.
  const visual = filterToRetailersOnly(visualRaw);
  if (visual.length > 0) {
    const ranked = category ? rankByCategory(visual, category) : visual;
    // Stage 2 — exact-match reranker. Only run when OPENAI_API_KEY is set
    // AND we have multiple candidates (single-candidate rerank is wasted call).
    // Returns [] when nothing scored above the exact-match threshold, in
    // which case we fall through to text search instead of showing noise.
    const reranked =
      openaiKey && ranked.length > 1
        ? await rerankByExactness(imageUrl, ranked, openaiKey)
        : ranked;
    // Stage 2.5 — vet the top match's link. If it's dead (404, timeout,
    // dropshipper that took the page down), drop and try the next. We only
    // check the top 3 to keep latency in budget; if none work, fall through
    // to text search.
    const final = await pickReachable(reranked, 3);
    if (final.length > 0) {
      const via: "lens+yandex" | "lens" | "yandex" =
        lens.length > 0 && yandex.length > 0
          ? "lens+yandex"
          : lens.length > 0
            ? "lens"
            : "yandex";
      return { matches: final, via };
    }
    // else: reranker rejected everything OR every top match was dead.
  }

  // Stage 3 — text-based fallbacks when visual search returned nothing.
  const textQuery = [category, hint].filter(Boolean).join(" ").trim();
  if (textQuery) {
    const shopping = await googleShopping(textQuery, serpKey);
    if (shopping.length > 0) {
      const ranked = category ? rankByCategory(shopping, category) : shopping;
      return { matches: ranked, via: "shopping" };
    }
    const ebay = await serpapiEbay(textQuery, serpKey);
    if (ebay.length > 0) {
      const ranked = category ? rankByCategory(ebay, category) : ebay;
      return { matches: ranked, via: "ebay" };
    }
    const images = await googleImages(textQuery, serpKey);
    if (images.length > 0) {
      const ranked = category ? rankByCategory(images, category) : images;
      return { matches: ranked, via: "images" };
    }
  }
  return { matches: [], via: "none" };
}

async function lensSearch(
  imageUrl: string,
  key: string,
  hint?: string,
): Promise<LensMatch[]> {
  // SerpAPI Google Lens accepts a `q` text hint that biases ranking toward
  // matches containing those words. Passing GPT's rich description (color +
  // pattern + standout traits) here lets us pull in pattern-specific matches
  // (e.g. "trigun anime graphic tee") instead of generic same-category hits.
  const qParam = hint && hint.length > 3 ? `&q=${encodeURIComponent(hint.slice(0, 120))}` : "";
  const url =
    `https://serpapi.com/search.json?engine=google_lens&type=products` +
    `&url=${encodeURIComponent(imageUrl)}${qParam}&api_key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) {
    console.warn("[lens]", res.status, text.slice(0, 200));
    return [];
  }
  let json: { visual_matches?: unknown[] };
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const matches = Array.isArray(json.visual_matches) ? json.visual_matches : [];
  console.log("[lens] got", matches.length, "matches for", imageUrl.slice(-60));
  return matches.slice(0, 30).map((m) => {
    const o = m as Record<string, unknown>;
    return {
      title: typeof o.title === "string" ? o.title : "",
      source: typeof o.source === "string" ? o.source : "",
      link: typeof o.link === "string" ? o.link : "",
      image: typeof o.thumbnail === "string"
        ? o.thumbnail
        : typeof o.image === "string"
          ? o.image
          : "",
      price: typeof o.price === "string"
        ? o.price
        : typeof (o.price as { value?: string })?.value === "string"
          ? ((o.price as { value: string }).value)
          : typeof (o.price as { extracted_value?: number })?.extracted_value === "number"
            ? `$${(o.price as { extracted_value: number }).extracted_value}`
            : "",
    };
  });
}

// Maps category → keywords that should appear in a Lens title for a confident
// pairing. Used to filter the bag of Lens matches against each detection.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  watch: ["watch", "timepiece", "chronograph", "automatic"],
  bracelet: ["bracelet", "bangle", "cuff", "tennis"],
  ring: ["ring", "band", "solitaire", "signet"],
  necklace: ["necklace", "chain", "pendant", "choker", "strand"],
  earring: ["earring", "stud", "hoop", "drop"],
  outfit: ["shirt", "tee", "t-shirt", "dress", "pants", "jeans", "jacket", "coat", "sweater", "hoodie", "blouse", "skirt", "outfit"],
  hair: ["hair", "wig", "extension"],
  sunglasses: ["sunglasses", "shades"],
  glasses: ["glasses", "eyeglasses", "frames", "spectacle"],
  hat: ["hat", "cap", "beanie", "fedora"],
  bag: ["bag", "purse", "handbag", "tote", "clutch", "backpack"],
  scarf: ["scarf", "shawl"],
  shoes: ["shoes", "sneakers", "boots", "heels", "loafers"],
  belt: ["belt"],
  makeup: ["lipstick", "eyeshadow", "blush", "foundation", "mascara", "lip gloss"],
};

function rankByCategory(matches: LensMatch[], category: string): LensMatch[] {
  const cat = category.toLowerCase();
  const keywords = CATEGORY_KEYWORDS[cat] ?? [cat];
  const scored = matches.map((m, idx) => {
    const title = m.title.toLowerCase();
    const catHit = keywords.some((k) => title.includes(k));
    const retailHit = isRetailerDomain(m.source, m.link);
    const imageBoost = m.image ? 1 : -2;
    // Retailer (+8) beats category-only (+5) so a SHEIN page with no
    // exact keyword match still outranks a forum that happens to mention
    // the category. Image presence gets a small tiebreaker boost; original
    // engine order acts as the final tiebreaker.
    return {
      match: m,
      score:
        (retailHit ? 8 : 0) +
        (catHit ? 5 : 0) +
        imageBoost -
        idx * 0.05,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.match);
}

async function scanLook(
  req: ScanLookRequest,
  key: string,
  _serpKey: string | undefined,
): Promise<ScanLookResponse> {
  // /scan-look now ONLY does GPT detection. Lens search moved client-side
  // because the client crops each detection's bbox first — Lens needs a
  // tight crop of the item (not the whole frame) for precise matching.
  const detections = await detectItems(req.imageUrls, req.catalog, key);
  return {
    detections: detections.map((d) => ({ ...d, real: null })),
  };
}

// ---- og:image scrape: upgrades SerpAPI Lens thumbnails to source-page hero ----
//
// SerpAPI Google Lens returns small thumbnails (~150-300px). YouCam renders
// best with high-res product shots (>= 600px). We hit the match.link, parse
// out og:image (or twitter:image), and prefer that over the Lens thumbnail.
// Falls back silently when scraping fails — the original thumbnail is fine
// for display, just less ideal as a YouCam reference.

async function scrapeOgImage(targetUrl: string): Promise<string | null> {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000); // cap to first 200KB

    const patterns = [
      /<meta\s+(?:property|name)=["']og:image(?::secure_url|:url)?["']\s+content=["']([^"']+)["']/i,
      /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
      /<meta\s+(?:property|name)=["']twitter:image(?::src)?["']\s+content=["']([^"']+)["']/i,
      /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']twitter:image(?::src)?["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        let img = m[1].trim();
        if (img.startsWith("//")) img = "https:" + img;
        else if (img.startsWith("/")) img = new URL(targetUrl).origin + img;
        // Validate that it looks like an image URL.
        if (/^https?:\/\//i.test(img)) return img;
      }
    }
    return null;
  } catch (err) {
    console.warn("[og-image] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- Replicate grounding-dino: pixel-perfect open-vocab object detection ----
//
// One call per frame, with a comma-separated query of categories we expect
// on that frame. Returns raw pixel-coordinate bboxes (xyxy) per label. The
// client normalizes via ImageManipulator probe of the local frame.

const GROUNDING_DINO_VERSION =
  "efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa";

interface GroundingDinoDetection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in pixels
}

async function detectWithGroundingDino(
  imageUrl: string,
  query: string,
  token: string,
): Promise<GroundingDinoDetection[]> {
  const start = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: GROUNDING_DINO_VERSION,
      input: {
        image: imageUrl,
        query,
        box_threshold: 0.25,
        text_threshold: 0.2,
        show_visualisation: false,
      },
    }),
  });
  const startText = await start.text();
  if (!start.ok) {
    console.warn("[detect] start failed:", start.status, startText.slice(0, 300));
    return [];
  }
  const startJson = JSON.parse(startText) as {
    id?: string;
    urls?: { get?: string };
    status?: string;
    output?: unknown;
  };
  // Most predictions complete in <1s and the start response already includes
  // output. If not, poll the get URL.
  let output = startJson.output;
  let status = startJson.status;
  const getUrl = startJson.urls?.get;
  const deadline = Date.now() + 30_000;
  while ((status === "starting" || status === "processing") && getUrl && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!poll.ok) break;
    const pollJson = (await poll.json()) as { status?: string; output?: unknown };
    status = pollJson.status;
    output = pollJson.output;
    if (status === "succeeded" || status === "failed" || status === "canceled") break;
  }
  if (status !== "succeeded") {
    console.warn("[detect] non-success status:", status);
    return [];
  }
  const out = output as { detections?: GroundingDinoDetection[] } | undefined;
  if (!out?.detections || !Array.isArray(out.detections)) return [];
  return out.detections.filter(
    (d) =>
      typeof d.label === "string" &&
      typeof d.confidence === "number" &&
      Array.isArray(d.bbox) &&
      d.bbox.length === 4 &&
      d.bbox.every((n) => typeof n === "number" && Number.isFinite(n)),
  );
}

// ---- Replicate rembg: strip background from product image before YouCam ----
//
// Lens / Yandex / Shopping thumbnails come with busy backgrounds (model's
// hand, retailer studio shadows, color swatches, watermarks). YouCam's
// own bg removal is mid-quality — it leaves halos and bakes the surrounding
// pixels into the composite. Running cjwbw/rembg first (U2Net-based) gives
// us a clean transparent PNG and noticeably tightens the final render.
//
// Falls back silently when rembg fails: YouCam's own bg removal stays on
// (need_remove_background: true) as a safety net.
async function removeProductBackground(
  imageUrl: string,
  token: string,
): Promise<string | null> {
  try {
    const start = await fetch(
      "https://api.replicate.com/v1/models/cjwbw/rembg/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Replicate `Prefer: wait` blocks for up to 60s; we get the result
          // inline if the model is fast enough, otherwise we poll.
          Prefer: "wait=20",
        },
        body: JSON.stringify({ input: { image: imageUrl } }),
      },
    );
    const startText = await start.text();
    if (!start.ok) {
      console.warn("[rembg] start failed:", start.status, startText.slice(0, 200));
      return null;
    }
    const startJson = JSON.parse(startText) as {
      id?: string;
      urls?: { get?: string };
      status?: string;
      output?: unknown;
    };
    let output = startJson.output;
    let status = startJson.status;
    const getUrl = startJson.urls?.get;
    const deadline = Date.now() + 30_000;
    while ((status === "starting" || status === "processing") && getUrl && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!poll.ok) break;
      const pollJson = (await poll.json()) as { status?: string; output?: unknown };
      status = pollJson.status;
      output = pollJson.output;
      if (status === "succeeded" || status === "failed" || status === "canceled") break;
    }
    if (status !== "succeeded") {
      console.warn("[rembg] non-success status:", status);
      return null;
    }
    return typeof output === "string" ? output : null;
  } catch (err) {
    console.warn("[rembg] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- Diagnosis: GPT picks the next mutation strategy from a failed photo ----
//
// The mutate-and-retry loop on the client first tries a static plan from the
// error code. If those fail too, we ask GPT to look at the actual photo and
// the YouCam error message and recommend a strategy from a fixed enum.

const STRATEGY_NAMES = [
  "zoomGentle",
  "zoomMedium",
  "zoomAggressive",
  "padOut",
  "padBig",
  "flipH",
] as const;

interface DiagnoseRequest {
  category: Category;
  srcImageUrl: string;
  errorMessage: string;
  triedStrategies: string[];
}

interface DiagnoseResult {
  strategy: string | null;
  reason: string;
}

async function diagnose(
  req: DiagnoseRequest,
  key: string,
): Promise<DiagnoseResult> {
  const remaining = STRATEGY_NAMES.filter((s) => !req.triedStrategies.includes(s));
  if (remaining.length === 0) return { strategy: null, reason: "all strategies exhausted" };

  const system = `You are diagnosing a failed virtual try-on. The user submitted a photo for a ${req.category} try-on and the renderer returned: "${req.errorMessage}".

Already-tried strategies (skip these): ${req.triedStrategies.join(", ") || "none"}
Available strategies (pick exactly one):
- zoomGentle: 90% center crop + upscale (body part slightly too small)
- zoomMedium: 75% center crop + upscale (body part moderately too small)
- zoomAggressive: 60% center crop + upscale (body part very small in frame)
- padOut: resize to 80% (body part too close to frame edge)
- padBig: resize to 70% (body part way too close to frame edge)
- flipH: mirror horizontally (sometimes helps detection on lateral shots)

Look at the photo and the error. Pick ONE strategy from the available list that's most likely to fix the issue.

Reply with EXACTLY:
STRATEGY: <strategy name>
REASON: <one short sentence>`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 80,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: "What strategy should we try next?" },
            { type: "image_url", image_url: { url: req.srcImageUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn("[diagnose] non-200:", res.status, text.slice(0, 200));
    return { strategy: remaining[0] ?? null, reason: "diagnosis failed, falling back" };
  }
  const json = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = (json.choices?.[0]?.message?.content ?? "").trim();
  console.log("[diagnose]", req.category, "→", reply.slice(0, 200));
  const strategyMatch = reply.match(/STRATEGY\s*:\s*(\w+)/i);
  const reasonMatch = reply.match(/REASON\s*:\s*(.+)$/im);
  const candidate = strategyMatch?.[1] ?? "";
  const valid = (STRATEGY_NAMES as readonly string[]).includes(candidate);
  return {
    strategy: valid && !req.triedStrategies.includes(candidate)
      ? candidate
      : (remaining[0] ?? null),
    reason: reasonMatch?.[1]?.trim() ?? "fallback",
  };
}

// Hosts we'll accept in srcImageUrl / productImageUrl / imageUrl. Default to
// the Supabase storage host (where we control all uploads) plus YouCam's
// plugin asset host (which serves their sample selfies / product images).
// Override at runtime via env.IMAGE_HOST_ALLOWLIST.
const DEFAULT_IMAGE_HOSTS = [
  "yzzkuexsttkycwrmutaj.supabase.co",
  "plugins-media.makeupar.com",
  // tikwm hosts the TikTok mp4 / cover when scanning a video. Limited to
  // these subdomains so an attacker can't supply arbitrary URLs.
  "tikwm.com",
  "www.tikwm.com",
  "api.tikwm.com",
  "api2.tikwm.com",
  // Replicate model output CDN — used after rembg pre-pass on product
  // images. Outputs are immutable for ~1 hour and only contain content we
  // produced via our own predictions, so this is safe to allow.
  "replicate.delivery",
];

function getAllowedHosts(env: Env): string[] {
  if (env.IMAGE_HOST_ALLOWLIST) {
    return env.IMAGE_HOST_ALLOWLIST.split(",").map((h) => h.trim()).filter(Boolean);
  }
  return DEFAULT_IMAGE_HOSTS;
}

function urlHostAllowed(value: unknown, allowed: string[]): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return allowed.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Validates that every URL field in the request body lives on an allowed
// host. Returns null if valid, otherwise an error message string.
function validateImageUrls(
  body: Record<string, unknown>,
  fields: string[],
  allowed: string[],
): string | null {
  for (const f of fields) {
    const v = body[f];
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (!urlHostAllowed(item, allowed)) {
          return `${f}[] contains a URL on a non-allowlisted host`;
        }
      }
    } else if (!urlHostAllowed(v, allowed)) {
      return `${f} is on a non-allowlisted host`;
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }
    if (!env.PERFECTCORP_API_KEY) {
      return jsonResponse({ error: "PERFECTCORP_API_KEY not set on worker" }, 500);
    }

    // Bearer-token gate. When ONME_API_TOKEN is set, every request must
    // carry a matching X-Onme-Token header. Stops cost runaway from anyone
    // discovering the public worker URL. When unset we log a warning so
    // dev-open mode is obvious in `wrangler tail`.
    if (env.ONME_API_TOKEN) {
      const presented = request.headers.get("X-Onme-Token");
      if (presented !== env.ONME_API_TOKEN) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    } else {
      console.warn("[auth] ONME_API_TOKEN not set — worker is open. Set it in production.");
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const allowedHosts = getAllowedHosts(env);

    try {
      if (path === "/tryon" || path === "") {
        const body = (await request.json()) as TryOnReq & { skipPreflight?: boolean };
        if (!body.category || !body.srcImageUrl) {
          return jsonResponse(
            { error: "Missing fields: category, srcImageUrl" },
            400,
          );
        }
        if (body.category === "hair") {
          if (!body.paletteHex) {
            return jsonResponse({ error: "paletteHex required for hair" }, 400);
          }
        } else if (!body.productImageUrl) {
          return jsonResponse({ error: "productImageUrl required" }, 400);
        }
        const urlErr = validateImageUrls(
          body as unknown as Record<string, unknown>,
          ["srcImageUrl", "productImageUrl"],
          allowedHosts,
        );
        if (urlErr) return jsonResponse({ error: urlErr }, 400);

        // Pre-flight vision check. If GPT-4o-mini decides the photo can't
        // possibly work, surface the reason immediately so we don't waste a
        // 4-7s YouCam round trip. Skipped when the corrective pipeline is
        // resubmitting a mutated variant (we already validated once).
        if (env.OPENAI_API_KEY && !body.skipPreflight) {
          const verdict = await preflight(
            body.category,
            body.srcImageUrl,
            env.OPENAI_API_KEY,
          );
          if (!verdict.ok) {
            return jsonResponse(
              { error: verdict.reason ?? "Photo isn't quite usable", code: "preflight" },
              422,
            );
          }
        }

        // Pre-pass: strip background from the product image before YouCam
        // sees it. cjwbw/rembg gives a clean transparent PNG which YouCam
        // composites onto the body MUCH cleaner than a busy thumbnail with
        // halo edges. Skipped for hair (palette-driven, no product image).
        if (
          env.REPLICATE_API_TOKEN &&
          body.category !== "hair" &&
          body.productImageUrl
        ) {
          const cleaned = await removeProductBackground(
            body.productImageUrl,
            env.REPLICATE_API_TOKEN,
          );
          if (cleaned) {
            console.log("[rembg] using cleaned product:", cleaned.slice(-60));
            body.productImageUrl = cleaned;
          }
        }

        const { taskId, basePath } = await startTask(body, env.PERFECTCORP_API_KEY);
        const resultImageUrl = await pollTask(basePath, taskId, env.PERFECTCORP_API_KEY);
        return jsonResponse({ taskId, resultImageUrl });
      }

      if (path === "/lens") {
        const body = (await request.json()) as {
          imageUrl?: string;
          category?: string;
          hint?: string;
        };
        if (!body.imageUrl) return jsonResponse({ error: "imageUrl required" }, 400);
        if (!env.SERPAPI_KEY) return jsonResponse({ error: "SERPAPI_KEY not set" }, 500);
        const urlErr = validateImageUrls(
          body as unknown as Record<string, unknown>,
          ["imageUrl"],
          allowedHosts,
        );
        if (urlErr) return jsonResponse({ error: urlErr }, 400);
        // Multi-engine visual search (Lens + Yandex) → GPT-4o exact-match
        // reranker → text fallbacks (Shopping → eBay → Images) → none.
        const { matches, via } = await findProductChain(
          body.imageUrl,
          body.category,
          body.hint,
          env.SERPAPI_KEY,
          env.OPENAI_API_KEY,
        );
        return jsonResponse({ matches, via });
      }

      if (path === "/extract-tiktok") {
        const body = (await request.json()) as { url?: string };
        if (!body.url || !isTikTokUrl(body.url)) {
          return jsonResponse({ error: "Invalid TikTok URL" }, 400);
        }
        const debug = url.searchParams.get("debug") === "1";
        const result = await extractTikTokDebug(body.url);
        if (!result.info) {
          return jsonResponse(
            debug
              ? { error: "Couldn't extract this TikTok", debug: result.debug }
              : { error: "Couldn't extract this TikTok" },
            502,
          );
        }
        return jsonResponse(result.info);
      }

      if (path === "/scan-look") {
        const body = (await request.json()) as ScanLookRequest;
        if (!env.OPENAI_API_KEY) {
          return jsonResponse({ error: "OPENAI_API_KEY not set" }, 500);
        }
        if (!body.imageUrls?.length) {
          return jsonResponse({ error: "imageUrls required" }, 400);
        }
        if (!body.catalog?.length) {
          return jsonResponse({ error: "catalog required" }, 400);
        }
        const urlErr = validateImageUrls(
          body as unknown as Record<string, unknown>,
          ["imageUrls"],
          allowedHosts,
        );
        if (urlErr) return jsonResponse({ error: urlErr }, 400);
        const result = await scanLook(body, env.OPENAI_API_KEY, env.SERPAPI_KEY);
        return jsonResponse(result);
      }

      if (path === "/og-image") {
        const body = (await request.json()) as { url?: string };
        if (!body.url) return jsonResponse({ error: "url required" }, 400);
        // og:image scrapes arbitrary product pages chosen by SerpAPI's
        // earlier response, so we cannot allowlist by host here. Validate
        // protocol/shape only and rely on scrapeOgImage's timeout + size cap
        // to bound the blast radius.
        try {
          const u = new URL(body.url);
          if (u.protocol !== "https:" && u.protocol !== "http:") {
            return jsonResponse({ error: "Bad URL protocol" }, 400);
          }
        } catch {
          return jsonResponse({ error: "Bad URL" }, 400);
        }
        const image = await scrapeOgImage(body.url);
        return jsonResponse({ image });
      }

      if (path === "/detect") {
        const body = (await request.json()) as { imageUrl?: string; query?: string };
        if (!body.imageUrl || !body.query) {
          return jsonResponse({ error: "imageUrl and query required" }, 400);
        }
        if (!env.REPLICATE_API_TOKEN) {
          return jsonResponse({ error: "REPLICATE_API_TOKEN not set" }, 500);
        }
        const urlErr = validateImageUrls(
          body as unknown as Record<string, unknown>,
          ["imageUrl"],
          allowedHosts,
        );
        if (urlErr) return jsonResponse({ error: urlErr }, 400);
        const detections = await detectWithGroundingDino(
          body.imageUrl,
          body.query,
          env.REPLICATE_API_TOKEN,
        );
        return jsonResponse({ detections });
      }

      if (path === "/diagnose") {
        const body = (await request.json()) as DiagnoseRequest;
        if (!env.OPENAI_API_KEY) {
          return jsonResponse({ strategy: null, reason: "OPENAI_API_KEY not set" });
        }
        const result = await diagnose(body, env.OPENAI_API_KEY);
        return jsonResponse(result);
      }

      return jsonResponse({ error: `Unknown path ${path}` }, 404);
    } catch (err) {
      if (err instanceof TryOnError) {
        return jsonResponse({ error: err.userFacing, code: err.code }, 422);
      }
      const message = err instanceof Error ? err.message : "unknown error";
      return jsonResponse({ error: message }, 500);
    }
  },
};
