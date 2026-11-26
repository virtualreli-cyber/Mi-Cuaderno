import React, { useEffect, useRef, useState } from 'react';
import {
  clampNumericValue,
  formatNumericValue,
  parseNumericDraft,
  sanitizeNumericDraft,
} from '../../utils/numericInput';

export interface NumericInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'min' | 'max'
  > {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  allowNegative?: boolean;
  /** Value committed when the input is left empty on blur or Enter (defaults to 0, clamped to min/max). */
  emptyValue?: number;
  /** Auto-select all content when focused so typing immediately replaces the current value (defaults to true). */
  selectAllOnFocus?: boolean;
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  min,
  max,
  integer = false,
  allowNegative,
  emptyValue,
  selectAllOnFocus = true,
  onFocus,
  onMouseUp,
  onBlur,
  onKeyDown,
  ...rest
}) => {
  const effectiveAllowNegative =
    allowNegative !== undefined ? allowNegative : typeof min !== 'number' || min < 0;
  const effectiveEmptyValue = clampNumericValue(emptyValue ?? 0, { min, max, integer });

  const [draft, setDraft] = useState<string>(() => formatNumericValue(value));
  const isFocusedRef = useRef(false);
  const selectOnMouseUpRef = useRef(false);
  const lastEmittedRef = useRef<number>(value);

  // Sync external prop updates (e.g. "Repartir pesos al 100%", preset buttons, modal reopen)
  // without clobbering an intentionally empty or in-progress draft while typing.
  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(formatNumericValue(value));
      lastEmittedRef.current = value;
      return;
    }
    if (value !== lastEmittedRef.current) {
      setDraft(formatNumericValue(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  const commitDraft = (rawDraft: string) => {
    const parsed = parseNumericDraft(rawDraft);
    const committed =
      parsed === null
        ? effectiveEmptyValue
        : clampNumericValue(parsed, { min, max, integer });
    lastEmittedRef.current = committed;
    setDraft(formatNumericValue(committed));
    if (committed !== value) {
      onChange(committed);
    }
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      onFocus={(e) => {
        isFocusedRef.current = true;
        if (selectAllOnFocus) {
          selectOnMouseUpRef.current = true;
          const target = e.currentTarget;
          target.select();
        }
        onFocus?.(e);
      }}
      onMouseUp={(e) => {
        if (selectOnMouseUpRef.current) {
          e.preventDefault();
          selectOnMouseUpRef.current = false;
        }
        onMouseUp?.(e);
      }}
      onChange={(e) => {
        const sanitized = sanitizeNumericDraft(e.target.value, {
          allowNegative: effectiveAllowNegative,
          integer,
        });
        setDraft(sanitized);

        const parsed = parseNumericDraft(sanitized);
        if (parsed === null) {
          // Empty or incomplete sign/decimal: report emptyValue to parent so live totals & submits stay accurate
          // while keeping the visible input empty so the user never gets "010".
          lastEmittedRef.current = effectiveEmptyValue;
          if (effectiveEmptyValue !== value) {
            onChange(effectiveEmptyValue);
          }
          return;
        }

        const clamped = clampNumericValue(parsed, { min, max, integer });
        lastEmittedRef.current = clamped;
        if (clamped !== value) {
          onChange(clamped);
        }
      }}
      onKeyDown={(e) => {
        selectOnMouseUpRef.current = false;
        if (e.key === 'Enter') {
          commitDraft(draft);
        }
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        isFocusedRef.current = false;
        selectOnMouseUpRef.current = false;
        commitDraft(draft);
        onBlur?.(e);
      }}
    />
  );
};
