import { Puzzle } from 'lucide-react';
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
  onExecuteCommand,
  onSelectIndex,
  onViewAll,
}: CommandGroupProps) {
  return (
    <div className="py-2">
      <div className="px-4 py-1.5 flex items-center gap-2">
        {group.category === 'components' && <Puzzle className="w-3 h-3 text-muted-foreground/70" />}
        <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
          {group.label}
        </span>
        {hasQuery && group.totalCount > 0 && (
          <span className="text-xs text-muted-foreground/50 tabular-nums">
            ({group.totalCount})
          </span>
        )}
        {group.category === 'components' && !canPlaceComponents && (
          <span className="text-xs text-muted-foreground/50 normal-case tracking-normal">
            (open a workflow first)
          </span>
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
          className="w-full px-4 py-1.5 text-left text-xs text-primary hover:underline"
        >
          View all {group.totalCount} results
        </button>
      )}
    </div>
  );
}
