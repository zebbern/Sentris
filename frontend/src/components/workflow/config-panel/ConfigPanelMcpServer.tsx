import { CollapsibleSection } from '@/components/ui/collapsible-section';

export interface ConfigPanelMcpServerProps {
  toolProviderName: string;
  toolProviderDescription?: string;
}

export function ConfigPanelMcpServer({
  toolProviderName,
  toolProviderDescription,
}: ConfigPanelMcpServerProps) {
  return (
    <CollapsibleSection title="MCP Server" defaultOpen={false}>
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">Tool name: </span>
          <span className="font-mono">{toolProviderName}</span>
        </div>
        {toolProviderDescription && (
          <div className="text-[11px] leading-relaxed">{toolProviderDescription}</div>
        )}
        <div className="text-[11px] italic">
          Tool list appears after the MCP server starts at runtime.
        </div>
      </div>
    </CollapsibleSection>
  );
}
