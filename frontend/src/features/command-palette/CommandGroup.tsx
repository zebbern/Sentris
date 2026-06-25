import { Puzzle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  Command,
  CommandCategory,
  CommandGroup as CommandGroupType,
} from './command-palette-types';
import { CommandItem } from './CommandItem';

interface CommandGroupProps {
  group: CommandGroupType;
  startIndex: number;
  selectedIndex: number;
  canPlaceComponents: boolean;
  hasQuery: boolean;
  showDivider?: boolean;
  onExecuteCommand: (cmd: Command) => void;
  onSelectIndex: (index: number) => void;
  onViewAll: (category: CommandCategory) => void;
}

export function CommandGroup({
  group,
  startIndex,
  selectedIndex,
  canPlaceComponents,
  hasQuery,
  showDivider = false,
  onExecuteCommand,
  onSelectIndex,
  onViewAll,
}: CommandGroupProps) {
  return (
    <div className={cn('py-1', showDivider && 'mt-1 border-t border-border/40 pt-2')}>
      <div className="flex items-center gap-2 px-3 py-1">
        {group.category === 'components' && (
          <Puzzle className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground/60">{group.label}</span>
        {hasQuery && group.totalCount > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground/45">
            ({group.totalCount})
          </span>
        )}
        {group.category === 'components' && !canPlaceComponents && (
          <span className="text-[11px] text-muted-foreground/45">(open a workflow first)</span>
        )}
      </div>
      {group.commands.map((command, cmdIndex) => {
        const flatIndex = startIndex + cmdIndex;
        return (
          <CommandItem
            key={command.id}
            command={command}
            isSelected={flatIndex === selectedIndex}
            canPlaceComponents={canPlaceComponents}
            onExecute={() => onExecuteCommand(command)}
            onMouseEnter={() => onSelectIndex(flatIndex)}
          />
        );
      })}
      {group.hasMore && (
        <button
          onClick={() => onViewAll(group.category)}
          className="mx-1.5 w-[calc(100%-0.75rem)] rounded-md px-3 py-1.5 text-left text-xs text-primary hover:bg-accent/40 hover:underline"
        >
          View all {group.totalCount} results
        </button>
      )}
    </div>
  );
}
