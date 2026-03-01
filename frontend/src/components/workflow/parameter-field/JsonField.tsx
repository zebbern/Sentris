import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import type { Parameter } from '@/schemas/component';

interface JsonFieldProps {
  parameter: Parameter;
  value: unknown;
  onChange: (value: string | undefined) => void;
}

/**
 * JsonField — JSON textarea editor with syntax validation on blur.
 * Normalizes object values to formatted JSON strings on mount.
 */
export function JsonField({ parameter, value, onChange }: JsonFieldProps) {
  const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isExternalJsonUpdateRef = useRef(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Sync external changes to JSON textarea
  useEffect(() => {
    if (!jsonTextareaRef.current) return;

    let textValue = '';
    let needsNormalization = false;

    if (value === undefined || value === null || value === '') {
      textValue = '';
    } else if (typeof value === 'string') {
      textValue = value;
    } else {
      try {
        textValue = JSON.stringify(value, null, 2);
        needsNormalization = true;
      } catch (error: unknown) {
        logger.error('Failed to serialize JSON parameter value', error);
        return;
      }
    }

    if (jsonTextareaRef.current.value !== textValue) {
      isExternalJsonUpdateRef.current = true;
      jsonTextareaRef.current.value = textValue;
      setJsonError(null);
      isExternalJsonUpdateRef.current = false;
    }

    if (needsNormalization) {
      onChange(textValue);
    }
  }, [value, onChange]);

  // Validate and sync to parent only on blur for native undo behavior
  const handleJsonBlur = useCallback(() => {
    if (!jsonTextareaRef.current) return;
    const nextValue = jsonTextareaRef.current.value;

    if (nextValue.trim() === '') {
      setJsonError(null);
      onChange(undefined);
      return;
    }

    try {
      JSON.parse(nextValue);
      setJsonError(null);
      onChange(nextValue);
    } catch (_error: unknown) {
      setJsonError('Invalid JSON');
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <textarea
        ref={jsonTextareaRef}
        id={parameter.id}
        defaultValue={
          value === undefined || value === null || value === ''
            ? ''
            : typeof value === 'string'
              ? value
              : JSON.stringify(value, null, 2)
        }
        onBlur={handleJsonBlur}
        className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono max-h-[160px] overflow-y-auto"
        rows={Math.min(parameter.rows || 4, 4)}
        placeholder={parameter.placeholder || '{\n  "key": "value"\n}'}
      />
      {jsonError && <p className="text-sm text-red-500">{jsonError}</p>}
    </div>
  );
}
