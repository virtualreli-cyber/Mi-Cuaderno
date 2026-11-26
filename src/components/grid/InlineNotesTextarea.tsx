import React, { useEffect, useRef, useState } from 'react';

interface InlineNotesTextareaProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
  onCommit: (nextValue: string) => void;
  onDoubleClickOpenModal: (currentDraft: string, anchorEl: HTMLElement) => void;
}

/**
 * Direct inline notes editor inside the expandable Notes Column.
 * - Single click focuses and edits text immediately in place (no modal).
 * - Commits on blur, Escape, or Ctrl/Cmd+Enter (IME-safe) without flooding undo history per keystroke.
 * - Double click commits any in-progress draft and opens the full tags + notes modal.
 */
export const InlineNotesTextarea: React.FC<InlineNotesTextareaProps> = ({
  value,
  placeholder,
  ariaLabel,
  className = '',
  style,
  onCommit,
  onDoubleClickOpenModal,
}) => {
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  const flushCommit = (textToSave: string) => {
    if (textToSave.trim() !== value.trim()) {
      onCommit(textToSave.trim());
    }
  };

  return (
    <textarea
      ref={textareaRef}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={true}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        isFocusedRef.current = false;
        flushCommit(draft);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        isFocusedRef.current = false;
        flushCommit(draft);
        textareaRef.current?.blur();
        const anchor =
          (e.currentTarget.closest('td, th') as HTMLElement | null) ?? e.currentTarget;
        onDoubleClickOpenModal(draft, anchor);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          isFocusedRef.current = false;
          flushCommit(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          isFocusedRef.current = false;
          flushCommit(draft);
          e.currentTarget.blur();
        }
      }}
      className={`w-full h-full select-text resize-none overflow-y-auto bg-transparent focus:bg-white/95 rounded-lg px-1.5 py-1 leading-snug focus:outline-none focus:ring-2 focus:ring-amber-400/70 transition-colors ${className}`}
    />
  );
};
