import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarkdownView } from '@/components/ui/markdown';
import { Wrench, Search, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolItem {
  id: string;
  toolName: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  serverId: string;
  enabled: boolean;
}

interface ToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  tools: ToolItem[];
  selectedServerForTools: string | null;
  discoveringServerIds: Set<string>;
  onToggleTool: (serverId: string, toolId: string) => void;
  onDiscoverTools: (serverId: string) => void;
}

export function ToolsDialog({
  open,
  onOpenChange,
  serverName,
  tools,
  selectedServerForTools,
  discoveringServerIds,
  onToggleTool,
  onDiscoverTools,
}: ToolsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tools from {serverName}</DialogTitle>
          <DialogDescription>
            {tools.length > 0 ? (
              <span className="flex items-center gap-2 mt-1">
                Enabled: {tools.filter((t) => t.enabled).length} / {tools.length}
              </span>
            ) : (
              'These are the tools discovered from this MCP server.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">
          {tools.length === 0 ? (
            <div className="text-center py-8">
              <Wrench className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">No tools discovered yet</p>
              <p className="text-xs text-muted-foreground mb-4">
                Discover tools from this server to enable them in your workflows
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => selectedServerForTools && onDiscoverTools(selectedServerForTools)}
                disabled={
                  !selectedServerForTools || discoveringServerIds.has(selectedServerForTools)
                }
              >
                {selectedServerForTools && discoveringServerIds.has(selectedServerForTools) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Discover Tools
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className={cn(
                    'border rounded-lg p-3 transition-opacity',
                    !tool.enabled && 'opacity-60',
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{tool.toolName}</div>
                      {tool.description && (
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          <MarkdownView
                            content={tool.description}
                            className="prose prose-sm max-w-none"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Enabled</span>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={() => onToggleTool(tool.serverId, tool.id)}
                      />
                    </div>
                  </div>
                  {tool.inputSchema && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        View schema
                      </summary>
                      <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
