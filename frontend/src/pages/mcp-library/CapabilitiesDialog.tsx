import type {
  McpCatalog,
  PromptDescriptor,
  ResourceDescriptor,
  ResourceTemplateDescriptor,
} from '@sentris/shared';
import type { ReactNode } from 'react';
import { BookOpen, Loader2, MessageSquareText, Search, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarkdownView } from '@/components/ui/markdown';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CapabilityPreview } from './CapabilityPreview';

interface ToolItem {
  id: string;
  toolName: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  serverId: string;
  enabled: boolean;
}

interface CapabilitiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  tools: ToolItem[];
  catalog: McpCatalog | null;
  catalogDiscoveredAt: string | null;
  resourceTemplateVariables: Record<string, string[]>;
  isLoadingCatalog: boolean;
  catalogError?: string;
  selectedServerId: string | null;
  discoveringServerIds: Set<string>;
  onToggleTool: (serverId: string, toolId: string) => void;
  onDiscoverCapabilities: (serverId: string) => void;
}

export function CapabilitiesDialog({
  open,
  onOpenChange,
  serverName,
  tools,
  catalog,
  catalogDiscoveredAt,
  resourceTemplateVariables,
  isLoadingCatalog,
  catalogError,
  selectedServerId,
  discoveringServerIds,
  onToggleTool,
  onDiscoverCapabilities,
}: CapabilitiesDialogProps) {
  const resourceCount = (catalog?.resources.length ?? 0) + (catalog?.resourceTemplates.length ?? 0);
  const promptCount = catalog?.prompts.length ?? 0;
  const isDiscovering = selectedServerId ? discoveringServerIds.has(selectedServerId) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Capabilities from {serverName}</DialogTitle>
          <DialogDescription>
            {isLoadingCatalog
              ? 'Loading the latest saved discovery catalog…'
              : `${tools.length} tools · ${resourceCount} resources · ${promptCount} prompts`}
            {catalogDiscoveredAt && (
              <span className="block mt-1">
                Discovered {new Date(catalogDiscoveredAt).toLocaleString()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {catalogError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {catalogError}
          </div>
        )}

        {isLoadingCatalog ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="tools">
            <TabsList className="w-full justify-start" aria-label="MCP capability types">
              <TabsTrigger value="tools">Tools ({tools.length})</TabsTrigger>
              <TabsTrigger value="resources">Resources ({resourceCount})</TabsTrigger>
              <TabsTrigger value="prompts">Prompts ({promptCount})</TabsTrigger>
            </TabsList>

            <div className="max-h-[58vh] overflow-y-auto pt-4">
              {!catalog && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
                  <div>
                    <p className="text-sm font-medium">Complete catalog not discovered yet</p>
                    <p className="text-xs text-muted-foreground">
                      Run discovery to load resources, templates, and prompts from this server.
                    </p>
                  </div>
                  <DiscoverButton
                    selectedServerId={selectedServerId}
                    isDiscovering={isDiscovering}
                    onDiscover={onDiscoverCapabilities}
                  />
                </div>
              )}

              <TabsContent value="tools" className="mt-0">
                <ToolsList tools={tools} onToggleTool={onToggleTool} />
              </TabsContent>

              <TabsContent value="resources" className="mt-0 space-y-3">
                <ResourcesList
                  resources={catalog?.resources ?? []}
                  templates={catalog?.resourceTemplates ?? []}
                  resourceTemplateVariables={resourceTemplateVariables}
                  serverId={selectedServerId}
                />
              </TabsContent>

              <TabsContent value="prompts" className="mt-0 space-y-3">
                <PromptsList prompts={catalog?.prompts ?? []} serverId={selectedServerId} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToolsList({
  tools,
  onToggleTool,
}: {
  tools: ToolItem[];
  onToggleTool: (serverId: string, toolId: string) => void;
}) {
  if (tools.length === 0) {
    return (
      <CapabilityEmptyState
        icon={Wrench}
        title="No tools discovered yet"
        description="Discover this server to enable its tools in workflows and Agents."
      />
    );
  }

  return (
    <div className="space-y-3">
      {tools.map((tool) => (
        <div
          key={tool.id}
          className={cn('rounded-lg border p-3 transition-opacity', !tool.enabled && 'opacity-60')}
        >
          <div className="flex items-start justify-between gap-4">
            <CapabilitySummary name={tool.toolName} description={tool.description ?? undefined} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Enabled</span>
              <Switch
                aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.toolName}`}
                checked={tool.enabled}
                onCheckedChange={() => onToggleTool(tool.serverId, tool.id)}
              />
            </div>
          </div>
          {tool.inputSchema && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                View schema
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function ResourcesList({
  resources,
  templates,
  resourceTemplateVariables,
  serverId,
}: {
  resources: ResourceDescriptor[];
  templates: ResourceTemplateDescriptor[];
  resourceTemplateVariables: Record<string, string[]>;
  serverId: string | null;
}) {
  if (resources.length === 0 && templates.length === 0) {
    return (
      <CapabilityEmptyState
        icon={BookOpen}
        title="No resources exposed"
        description="This server did not advertise exact resources or resource templates."
      />
    );
  }

  return (
    <>
      {resources.map((resource) => (
        <CapabilityCard
          key={`resource:${resource.uri}`}
          name={resource.title ?? resource.name}
          description={resource.description}
          target={resource.uri}
          badge="Resource"
          mimeType={resource.mimeType}
        >
          {serverId && (
            <CapabilityPreview
              serverId={serverId}
              buildRequest={() => ({ kind: 'resource', uri: resource.uri })}
            />
          )}
        </CapabilityCard>
      ))}
      {templates.map((template) => (
        <CapabilityCard
          key={`template:${template.uriTemplate}`}
          name={template.title ?? template.name}
          description={template.description}
          target={template.uriTemplate}
          badge="Template"
          mimeType={template.mimeType}
        >
          {serverId && (
            <CapabilityPreview
              serverId={serverId}
              variables={(resourceTemplateVariables[template.uriTemplate] ?? []).map((name) => ({
                name,
              }))}
              buildRequest={(argumentsByName) => ({
                kind: 'resource-template',
                uriTemplate: template.uriTemplate,
                arguments: argumentsByName,
              })}
            />
          )}
        </CapabilityCard>
      ))}
    </>
  );
}

function PromptsList({
  prompts,
  serverId,
}: {
  prompts: PromptDescriptor[];
  serverId: string | null;
}) {
  if (prompts.length === 0) {
    return (
      <CapabilityEmptyState
        icon={MessageSquareText}
        title="No prompts exposed"
        description="This server did not advertise reusable prompts."
      />
    );
  }

  return (
    <>
      {prompts.map((prompt) => (
        <div key={prompt.name} className="rounded-lg border p-3">
          <CapabilitySummary name={prompt.title ?? prompt.name} description={prompt.description} />
          {serverId && (
            <CapabilityPreview
              serverId={serverId}
              variables={prompt.arguments}
              buildRequest={(argumentsByName) => ({
                kind: 'prompt',
                name: prompt.name,
                arguments: argumentsByName,
              })}
            />
          )}
        </div>
      ))}
    </>
  );
}

function CapabilityCard({
  name,
  description,
  target,
  badge,
  mimeType,
  children,
}: {
  name: string;
  description?: string;
  target: string;
  badge: string;
  mimeType?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <CapabilitySummary name={name} description={description} />
        <Badge variant="secondary">{badge}</Badge>
      </div>
      <code className="mt-3 block break-all rounded bg-muted px-2 py-1.5 text-xs">{target}</code>
      {mimeType && <p className="mt-2 text-xs text-muted-foreground">{mimeType}</p>}
      {children}
    </div>
  );
}

function CapabilitySummary({ name, description }: { name: string; description?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium">{name}</div>
      {description && (
        <MarkdownView
          content={description}
          className="mt-1 line-clamp-3 text-sm text-muted-foreground"
        />
      )}
    </div>
  );
}

function DiscoverButton({
  selectedServerId,
  isDiscovering,
  onDiscover,
}: {
  selectedServerId: string | null;
  isDiscovering: boolean;
  onDiscover: (serverId: string) => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => selectedServerId && onDiscover(selectedServerId)}
      disabled={!selectedServerId || isDiscovering}
    >
      {isDiscovering ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Discovering…
        </>
      ) : (
        <>
          <Search className="mr-2 h-4 w-4" />
          Discover capabilities
        </>
      )}
    </Button>
  );
}

function CapabilityEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-8 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
      <p className="mb-1 text-sm font-medium">{title}</p>
      <p className="mx-auto mb-4 max-w-md text-xs text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
