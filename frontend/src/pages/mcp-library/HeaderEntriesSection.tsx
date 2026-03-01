import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { Plus, Trash2, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HeaderEntry } from './types';

interface HeaderEntriesSectionProps {
  headerEntries: HeaderEntry[];
  secretPickerEntryIndex: number | null;
  onSecretPickerEntryIndexChange: (index: number | null) => void;
  onAddHeader: () => void;
  onUpdateHeader: (index: number, field: 'key' | 'value' | 'secretId', value: string) => void;
  onRemoveHeader: (index: number) => void;
}

export function HeaderEntriesSection({
  headerEntries,
  secretPickerEntryIndex,
  onSecretPickerEntryIndexChange,
  onAddHeader,
  onUpdateHeader,
  onRemoveHeader,
}: HeaderEntriesSectionProps) {
  return (
    <div className="space-y-3">
      <Label>Headers</Label>
      {headerEntries.length > 0 ? (
        <div className="space-y-2">
          {headerEntries.map((entry, index) => (
            <div key={`${index}-${entry.key}`} className="flex gap-2 items-center">
              <Input
                value={entry.key}
                onChange={(e) => onUpdateHeader(index, 'key', e.target.value)}
                placeholder="Header name"
                className="flex-1 font-mono text-sm"
                aria-label={`Header ${index + 1} name`}
              />
              <div className="relative flex-1">
                <Input
                  type={entry.secretId ? 'text' : 'password'}
                  value={entry.secretId ? `🔐 Secret` : entry.value}
                  onChange={(e) => onUpdateHeader(index, 'value', e.target.value)}
                  placeholder="Value"
                  className={cn('font-mono text-sm pr-20', entry.secretId && 'text-success')}
                  aria-label={`Header ${index + 1} value`}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onSecretPickerEntryIndexChange(index)}
                    title="Pick a secret"
                    aria-label="Pick a secret"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {secretPickerEntryIndex === index && (
                  <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-popover border rounded-md shadow-lg p-2">
                    <SecretSelect
                      value={entry.secretId}
                      onChange={(secretId) => {
                        onUpdateHeader(index, 'secretId', secretId ?? '');
                        onSecretPickerEntryIndexChange(null);
                      }}
                      placeholder="Select a secret..."
                      clearable={true}
                    />
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemoveHeader(index)}
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                aria-label="Remove header entry"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-2">
          No headers configured. Add headers for authentication.
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onAddHeader} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Add Header
      </Button>
      <p className="text-xs text-muted-foreground">
        Pick a secret to reference stored values, or enter values directly. Headers are securely
        encrypted when stored.
      </p>
    </div>
  );
}
