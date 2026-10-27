/**
 * Per-browser sidebar conveniences (which agent groups are folded, whether the sidebar is
 * hidden). Storage may be refused (private windows); then nothing is remembered.
 */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the choice still holds for this page.
  }
}
