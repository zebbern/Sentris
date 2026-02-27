/**
 * Normalize a runtime inputs value to a typed array.
 *
 * Handles plain arrays, JSON-encoded strings, and unknown/undefined values
 * gracefully — always returns an array (possibly empty).
 *
 * Previously duplicated in ConfigPanel.tsx and ScheduleEditorDrawer.tsx.
 */
export function normalizeRuntimeInputs<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
