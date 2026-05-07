import AsyncStorage from "@react-native-async-storage/async-storage";

const STATS_KEY = "onme.stats";
const COPS_KEY = "onme.cops";

export interface Stats {
  totalCops: number;
  bestStreak: number;
  totalDrops: number;
}

const EMPTY: Stats = { totalCops: 0, bestStreak: 0, totalDrops: 0 };

export async function loadStats(): Promise<Stats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return EMPTY;
  }
}

export async function saveStats(s: Stats): Promise<void> {
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(s));
}

export async function loadCops(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(COPS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function recordCop(postId: string): Promise<void> {
  const set = await loadCops();
  set.add(postId);
  await AsyncStorage.setItem(COPS_KEY, JSON.stringify(Array.from(set)));
}

export async function removeCop(postId: string): Promise<void> {
  const set = await loadCops();
  set.delete(postId);
  await AsyncStorage.setItem(COPS_KEY, JSON.stringify(Array.from(set)));
}
