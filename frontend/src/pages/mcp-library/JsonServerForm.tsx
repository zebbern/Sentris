import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, HelpCircle, Loader2 } from 'lucide-react';

interface JsonServerFormProps {
  editingServer: string | null;
  jsonValue: string;
  onJsonValueChange: (value: string) => void;
  jsonParseError: string | null;
  onJsonParseErrorChange: (error: string | null) => void;
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

      <div className="flex flex-col gap-3 pt-4">
        {!editingServer && jsonValue.trim() && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Servers are saved first, then their complete capabilities are discovered through the
              same runtime used by workflows and Agents. Failed configurations remain editable.
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving || isImporting || !jsonValue.trim()}>
            {editingServer ? (
              isSaving || isImporting ? (
                'Updating & discovering...'
              ) : (
                'Update & Discover'
              )
            ) : isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing & discovering...
              </>
            ) : (
              'Import & Discover'
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
