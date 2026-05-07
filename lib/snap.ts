import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode as base64ToArrayBuffer } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "@/lib/supabase/client";
import type { BodyPart } from "@/types";

const KEY = "onme.body_photos";
const BUCKET = "selfies";

interface PhotoEntry {
  localUri: string;
  publicUrl?: string;
}

type StoredPhotos = Partial<Record<BodyPart, PhotoEntry>>;

const inflight = new Map<BodyPart, Promise<string>>();
let cache: StoredPhotos | null = null;

async function readAll(): Promise<StoredPhotos> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  cache = raw ? (JSON.parse(raw) as StoredPhotos) : {};
  return cache;
}

async function writeAll(next: StoredPhotos): Promise<void> {
  cache = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function saveBodyPhoto(part: BodyPart, localUri: string): Promise<void> {
  const all = await readAll();
  await writeAll({ ...all, [part]: { localUri } });
  // Upload in the background — resolvePublicUrlForPart awaits the same promise.
  void resolvePublicUrlForPart(part).catch((e) =>
    console.warn("[snap] background upload failed", part, e),
  );
}

export async function getBodyPhoto(part: BodyPart): Promise<string | null> {
  const all = await readAll();
  return all[part]?.localUri ?? null;
}

export async function getAllBodyPhotos(): Promise<StoredPhotos> {
  return readAll();
}

export async function clearBodyPhoto(part: BodyPart): Promise<void> {
  const all = await readAll();
  const next = { ...all };
  delete next[part];
  await writeAll(next);
}

export async function resolvePublicUrlForPart(part: BodyPart): Promise<string> {
  const all = await readAll();
  const entry = all[part];
  if (!entry) {
    throw new Error(`No photo captured for ${part}`);
  }
  if (entry.publicUrl) return entry.publicUrl;

  const existing = inflight.get(part);
  if (existing) return existing;

  const promise = uploadPhoto(entry.localUri).then(async (publicUrl) => {
    const fresh = await readAll();
    await writeAll({ ...fresh, [part]: { localUri: entry.localUri, publicUrl } });
    return publicUrl;
  });
  inflight.set(part, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(part);
  }
}

// Upload a one-shot local URI without touching the per-body-part cache.
// Used by the corrective retry pipeline when we mutate a photo and need a
// public URL for the variant.
export async function uploadOneShot(localUri: string): Promise<string> {
  return uploadPhoto(localUri);
}

// Re-encode a local photo as PNG (max 1024px on the long edge) and upload
// it. YouCam's hair-color endpoint rejects some JPEGs as "Unsupported image
// type" — converting to PNG sidesteps the issue. We also cap dimensions
// because the endpoint has a tighter size budget than the other VTO ones.
export async function uploadAsPng(localUri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1024 } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG },
  );
  // PNG-encoded but uploadPhoto stores everything with .jpg extension +
  // image/jpeg content type. That mismatch is fine — YouCam reads magic
  // bytes, not headers — and we keep the storage path layout consistent.
  return uploadPhoto(result.uri);
}

// Uploads a photo to the selfies bucket under the authenticated user's
// prefix (`<user_id>/<ts>-<rnd>.jpg`). Returns a URL that downstream
// services (YouCam, SerpAPI Lens) can fetch.
//
// URL strategy is tiered so the same code works whether the bucket is
// private (production, with RLS) or public (early-stage demo):
//   1. Try createSignedUrl — works on private buckets when RLS grants
//      SELECT on the user's own folder. Most secure.
//   2. Fall back to getPublicUrl — works on public buckets without auth.
//   3. If both fail (private bucket, no RLS), throw with a clear message
//      pointing at the dashboard step to fix it.
async function uploadPhoto(localUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: "base64",
  });
  const buffer = base64ToArrayBuffer(base64);
  if (buffer.byteLength === 0) {
    throw new Error(`Read produced 0 bytes from ${localUri}`);
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw new Error("Not signed in — can't upload");
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `${userId}/${filename}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "image/jpeg", upsert: false });
  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  // Try a 1-hour signed URL (private bucket path).
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (signed?.signedUrl) return signed.signedUrl;

  // Fallback for buckets still configured public — the original flow.
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (publicData?.publicUrl) return publicData.publicUrl;

  throw new Error(
    "Couldn't get a URL for the uploaded image. Either set the selfies bucket to public OR apply the RLS policy from README so signed URLs work.",
  );
}

// Legacy single-photo helpers — kept so feed/profile avatar code continues
// to work. Returns the face/ear photo since that's the most "selfie" of the
// captured shots.
export async function saveUserPhoto(localUri: string): Promise<string> {
  await saveBodyPhoto("ear", localUri);
  return localUri;
}

export async function getUserPhoto(): Promise<string | null> {
  return getBodyPhoto("ear");
}
