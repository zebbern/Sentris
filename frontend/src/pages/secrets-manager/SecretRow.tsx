import type { useSortable } from '@dnd-kit/sortable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell } from '@/components/ui/table';
import { DragHandle } from '@/components/ui/sortable';
import type { SecretSummary } from '@/schemas/secret';
import { formatDate } from './helpers';

export interface SecretRowHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

export interface SecretRowProps {
  secret: SecretSummary;
  handleProps: SecretRowHandleProps;
  isSelected: boolean;
  onToggle: () => void;
  isReadOnly: boolean;
  onEdit: (secret: SecretSummary) => void;
  onDelete: (secret: SecretSummary) => void;
}

export function SecretRow({
  secret,
  handleProps,
  isSelected,
  onToggle,
  isReadOnly,
  onEdit,
  onDelete,
}: SecretRowProps) {
  return (
    <>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          aria-label={`Select ${secret.name}`}
        />
      </TableCell>
      <DragHandle {...handleProps} />
      <TableCell className="align-top">
        <div className="font-medium truncate max-w-[150px] md:max-w-none">{secret.name}</div>
        <div className="text-[10px] md:text-xs text-muted-foreground truncate max-w-[150px] md:max-w-none">
          ID: <span className="font-mono">{secret.id}</span>
        </div>
        {secret.description && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {secret.description}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top hidden sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {secret.tags?.length ? (
            secret.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top hidden md:table-cell">
        {secret.activeVersion ? (
          <div>
            <div className="font-mono text-xs">v{secret.activeVersion.version}</div>
            <div className="text-xs text-muted-foreground">
              Created {formatDate(secret.activeVersion.createdAt)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No active version</span>
        )}
      </TableCell>
      <TableCell className="align-top hidden lg:table-cell">
        <div className="text-xs text-muted-foreground">{formatDate(secret.updatedAt)}</div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex justify-end gap-1 md:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(secret)}
            disabled={isReadOnly}
            aria-disabled={isReadOnly}
            className="text-xs px-2 md:px-3"
          >
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(secret)}
            disabled={isReadOnly}
            aria-disabled={isReadOnly}
            className="text-xs px-2 md:px-3"
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </>
  );
}
