const STORAGE_KEY = "dance.practice.state";

type StoredState = Record<string, unknown>;

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
