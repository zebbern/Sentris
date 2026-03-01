import { useCallback, useEffect, useRef } from 'react';
import type { Parameter } from '@/schemas/component';

interface TextareaFieldProps {
  parameter: Parameter;
  value: unknown;
  onChange: (value: string) => void;
}

/**
 * TextareaField — Multi-line text input that syncs to parent on blur
 * for native undo/redo behavior.
 */
export function TextareaField({ parameter, value, onChange }: TextareaFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isExternalUpdateRef = useRef(false);

  const textValue = typeof value === 'string' ? value : '';

  // Sync external changes (e.g., workflow undo) to textarea
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== textValue) {
      isExternalUpdateRef.current = true;
      textareaRef.current.value = textValue;
      isExternalUpdateRef.current = false;
    }
  }, [textValue]);

  // Sync to parent only on blur for native undo behavior
  const handleBlur = useCallback(() => {
    if (textareaRef.current) {
      onChange(textareaRef.current.value);
    }
  }, [onChange]);

  return (
    <textarea
      ref={textareaRef}
      id={parameter.id}
      placeholder={parameter.placeholder}
      defaultValue={textValue}
      onBlur={handleBlur}
      rows={Math.min(parameter.rows || 3, 4)}
      className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono max-h-[160px] overflow-y-auto"
    />
  );
}
