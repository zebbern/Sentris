export interface ConfigPanelFooterProps {
  nodeId: string;
  componentSlug: string;
}

export function ConfigPanelFooter({ nodeId, componentSlug }: ConfigPanelFooterProps) {
  return (
    <div className="px-4 py-2 border-t">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-mono truncate max-w-[140px]" title={nodeId}>
          {nodeId}
        </span>
        <span className="font-mono">{componentSlug}</span>
      </div>
    </div>
  );
}
