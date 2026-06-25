import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import type { Command, ComponentCommand } from './command-palette-types';

interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  canPlaceComponents: boolean;
  onExecute: () => void;
  onMouseEnter: () => void;
}

export function CommandItem({
  command,
  isSelected,
  canPlaceComponents,
  onExecute,
  onMouseEnter,
}: CommandItemProps) {
  const Icon = command.icon;
  const isComponent = command.type === 'component';
  const hasLogo = isComponent && 'iconUrl' in command && command.iconUrl;

  return (
    <button
      id={`cmd-${command.id}`}
      role="option"
      aria-selected={isSelected}
      data-selected={isSelected}
      onClick={onExecute}
      onMouseEnter={onMouseEnter}
      className={cn(
        'mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-75',
        isSelected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50',
        isComponent && !canPlaceComponents && 'opacity-50',
      )}
      disabled={isComponent && !canPlaceComponents}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {hasLogo ? (
          <img
            src={(command as ComponentCommand & { iconUrl: string }).iconUrl}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : command.iconName ? (
          <DynamicIcon
            name={command.iconName}
            fallback="box"
            className={cn('h-4 w-4', isSelected ? 'text-foreground' : 'text-muted-foreground')}
          />
        ) : Icon ? (
          <Icon
            className={cn('h-4 w-4', isSelected ? 'text-foreground' : 'text-muted-foreground')}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight">{command.label}</div>
        {command.description && (
          <div
            className={cn(
              'mt-0.5 truncate text-xs leading-tight',
              isSelected ? 'text-muted-foreground' : 'text-muted-foreground/60',
            )}
          >
            {command.description}
          </div>
        )}
      </div>
    </button>
  );
}
