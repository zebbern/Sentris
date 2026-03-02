import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Check, Import, Star, Server, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RegistryCatalogItem } from '@/hooks/queries/useMcpRegistryQueries';

interface RegistryServerCardProps {
  server: RegistryCatalogItem;
  onViewDetails: (name: string) => void;
  onImport: (name: string) => void;
}

const SERVER_TYPE_LABELS: Record<string, { label: string; icon: typeof Server }> = {
  stdio: { label: 'Docker', icon: Server },
  http: { label: 'Remote', icon: Globe },
};

export function RegistryServerCard({ server, onViewDetails, onImport }: RegistryServerCardProps) {
  const handleCardClick = useCallback(() => {
    onViewDetails(server.name);
  }, [server.name, onViewDetails]);

  const handleImportClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onImport(server.name);
    },
    [server.name, onImport],
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onViewDetails(server.name);
      }
    },
    [server.name, onViewDetails],
  );

  const typeInfo = SERVER_TYPE_LABELS[server.serverType] ?? SERVER_TYPE_LABELS.stdio;
  const TypeIcon = typeInfo.icon;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30',
        'flex flex-col h-[220px]',
      )}
      role="button"
      tabIndex={0}
      aria-label={`${server.displayName} — ${server.description}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <CardContent className="flex flex-col flex-1 p-4 gap-3">
        {/* Header: Icon + Name + Featured */}
        <div className="flex items-start gap-3 min-h-[40px]">
          {server.iconUrl ? (
            <img
              src={server.iconUrl}
              alt=""
              width={32}
              height={32}
              className="rounded-md shrink-0 object-contain"
              loading="lazy"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold truncate">{server.displayName}</h3>
              {server.isFeatured && (
                <Star
                  className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                  aria-label="Featured"
                />
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-3 flex-1">
          {server.description || 'No description available.'}
        </p>

        {/* Badges + Import */}
        <div className="flex items-center justify-between gap-2 mt-auto">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {server.category && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 truncate max-w-[100px]"
              >
                {server.category}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 gap-1">
              <TypeIcon className="h-3 w-3" />
              {typeInfo.label}
            </Badge>
          </div>

          {server.isImported ? (
            <Badge variant="success" className="text-[10px] px-1.5 py-0 h-5 gap-1 shrink-0">
              <Check className="h-3 w-3" />
              Imported
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={handleImportClick}
              aria-label={`Import ${server.displayName}`}
            >
              <Import className="h-3 w-3 mr-1" />
              Import
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
