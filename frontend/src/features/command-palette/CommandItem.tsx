import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';
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
        'w-full flex items-center gap-3 px-3 py-2.5 pl-3 border-l-2 text-left transition-colors duration-75',
        isSelected
          ? 'bg-primary/10 border-primary text-foreground'
          : 'hover:bg-accent/50 border-transparent text-muted-foreground',
        isComponent && !canPlaceComponents && 'opacity-50',
      )}
      disabled={isComponent && !canPlaceComponents}
    >
      {/* Icon or Logo */}
      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
        {hasLogo ? (
          <img
            src={(command as ComponentCommand & { iconUrl: string }).iconUrl}
            alt=""
            width={20}
            height={20}
            className="w-5 h-5 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : command.iconName ? (
          <DynamicIcon
            name={command.iconName}
            fallback="box"
            className={cn('w-4 h-4', isSelected ? 'text-primary' : 'text-muted-foreground')}
          />
        ) : Icon ? (
          <Icon className={cn('w-4 h-4', isSelected ? 'text-primary' : 'text-muted-foreground')} />
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{command.label}</div>
        {command.description && (
          <div
            className={cn(
              'text-xs truncate',
              isSelected ? 'text-muted-foreground' : 'text-muted-foreground',
            )}
          >
            {command.description}
          </div>
        )}
      </div>
      {isSelected && <ArrowRight className="w-4 h-4 flex-shrink-0 text-primary" />}
    </button>
  );
}
