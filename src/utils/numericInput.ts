/**
 * Pure helpers for ergonomic numeric text inputs across the gradebook:
 * - Allows clearing all digits (empty string "") while editing without forcing "0" mid-keystroke.
 * - Accepts both Spanish comma (",") and dot (".") decimal separators.
 * - Commits empty string to `emptyValue` (default 0) on blur/Enter/submit.
 */

export function clampNumericValue(
  value: number,
  options?: { min?: number; max?: number; integer?: boolean }
): number {
  let next = Number.isFinite(value) ? value : 0;
  if (options?.integer) {
    next = Math.round(next);
  }
  if (typeof options?.min === 'number' && Number.isFinite(options.min)) {
    next = Math.max(options.min, next);
  }
  if (typeof options?.max === 'number' && Number.isFinite(options.max)) {
    next = Math.min(options.max, next);
  }
  return Object.is(next, -0) ? 0 : next;
}

export function sanitizeNumericDraft(
  raw: string,
  options?: { allowNegative?: boolean; integer?: boolean }
): string {
  const allowNegative = Boolean(options?.allowNegative);
  const integer = Boolean(options?.integer);
  let result = '';
  let hasDecimal = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch >= '0' && ch <= '9') {
      result += ch;
    } else if (ch === '-' && allowNegative && result.length === 0) {
      result += ch;
    } else if ((ch === '.' || ch === ',') && !integer && !hasDecimal) {
      result += ch;
      hasDecimal = true;
    }
  }

  return result;
}

/**
 * Parses a draft string while typing.
 * Returns `null` when empty or an incomplete sign/separator ("-", ".", ","),
 * or a finite number when parseable (including trailing decimal like "10.").
 */
export function parseNumericDraft(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return null;
  }
  const normalized = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Object.is(value, -0) ? 0 : value);
}

/**
 * Pure helper to move an item in an array from `fromIndex` to `toIndex`.
 */
export function reorderArrayItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
