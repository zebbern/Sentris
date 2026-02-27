import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { AlertCircle, CheckCircle, Loader2, KeyRound } from 'lucide-react';
import { TRANSPORT_TYPES } from './types';
import type { TransportType, ServerFormData, HeaderEntry, DiscoveryStatusState } from './types';
import { HeaderEntriesSection } from './HeaderEntriesSection';

interface ManualServerFormProps {
  formData: ServerFormData;
  onFormDataChange: (data: ServerFormData) => void;
  headerEntries: HeaderEntry[];
  secretPickerEntryIndex: number | null;
  onSecretPickerEntryIndexChange: (index: number | null) => void;
  onAddHeader: () => void;
  onUpdateHeader: (index: number, field: 'key' | 'value' | 'secretId', value: string) => void;
  onRemoveHeader: (index: number) => void;
  discoveryStatus: DiscoveryStatusState | null;
  onTestAndDiscover: () => void;
  onSave: () => void;
  isSaving: boolean;
  editingServer: string | null;
  onClose: () => void;
}

export function ManualServerForm({
  formData,
  onFormDataChange,
  headerEntries,
  secretPickerEntryIndex,
  onSecretPickerEntryIndexChange,
  onAddHeader,
  onUpdateHeader,
  onRemoveHeader,
  discoveryStatus,
  onTestAndDiscover,
  onSave,
  isSaving,
  editingServer,
  onClose,
}: ManualServerFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => onFormDataChange({ ...formData, name: e.target.value })}
          placeholder="My MCP Server"
          maxLength={100}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => onFormDataChange({ ...formData, description: e.target.value })}
          placeholder="Optional description..."
          rows={2}
          maxLength={500}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="transportType">Transport Type *</Label>
        <Select
          value={formData.transportType}
          onValueChange={(value) =>
            onFormDataChange({ ...formData, transportType: value as TransportType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSPORT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {formData.transportType === 'http' && (
        <div className="space-y-2">
          <Label htmlFor="endpoint">Endpoint URL *</Label>
          <Input
            id="endpoint"
            value={formData.endpoint}
            onChange={(e) => onFormDataChange({ ...formData, endpoint: e.target.value })}
            placeholder="https://mcp.example.com/mcp"
          />
        </div>
      )}

      {formData.transportType === 'stdio' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="command">Command *</Label>
            <Input
              id="command"
              value={formData.command}
              onChange={(e) => onFormDataChange({ ...formData, command: e.target.value })}
              placeholder="npx"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="args">Arguments (one per line)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onSecretPickerEntryIndexChange(-1)}
              >
                <KeyRound className="h-3 w-3 mr-1" />
                Insert Secret
              </Button>
            </div>
            <Textarea
              id="args"
              value={formData.args}
              onChange={(e) => onFormDataChange({ ...formData, args: e.target.value })}
              placeholder={'-y\n@modelcontextprotocol/server-everything\n{{secret:SECRET_ID}}'}
              rows={3}
            />
            {secretPickerEntryIndex === -1 && (
              <div className="mt-1">
                <SecretSelect
                  value={undefined}
                  onChange={(secretId) => {
                    if (secretId) {
                      const textarea = document.getElementById('args') as HTMLTextAreaElement;
                      if (textarea) {
                        const cursorPos = textarea.selectionStart;
                        const textBefore = formData.args.substring(0, cursorPos);
                        const textAfter = formData.args.substring(cursorPos);
                        const secretRef = `{{secret:${secretId}}}`;
                        onFormDataChange({
                          ...formData,
                          args: textBefore + secretRef + textAfter,
                        });
                        setTimeout(() => {
                          textarea.selectionStart = textarea.selectionEnd =
                            cursorPos + secretRef.length;
                          textarea.focus();
                        }, 0);
                      }
                    }
                    onSecretPickerEntryIndexChange(null);
                  }}
                  placeholder="Select a secret to insert..."
                  clearable={false}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Use &quot;Insert Secret&quot; to add secret references. Each line becomes a separate
              argument.
            </p>
          </div>
        </>
      )}

      <HeaderEntriesSection
        headerEntries={headerEntries}
        secretPickerEntryIndex={secretPickerEntryIndex}
        onSecretPickerEntryIndexChange={onSecretPickerEntryIndexChange}
        onAddHeader={onAddHeader}
        onUpdateHeader={onUpdateHeader}
        onRemoveHeader={onRemoveHeader}
      />

      {discoveryStatus?.status === 'completed' && (
        <div className="flex items-center justify-between p-3 rounded-md bg-success/10 border border-success/20">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span className="text-sm text-success">
              Found {discoveryStatus.toolCount} tool
              {discoveryStatus.toolCount !== 1 ? 's' : ''}
            </span>
          </div>
          <Button size="sm" onClick={onSave} disabled={isSaving || !formData.name.trim()}>
            {isSaving ? 'Saving...' : 'Save MCP Server'}
          </Button>
        </div>
      )}

      {discoveryStatus?.status === 'failed' && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive">
            Discovery failed: {discoveryStatus.error || 'Unknown error'}
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={discoveryStatus?.status === 'running'}
        >
          Cancel
        </Button>
        {discoveryStatus?.status !== 'completed' && (
          <>
            <Button
              variant="outline"
              onClick={onTestAndDiscover}
              disabled={
                discoveryStatus?.status === 'running' ||
                !formData.name.trim() ||
                (!formData.endpoint.trim() && !formData.command.trim())
              }
            >
              {discoveryStatus?.status === 'running' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Discovering...
                </>
              ) : (
                'Test & Discover'
              )}
            </Button>
            <Button
              onClick={onSave}
              disabled={
                isSaving ||
                !formData.name.trim() ||
                (!formData.endpoint.trim() && !formData.command.trim())
              }
            >
              {isSaving ? 'Saving...' : editingServer ? 'Update' : 'Create'}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
