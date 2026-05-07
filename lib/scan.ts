import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import { getFeed } from "@/lib/feed";
import { uploadOneShot } from "@/lib/snap";

const PROXY_URL = process.env.EXPO_PUBLIC_TRYON_PROXY_URL;
const ONME_API_TOKEN = process.env.EXPO_PUBLIC_ONME_API_TOKEN;

// Headers sent on every worker call. The token is required server-side
// when the worker has ONME_API_TOKEN set (which production should).
function workerHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (ONME_API_TOKEN) h["X-Onme-Token"] = ONME_API_TOKEN;
  return h;
}

export interface RealProduct {
  brand: string;
  name: string;
  price: string;
  imageUrl: string;
  buyLink: string;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanDetection {
  category: string;
  description: string;
  catalogId: string | null;
  confidence: number;
  bbox: BBox | null;
  frameIdx: number;
  real: RealProduct | null;
}

interface LensMatch {
  title: string;
  source: string;
  link: string;
  image: string;
  price: string;
}

interface CatalogItem {
  id: string;
  category: string;
  brand: string;
  name: string;
  caption: string;
}

async function buildCatalog(): Promise<CatalogItem[]> {
  const feed = await getFeed();
  return feed.map((p) => ({
    id: p.id,
    category: p.category,
    brand: p.brand,
    name: p.product_name,
    caption: p.caption ?? "",
  }));
}

// Detect items via the worker (GPT vision) — returns detections with
// bounding boxes, no Lens enrichment yet.
async function detectItemsRemote(imageUrls: string[]): Promise<ScanDetection[]> {
  if (!PROXY_URL) {
    throw new Error("EXPO_PUBLIC_TRYON_PROXY_URL not set");
  }
  const catalog = await buildCatalog();
  const res = await fetch(`${PROXY_URL}/scan-look`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({ imageUrls, catalog }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Scan failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { detections?: ScanDetection[] };
  return data.detections ?? [];
}

// Crop a local image to the detection's bbox. Returns local URI of crop.
// `bboxMeta` is optional: when provided we reuse the dimensions instead of
// re-probing, since /detect needs the same dimensions.
async function cropDetection(
  localUri: string,
  bbox: BBox,
  meta?: { width: number; height: number },
): Promise<string | null> {
  const dims =
    meta ??
    (await ImageManipulator.manipulateAsync(localUri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    }));
  // Pad the bbox by 6% so we don't slice through the item; clamp inside image.
  // Smaller pad than before — grounding-dino bboxes are tight by design,
  // we don't want to dilute them with too much surrounding context.
  const pad = 0.06;
  const x = Math.max(0, bbox.x - pad);
  const y = Math.max(0, bbox.y - pad);
  const w = Math.min(1 - x, bbox.w + pad * 2);
  const h = Math.min(1 - y, bbox.h + pad * 2);
  if (w <= 0.04 || h <= 0.04) return null;

  const crop = {
    originX: Math.floor(dims.width * x),
    originY: Math.floor(dims.height * y),
    width: Math.max(1, Math.floor(dims.width * w)),
    height: Math.max(1, Math.floor(dims.height * h)),
  };
  // Lens prefers reasonably sized images — upscale tiny crops so SerpAPI
  // doesn't downrank low-res inputs.
  const minSize = 400;
  const scale = Math.max(1, minSize / Math.max(crop.width, crop.height));
  const targetW = Math.floor(crop.width * scale);
  const targetH = Math.floor(crop.height * scale);
  const result = await ImageManipulator.manipulateAsync(
    localUri,
    [{ crop }, { resize: { width: targetW, height: targetH } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

// Map our app-level categories to grounding-dino-friendly query terms.
// "outfit" expands to multiple garment words because grounding-dino performs
// best with concrete nouns.
const CATEGORY_QUERY: Record<string, string> = {
  watch: "watch",
  ring: "ring",
  necklace: "necklace, chain",
  earring: "earring",
  bracelet: "bracelet",
  outfit: "shirt, t-shirt, dress, jacket, coat, hoodie, sweater, top, pants",
  hair: "hair",
  sunglasses: "sunglasses",
  glasses: "glasses, eyeglasses",
  hat: "hat, cap, beanie",
  bag: "bag, handbag, purse, tote",
  scarf: "scarf",
  shoes: "shoes, sneakers, boots",
  belt: "belt",
  makeup: "lipstick",
};

interface GDDetection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // pixel xyxy
}

// Calls the worker's /detect endpoint (Replicate grounding-dino) for a single
// frame. Returns pixel-coord detections or null on failure (caller falls back).
async function detectFrame(
  imageUrl: string,
  query: string,
): Promise<GDDetection[] | null> {
  if (!PROXY_URL || !query) return null;
  try {
    const res = await fetch(`${PROXY_URL}/detect`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ imageUrl, query }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { detections?: GDDetection[] };
    return data.detections ?? [];
  } catch {
    return null;
  }
}

// Pick the grounding-dino detection on this frame whose label best matches
// the given category. Returns null when nothing is close enough.
function pickGDMatch(
  category: string,
  gdDetections: GDDetection[],
): GDDetection | null {
  const cat = category.toLowerCase();
  const queryWords = (CATEGORY_QUERY[cat] ?? cat)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let best: { d: GDDetection; score: number } | null = null;
  for (const d of gdDetections) {
    const label = d.label.toLowerCase();
    const wordHit = queryWords.some((w) => label.includes(w) || w.includes(label));
    if (!wordHit) continue;
    const score = d.confidence;
    if (!best || score > best.score) best = { d, score };
  }
  return best?.d ?? null;
}

// Run a Lens search via the worker (which proxies SerpAPI). Returns ranked
// matches (best for the given category at index 0).
async function lensSearch(
  imageUrl: string,
  category: string,
  hint?: string,
): Promise<LensMatch[]> {
  if (!PROXY_URL) return [];
  try {
    const res = await fetch(`${PROXY_URL}/lens`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ imageUrl, category, hint }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches?: LensMatch[] };
    return data.matches ?? [];
  } catch {
    return [];
  }
}

// Asks the worker to scrape the source page's og:image. Source-page hero
// shots are typically 600-1200px and product-isolated — better for YouCam
// than the small thumbnail SerpAPI returns. Best-effort, falls back silently.
async function scrapeOgImage(pageUrl: string): Promise<string | null> {
  if (!PROXY_URL || !pageUrl) return null;
  try {
    const res = await fetch(`${PROXY_URL}/og-image`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { image?: string | null };
    return data.image ?? null;
  } catch {
    return null;
  }
}

function extractBrand(source: string, fallbackTitle: string): string {
  if (source) {
    const cleaned = source
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split(".")[0];
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  // Fallback: take the first word of the title.
  const firstWord = fallbackTitle.split(/\s+/)[0] ?? "";
  return firstWord.slice(0, 24);
}

function matchToRealProduct(match: LensMatch): RealProduct {
  return {
    brand: extractBrand(match.source, match.title),
    name: match.title.slice(0, 80),
    price: match.price,
    imageUrl: match.image,
    buyLink: match.link,
  };
}

// Try to upgrade a Lens match's small thumbnail to the source page's
// og:image (typically 600-1200px). Awaits with a hard cap so a slow site
// can't stall the scan pipeline.
async function enrichWithOgImage(match: LensMatch): Promise<LensMatch> {
  if (!match.link) return match;
  const og = await scrapeOgImage(match.link);
  if (!og) return match;
  return { ...match, image: og };
}

// Run the full scan pipeline:
//   1. Worker GPT detects items per frame (categories + descriptions + catalog)
//   2. Per frame, run grounding-dino with the union of categories on that
//      frame to get pixel-perfect bboxes (worker /detect)
//   3. Match each GPT detection to its grounding-dino bbox by label
//   4. Crop with the precise bbox (or GPT's approximate bbox as fallback)
//   5. Upload each crop, Lens-search per item, pair top hit
async function runScan(localFrameUris: string[]): Promise<ScanDetection[]> {
  // Upload all frames first so the worker can see them.
  const remoteFrameUrls = await Promise.all(localFrameUris.map((u) => uploadOneShot(u)));
  const detections = await detectItemsRemote(remoteFrameUrls);
  if (detections.length === 0) return [];

  // Probe local frame dimensions once (needed to normalize grounding-dino
  // pixel bboxes). Done in parallel with grounding-dino calls.
  const frameMetaPromise = Promise.all(
    localFrameUris.map((u) =>
      ImageManipulator.manipulateAsync(u, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      }).catch(() => null),
    ),
  );

  // Group categories per frame, then call grounding-dino per frame in parallel.
  const categoriesPerFrame: Map<number, Set<string>> = new Map();
  for (const d of detections) {
    if (!categoriesPerFrame.has(d.frameIdx)) {
      categoriesPerFrame.set(d.frameIdx, new Set());
    }
    categoriesPerFrame.get(d.frameIdx)!.add(d.category.toLowerCase());
  }
  const gdPerFrame: Map<number, GDDetection[]> = new Map();
  await Promise.all(
    Array.from(categoriesPerFrame.entries()).map(async ([frameIdx, cats]) => {
      const queryParts = Array.from(cats).map((c) => CATEGORY_QUERY[c] ?? c);
      const query = Array.from(new Set(queryParts.join(", ").split(",").map((s) => s.trim()))).join(", ");
      const url = remoteFrameUrls[frameIdx];
      if (!url) return;
      const gd = await detectFrame(url, query);
      if (gd) gdPerFrame.set(frameIdx, gd);
    }),
  );

  const frameMetas = await frameMetaPromise;

  // For each detection: pick precise bbox, crop, upload, Lens-search.
  const enriched = await Promise.all(
    detections.map(async (d): Promise<ScanDetection> => {
      const meta = frameMetas[d.frameIdx];
      const gdMatches = gdPerFrame.get(d.frameIdx) ?? [];
      const gd = pickGDMatch(d.category, gdMatches);
      // Build the bbox we'll crop with. Prefer grounding-dino (pixel-precise),
      // fall back to GPT's approximate normalized bbox.
      let bbox: BBox | null = d.bbox;
      if (gd && meta) {
        const [x1, y1, x2, y2] = gd.bbox;
        bbox = {
          x: x1 / meta.width,
          y: y1 / meta.height,
          w: (x2 - x1) / meta.width,
          h: (y2 - y1) / meta.height,
        };
      }

      const pickReal = async (matches: LensMatch[]) => {
        if (!matches[0]) return null;
        // Try to upgrade thumbnail → og:image so YouCam gets a high-res
        // reference. Capped to 4s so it can't stall the pipeline.
        const enriched = await Promise.race([
          enrichWithOgImage(matches[0]),
          new Promise<LensMatch>((resolve) => setTimeout(() => resolve(matches[0]), 4000)),
        ]);
        return matchToRealProduct(enriched);
      };

      if (!bbox) {
        // No usable bbox at all — fall back to a frame-level Lens search.
        const url = remoteFrameUrls[d.frameIdx] ?? remoteFrameUrls[0];
        const matches = await lensSearch(url, d.category, d.description);
        return { ...d, bbox, real: await pickReal(matches) };
      }
      const localFrame = localFrameUris[d.frameIdx] ?? localFrameUris[0];
      const cropLocal = await cropDetection(
        localFrame,
        bbox,
        meta ? { width: meta.width, height: meta.height } : undefined,
      ).catch(() => null);
      if (!cropLocal) {
        const url = remoteFrameUrls[d.frameIdx] ?? remoteFrameUrls[0];
        const matches = await lensSearch(url, d.category, d.description);
        return { ...d, bbox, real: await pickReal(matches) };
      }
      const cropPublic = await uploadOneShot(cropLocal).catch(() => null);
      if (!cropPublic) return { ...d, bbox, real: null };
      const matches = await lensSearch(cropPublic, d.category, d.description);
      return { ...d, bbox, real: await pickReal(matches) };
    }),
  );

  return enriched;
}

// Single-photo scan.
export async function scanPhoto(localUri: string): Promise<ScanDetection[]> {
  return runScan([localUri]);
}

// Video scan — caller hands us already-extracted thumbnail URIs (3 frames
// at 25/50/75% timestamps).
export async function scanVideoFrames(localUris: string[]): Promise<ScanDetection[]> {
  return runScan(localUris.slice(0, 5));
}

// TikTok URL → tikwm.com → multi-frame extraction → existing scan pipeline.
// Done client-side because tikwm rate-limits Cloudflare's shared egress IPs;
// the user's residential IP gets the full free quota (10k/day).
//
// Extraction strategy:
//   1. tikwm gives us mp4 URL + cover URL + duration
//   2. Try to pull 3 frames from the mp4 at 25/50/75% via expo-video-thumbnails
//   3. If video extraction fails OR clip is too short, fall back to cover
export async function scanTikTok(tiktokUrl: string): Promise<ScanDetection[]> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Couldn't reach TikTok extractor (${res.status})`);
  const json = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: {
      cover?: string;
      origin_cover?: string;
      hdplay?: string;
      play?: string;
      duration?: number;
    };
  };
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "Couldn't read this TikTok — is it public?");
  }
  const data = json.data;
  const videoUrl = data.hdplay || data.play;
  const coverUrl = data.origin_cover || data.cover;
  const durationMs = (data.duration ?? 0) * 1000;

  const frameUris: string[] = [];

  // Attempt multi-frame extraction from the mp4 first.
  if (videoUrl && durationMs > 1000) {
    const timestamps =
      durationMs > 6000
        ? [durationMs * 0.2, durationMs * 0.5, durationMs * 0.8]
        : [durationMs * 0.5];
    try {
      const results = await Promise.all(
        timestamps.map((t) =>
          VideoThumbnails.getThumbnailAsync(videoUrl, {
            time: Math.floor(t),
            quality: 0.85,
          }),
        ),
      );
      for (const r of results) frameUris.push(r.uri);
    } catch (err) {
      console.warn("[tiktok] thumbnail extraction failed, falling back to cover:", err);
    }
  }

  // Fallback: download the static cover.
  if (frameUris.length === 0 && coverUrl) {
    const localPath = `${FileSystem.cacheDirectory}tt-${Date.now()}.jpg`;
    const dl = await FileSystem.downloadAsync(coverUrl, localPath);
    if (dl.status !== 200) {
      throw new Error(`Cover download failed (${dl.status})`);
    }
    frameUris.push(dl.uri);
  }

  if (frameUris.length === 0) {
    throw new Error("Couldn't extract any frames from this TikTok");
  }

  return scanVideoFrames(frameUris);
}
