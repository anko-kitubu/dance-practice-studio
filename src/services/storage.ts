const STORAGE_KEY = "dance.practice.state";
const HISTORY_KEY = "dance.practice.history";

type StoredState = Record<string, unknown>;

export type HistoryItem = {
  id: string;
  title: string;
  thumbnailUrl: string;
  channelTitle?: string;
  durationSec?: number;
  lastPlayedAt: number;
  lastPositionSec: number;
};

export function loadState<T extends StoredState>(): Partial<T> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Partial<T>;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveState<T extends StoredState>(partial: Partial<T>): Partial<T> {
  try {
    const current = loadState<T>();
    const merged = { ...current, ...partial } as Partial<T>;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return {};
  }
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        title: typeof item.title === "string" ? item.title : "Unknown title",
        thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : "",
        channelTitle: typeof item.channelTitle === "string" ? item.channelTitle : undefined,
        durationSec: typeof item.durationSec === "number" ? item.durationSec : undefined,
        lastPlayedAt: typeof item.lastPlayedAt === "number" ? item.lastPlayedAt : 0,
        lastPositionSec: typeof item.lastPositionSec === "number" ? item.lastPositionSec : 0
      }));
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors.
  }
}
