import { describe, expect, it } from 'vitest';
import {
  clampNumericValue,
  formatNumericValue,
  parseNumericDraft,
  reorderArrayItem,
  sanitizeNumericDraft,
} from '../../utils/numericInput';

describe('numericInput helpers', () => {
  it('allows empty draft so deleting all digits does not inject 0 mid-keystroke', () => {
    expect(sanitizeNumericDraft('', { allowNegative: false })).toBe('');
    expect(parseNumericDraft('')).toBeNull();
    expect(parseNumericDraft('   ')).toBeNull();
  });

  it('sanitizes and parses both comma and dot decimal values cleanly', () => {
    expect(sanitizeNumericDraft('07,5a', { allowNegative: false })).toBe('07,5');
    expect(parseNumericDraft('7,5')).toBe(7.5);
    expect(parseNumericDraft('10.')).toBe(10);
    expect(parseNumericDraft('10,')).toBe(10);
    expect(sanitizeNumericDraft('12.3.4', { allowNegative: false })).toBe('12.34');
    expect(sanitizeNumericDraft('-3,25', { allowNegative: true })).toBe('-3,25');
    expect(parseNumericDraft('-3,25')).toBe(-3.25);
    expect(sanitizeNumericDraft('-3,25', { allowNegative: false })).toBe('3,25');
    expect(sanitizeNumericDraft('12,9', { integer: true })).toBe('129');
  });

  it('clamps and formats committed values safely', () => {
    expect(clampNumericValue(120, { min: 0, max: 100 })).toBe(100);
    expect(clampNumericValue(-5, { min: 0, max: 100 })).toBe(0);
    expect(clampNumericValue(4.7, { min: 1, max: 99, integer: true })).toBe(5);
    expect(formatNumericValue(-0)).toBe('0');
    expect(formatNumericValue(7.5)).toBe('7.5');
  });

  it('reorders rubric criteria cleanly without mutating the source array', () => {
    const src = ['c1', 'c2', 'c3', 'c4'];
    expect(reorderArrayItem(src, 0, 2)).toEqual(['c2', 'c3', 'c1', 'c4']);
    expect(reorderArrayItem(src, 3, 1)).toEqual(['c1', 'c4', 'c2', 'c3']);
    expect(reorderArrayItem(src, 1, 1)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(src).toEqual(['c1', 'c2', 'c3', 'c4']);
  });
});
