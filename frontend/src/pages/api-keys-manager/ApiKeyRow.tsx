import type { useSortable } from '@dnd-kit/sortable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell } from '@/components/ui/table';
import { DragHandle } from '@/components/ui/sortable';
import { ShieldOff, Trash2 } from 'lucide-react';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import type { components } from '@sentris/backend-client';
import { formatDate, truncateKey } from './helpers';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

export interface ApiKeyRowHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

export interface ApiKeyRowProps {
  apiKey: ApiKeyResponseDto;
  handleProps: ApiKeyRowHandleProps;
  isSelected: boolean;
  isReadOnly: boolean;
  onToggle: () => void;
  onRevoke: (key: ApiKeyResponseDto) => void;
  onDelete: (key: ApiKeyResponseDto) => void;
}

export function ApiKeyRow({
  apiKey,
  handleProps,
  isSelected,
  isReadOnly,
  onToggle,
  onRevoke,
  onDelete,
}: ApiKeyRowProps) {
  return (
    <>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          aria-label={`Select ${apiKey.name}`}
        />
      </TableCell>
      <DragHandle {...handleProps} />
      <TableCell className="font-medium">
        <div className="truncate max-w-[150px] md:max-w-none">{apiKey.name}</div>
        {apiKey.description && (
          <div className="text-xs text-muted-foreground truncate max-w-[150px] md:max-w-none">
            {apiKey.description}
          </div>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">{truncateKey(apiKey.keyHint)}</TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-wrap gap-1">
          {Object.entries(apiKey.permissions).map(([resource, actions]) =>
            Object.entries(actions as Record<string, boolean>)
              .filter(([, enabled]) => enabled)
              .map(([action]) => (
                <Badge key={`${resource}:${action}`} variant="secondary" className="text-[10px]">
                  {resource}:{action}
                </Badge>
              )),
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={getStatusBadgeClassFromStatus(
            apiKey.isActive ? 'active' : 'revoked',
            'text-xs',
          )}
        >
          {apiKey.isActive ? 'Active' : 'Revoked'}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs hidden sm:table-cell">
        {formatDate(apiKey.createdAt)}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
        {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never'}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {apiKey.isActive && (
            <Button
              variant="ghost"
              size="icon"
              title="Revoke Key"
              aria-label="Revoke key"
              onClick={() => onRevoke(apiKey)}
              disabled={isReadOnly}
              className="h-8 w-8"
            >
              <ShieldOff className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title="Delete Key"
            aria-label="Delete key"
            onClick={() => onDelete(apiKey)}
            disabled={isReadOnly}
            className="h-8 w-8"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </>
  );
}
