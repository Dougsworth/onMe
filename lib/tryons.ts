import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "onme.tryons";
const MAX = 30;

export interface TryOnEntry {
  postId: string;
  resultUrl: string;
  createdAt: number;
}

async function read(): Promise<TryOnEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TryOnEntry[];
  } catch {
    return [];
  }
}

async function write(entries: TryOnEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
}

export async function recordTryOn(postId: string, resultUrl: string): Promise<void> {
  const existing = await read();
  // De-dupe: if the same post already has an entry, replace it so the most
  // recent render bubbles to the top.
  const next = [
    { postId, resultUrl, createdAt: Date.now() },
    ...existing.filter((e) => e.postId !== postId),
  ].slice(0, MAX);
  await write(next);
}

export async function getTryOns(): Promise<TryOnEntry[]> {
  return read();
}

export async function clearTryOns(): Promise<void> {
  await write([]);
}
