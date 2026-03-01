import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { McpDiscoveryPreview } from '@/components/mcp/McpDiscoveryPreview';
import { Search, AlertCircle, HelpCircle, Loader2 } from 'lucide-react';
import type { DiscoveryPreviewItem } from './types';

interface JsonServerFormProps {
  editingServer: string | null;
  jsonValue: string;
  onJsonValueChange: (value: string) => void;
  jsonParseError: string | null;
  onJsonParseErrorChange: (error: string | null) => void;
  isTestingDiscovery: boolean;
  discoveryPreview: DiscoveryPreviewItem[] | null;
  onClearDiscoveryPreview: () => void;
  onTestAndDiscover: () => void;
  onSave: () => void;
  isSaving: boolean;
  isImporting: boolean;
  onClose: () => void;
}

export function JsonServerForm({
  editingServer,
  jsonValue,
  onJsonValueChange,
  jsonParseError,
  onJsonParseErrorChange,
  isTestingDiscovery,
  discoveryPreview,
  onClearDiscoveryPreview,
  onTestAndDiscover,
  onSave,
  isSaving,
  isImporting,
  onClose,
}: JsonServerFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="json-server-config">
          {editingServer ? 'Server Configuration (JSON)' : 'Paste JSON Config'}
        </Label>
        <Textarea
          id="json-server-config"
          value={jsonValue}
          onChange={(e) => {
            onJsonValueChange(e.target.value);
            onJsonParseErrorChange(null);
          }}
          placeholder={`{
  "mcpServers": {
    "server-name": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  }
}`}
          rows={14}
          className="font-mono text-sm"
        />
        {jsonParseError && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{jsonParseError}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {editingServer
            ? 'Edit the JSON configuration and save.'
            : 'Paste Claude Code config format. Multiple servers will be created.'}
        </p>
      </div>

      {discoveryPreview && (
        <McpDiscoveryPreview results={discoveryPreview} onClear={onClearDiscoveryPreview} />
      )}

      <div className="flex flex-col gap-3 pt-4">
        {!editingServer && !discoveryPreview && jsonValue.trim() && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Run &quot;Test &amp; Discover&quot; first to validate servers and discover available
              tools before importing.
            </span>
          </div>
        )}

        {!editingServer && discoveryPreview && (
          <div className="flex items-center justify-between text-sm bg-success/10 border border-success/20 rounded-md px-3 py-2">
            <span className="text-success">
              {discoveryPreview.filter((r) => r.status === 'completed').length} of{' '}
              {discoveryPreview.length} servers ready
              {discoveryPreview.some((r) => r.status === 'completed') && (
                <span className="text-success ml-2">
                  (
                  {discoveryPreview
                    .filter((r) => r.status === 'completed')
                    .reduce((sum, r) => sum + (r.toolCount ?? 0), 0)}{' '}
                  tools discovered)
                </span>
              )}
            </span>
            {discoveryPreview.some((r) => r.status === 'failed') && (
              <span className="text-destructive">
                {discoveryPreview.filter((r) => r.status === 'failed').length} failed
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!editingServer && (
            <Button
              variant="outline"
              onClick={onTestAndDiscover}
              disabled={isTestingDiscovery || !jsonValue.trim()}
            >
              {isTestingDiscovery ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Test & Discover
                </>
              )}
            </Button>
          )}
          <Button
            onClick={onSave}
            disabled={
              (editingServer ? isSaving : isImporting) ||
              !jsonValue.trim() ||
              (!editingServer && !discoveryPreview) ||
              (!editingServer &&
                discoveryPreview?.some((r) => r.status === 'discovering' || r.status === 'pending'))
            }
          >
            {editingServer
              ? isSaving
                ? 'Saving...'
                : 'Update'
              : isImporting
                ? 'Importing...'
                : discoveryPreview && discoveryPreview.some((r) => r.status === 'completed')
                  ? `Import ${discoveryPreview.filter((r) => r.status === 'completed').length} Server${discoveryPreview.filter((r) => r.status === 'completed').length === 1 ? '' : 's'}`
                  : 'Import'}
          </Button>
        </div>
      </div>
    </>
  );
}
