import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "onme.bag";

export interface BagItem {
  postId: string;
  qty: number;
  addedAt: number;
}

async function read(): Promise<BagItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BagItem[];
  } catch {
    return [];
  }
}

async function write(items: BagItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function getBag(): Promise<BagItem[]> {
  return read();
}

export async function addToBag(postId: string): Promise<void> {
  const items = await read();
  const existing = items.find((i) => i.postId === postId);
  if (existing) {
    existing.qty += 1;
  } else {
    items.push({ postId, qty: 1, addedAt: Date.now() });
  }
  await write(items);
}

export async function setQty(postId: string, qty: number): Promise<void> {
  const items = await read();
  if (qty <= 0) {
    await write(items.filter((i) => i.postId !== postId));
    return;
  }
  const existing = items.find((i) => i.postId === postId);
  if (existing) existing.qty = qty;
  await write(items);
}

export async function removeFromBag(postId: string): Promise<void> {
  const items = await read();
  await write(items.filter((i) => i.postId !== postId));
}

export async function clearBag(): Promise<void> {
  await write([]);
}

export async function bagCount(): Promise<number> {
  const items = await read();
  return items.reduce((sum, i) => sum + i.qty, 0);
}
