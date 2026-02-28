import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { KeyboardEvent } from 'react';

export interface ManualListChipsInputProps {
  inputId: string;
  manualValue: unknown;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string[] | undefined) => void;
}

export function ManualListChipsInput({
  inputId,
  manualValue,
  disabled,
  placeholder,
  onChange,
}: ManualListChipsInputProps) {
  const listItems = Array.isArray(manualValue)
    ? manualValue.filter((item): item is string => typeof item === 'string')
    : [];
  const [draftValue, setDraftValue] = useState('');

  useEffect(() => {
    setDraftValue('');
  }, [manualValue]);

  const handleAdd = () => {
    const nextValue = draftValue.trim();
    if (!nextValue) {
      return;
    }
    onChange([...listItems, nextValue]);
    setDraftValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!disabled) {
        handleAdd();
      }
    }
  };

  const handleRemove = (index: number) => {
    if (disabled) return;
    const remaining = [...listItems];
    remaining.splice(index, 1);
    onChange(remaining.length > 0 ? remaining : undefined);
  };

  const handleClear = () => {
    if (disabled) return;
    onChange(undefined);
  };

  const canAdd = draftValue.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={`manual-${inputId}-list`}
          placeholder={placeholder}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="flex-1 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={disabled || !canAdd}
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {listItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listItems.map((item, index) => (
            <Badge key={`${inputId}-chip-${index}`} variant="outline" className="gap-1 pr-1">
              <span className="max-w-[160px] truncate">{item}</span>
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground transition hover:text-foreground hover:bg-muted"
                  onClick={() => handleRemove(index)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && listItems.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-fit text-xs px-2"
          onClick={handleClear}
        >
          Clear manual value
        </Button>
      )}
    </div>
  );
}
