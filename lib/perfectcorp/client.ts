import type { Category } from "@/types";

const API_BASE = "https://yce-api-01.perfectcorp.com";

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const apiKey = process.env.PERFECTCORP_API_KEY;
  const apiSecret = process.env.PERFECTCORP_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("Perfect Corp API credentials missing");
  }

  const res = await fetch(`${API_BASE}/s2s/v1.0/client/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, id_token: apiSecret }),
  });
  if (!res.ok) {
    throw new Error(`Perfect Corp auth failed: ${res.status}`);
  }
  const data = (await res.json()) as { result: { access_token: string } };
  cached = {
    token: data.result.access_token,
    expiresAt: Date.now() + 1000 * 60 * 60 * 23,
  };
  return cached.token;
}

export const PERFECTCORP_TASK_BY_CATEGORY: Record<Category, string> = {
  watch: "wrist_accessories",
  bracelet: "wrist_accessories",
  ring: "ring",
  necklace: "necklace",
  earring: "earrings",
  outfit: "clothes_v3",
};

export interface TryOnRequest {
  category: Category;
  userPhotoUrl: string;
  productImageUrl: string;
}

export interface TryOnResult {
  resultImageUrl: string;
  taskId: string;
}

export async function runTryOn(req: TryOnRequest): Promise<TryOnResult> {
  const token = await getAccessToken();
  const taskKind = PERFECTCORP_TASK_BY_CATEGORY[req.category];

  const startRes = await fetch(`${API_BASE}/s2s/v1.0/task/ai-tryon`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kind: taskKind,
      user_image_url: req.userPhotoUrl,
      product_image_url: req.productImageUrl,
    }),
  });
  if (!startRes.ok) throw new Error(`Try-on start failed: ${startRes.status}`);
  const { result } = (await startRes.json()) as {
    result: { task_id: string };
  };
  const taskId = result.task_id;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(
      `${API_BASE}/s2s/v1.0/task/ai-tryon?task_id=${taskId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!pollRes.ok) continue;
    const data = (await pollRes.json()) as {
      result: { status: string; result_url?: string };
    };
    if (data.result.status === "success" && data.result.result_url) {
      return { resultImageUrl: data.result.result_url, taskId };
    }
    if (data.result.status === "error") {
      throw new Error("Perfect Corp try-on returned error");
    }
  }
  throw new Error("Perfect Corp try-on timed out");
}
