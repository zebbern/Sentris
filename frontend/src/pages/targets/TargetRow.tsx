import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Edit3, Trash2 } from 'lucide-react';
import type { Scope } from '@/types/scopes';
import { formatTimeAgo } from '@/utils/timeFormat';

export interface TargetRowProps {
  scope: Scope;
  canManage: boolean;
  onEdit: (scope: Scope) => void;
  onDelete: (scope: Scope) => void;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function buildSummary(scope: Scope): string {
  const parts: string[] = [];
  if (scope.domains.length > 0) parts.push(pluralize(scope.domains.length, 'domain'));
  if (scope.repos.length > 0) parts.push(pluralize(scope.repos.length, 'repo'));
  if (scope.ipRanges.length > 0) parts.push(pluralize(scope.ipRanges.length, 'IP'));
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function TargetRow({ scope, canManage, onEdit, onDelete }: TargetRowProps) {
  return (
    <>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <Link
            to={`/targets/${scope.id}`}
            className="truncate max-w-[160px] hover:underline md:max-w-none"
          >
            {scope.name}
          </Link>
          {scope.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px] md:max-w-none">
              {scope.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{buildSummary(scope)}</TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        Updated {formatTimeAgo(scope.updatedAt)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1 md:gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit target"
                onClick={() => onEdit(scope)}
                disabled={!canManage}
                className="h-8 w-8"
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit target</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete target"
                onClick={() => onDelete(scope)}
                disabled={!canManage}
                className="h-8 w-8"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete target</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </>
  );
}
