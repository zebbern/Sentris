import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, ExternalLink, Globe, Import, Key, Server, Star, Tag } from 'lucide-react';
import { useRegistryCatalogDetail } from '@/hooks/queries/useMcpRegistryQueries';

interface RegistryServerDetailSheetProps {
  serverName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (name: string) => void;
}

export function RegistryServerDetailSheet({
  serverName,
  open,
  onOpenChange,
  onImport,
}: RegistryServerDetailSheetProps) {
  const { data: server, isLoading, error } = useRegistryCatalogDetail(serverName);

  const typeInfo =
    server?.serverType === 'remote'
      ? { label: 'Remote', icon: Globe }
      : { label: 'Docker', icon: Server };
  const TypeIcon = typeInfo.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        {isLoading && (
          <div className="space-y-4 py-4" aria-busy="true" aria-label="Loading server details">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {error && (
          <div role="alert" className="py-8 text-center text-sm text-destructive">
            Failed to load server details. Please try again.
          </div>
        )}

        {server && (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-start gap-3">
                {server.iconUrl ? (
                  <img
                    src={server.iconUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="rounded-lg object-contain shrink-0"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Server className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex items-center gap-2 text-lg">
                    {server.displayName}
                    {server.isFeatured && (
                      <Star
                        className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400"
                        aria-label="Featured"
                      />
                    )}
                  </SheetTitle>
                  <SheetDescription className="mt-1">{server.category}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {/* Description */}
            <div className="space-y-4 py-4">
              <p className="text-sm text-foreground leading-relaxed">{server.description}</p>

              {/* Metadata */}
              <div className="space-y-3">
                {/* Server Type */}
                <div className="flex items-center gap-2 text-sm">
                  <TypeIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Type:</span>
                  <Badge variant="outline" className="text-xs">
                    {typeInfo.label}
                  </Badge>
                </div>

                {/* Docker Image */}
                {server.dockerImage && (
                  <div className="flex items-center gap-2 text-sm">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Image:</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {server.dockerImage}
                    </code>
                  </div>
                )}

                {/* Remote URL */}
                {server.remoteConfig?.url && (
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">URL:</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                      {server.remoteConfig.url}
                    </code>
                  </div>
                )}

                {/* Source */}
                {server.sourceUrl && (
                  <div className="flex items-center gap-2 text-sm">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Source:</span>
                    <a
                      href={server.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline-offset-4 hover:underline truncate max-w-[200px]"
                    >
                      {server.sourceUrl}
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </div>
                )}

                {/* Config Requirements */}
                {server.configRequirements.secrets.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Key className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <span className="text-muted-foreground">
                        Requires {server.configRequirements.secrets.length} secret
                        {server.configRequirements.secrets.length !== 1 ? 's' : ''}:
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {server.configRequirements.secrets.map((secret) => (
                          <li key={secret.name} className="text-xs text-muted-foreground">
                            <code className="bg-muted px-1 py-0.5 rounded">{secret.name}</code>
                            <span className="text-destructive ml-1" aria-label="required">
                              *
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Tags */}
                {server.tags.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {server.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-5"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* OAuth notice */}
                {server.oauthProviders.length > 0 && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    This server uses OAuth. Manual configuration may be required after import.
                  </div>
                )}
              </div>
            </div>

            <SheetFooter className="pt-4">
              {server.isImported ? (
                <Badge variant="success" className="gap-1.5 px-3 py-1.5">
                  <Check className="h-4 w-4" />
                  Already imported
                </Badge>
              ) : (
                <Button className="w-full" onClick={() => onImport(server.name)}>
                  <Import className="h-4 w-4 mr-2" />
                  Import to Library
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
