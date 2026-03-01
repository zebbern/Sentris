import { Hammer, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import type { ComponentMetadata } from '@/schemas/component';
import type { NodeStatus } from '@/schemas/node';
import type { NodeStateStyle } from '../nodeStyles';
import { TerminalButton } from './TerminalButton';
import type { LucideIcon } from 'lucide-react';

export interface NodeHeaderProps {
  id: string;
  component: ComponentMetadata;
  // Label state
  displayLabel: string;
  hasCustomLabel: boolean;
  isEditingLabel: boolean;
  editingLabelValue: string;
  labelInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingLabelValue: (v: string) => void;
  handleStartEditing: () => void;
  handleSaveLabel: () => void;
  handleLabelKeyDown: (e: React.KeyboardEvent) => void;
  // Node classification
  isEntryPoint: boolean;
  isToolMode: boolean;
  isToolModeOnly: boolean;
  showMcpBadge: boolean;
  mode: string;
  // Status
  effectiveStatus: string;
  nodeStatus: NodeStatus | undefined;
  nodeStyle: NodeStateStyle;
  StatusIcon: LucideIcon | null;
  isTimelineActive: boolean;
  isPlaying: boolean;
  hasUnfilledRequired: boolean;
  // Terminal
  supportsLiveLogs: boolean;
  selectedRunId: string | null;
  isTerminalLoading: boolean;
  terminalSession: { chunks?: unknown[] } | undefined;
  // Actions
  toggleToolMode: (e: React.MouseEvent) => void;
  handleDelete: (e: React.MouseEvent) => void;
  isMobile: boolean;
  // Styling
  separatorColor: string | undefined;
  headerBackgroundColor: string | undefined;
  // Entry-point header extras
  entryPointHeaderSlot?: React.ReactNode;
}

/**
 * Node header bar: icon, label (with inline editing), tool-mode toggle,
 * status icon, terminal button, and delete button.
 */
export function NodeHeader({
  id,
  component,
  displayLabel,
  hasCustomLabel,
  isEditingLabel,
  editingLabelValue,
  labelInputRef,
  setEditingLabelValue,
  handleStartEditing,
  handleSaveLabel,
  handleLabelKeyDown,
  isEntryPoint,
  isToolMode,
  isToolModeOnly,
  showMcpBadge,
  mode,
  effectiveStatus,
  nodeStatus,
  nodeStyle,
  StatusIcon,
  isTimelineActive,
  isPlaying,
  hasUnfilledRequired,
  supportsLiveLogs,
  selectedRunId,
  isTerminalLoading,
  terminalSession,
  toggleToolMode,
  handleDelete,
  isMobile,
  separatorColor,
  headerBackgroundColor,
  entryPointHeaderSlot,
}: NodeHeaderProps) {
  const componentCategory = component.category ?? 'input';

  return (
    <div
      className={cn(
        'px-3 py-2 border-b relative',
        isEntryPoint ? 'rounded-t-[1.5rem]' : 'rounded-t-lg',
      )}
      style={{
        borderColor: separatorColor || 'hsl(var(--border) / 0.5)',
        backgroundColor: headerBackgroundColor || undefined,
      }}
    >
      <div className="flex items-start gap-2">
        {component.logo && (
          <img
            src={component.logo}
            alt={component.name}
            width={20}
            height={20}
            className="h-5 w-5 mt-0.5 flex-shrink-0 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        )}
        <DynamicIcon
          name={component.icon || 'Box'}
          className={cn('h-5 w-5 mt-0.5 flex-shrink-0 text-foreground', component.logo && 'hidden')}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {isEditingLabel ? (
                <input
                  ref={labelInputRef}
                  type="text"
                  value={editingLabelValue}
                  onChange={(e) => setEditingLabelValue(e.target.value)}
                  onBlur={handleSaveLabel}
                  onKeyDown={handleLabelKeyDown}
                  className="text-sm font-semibold bg-transparent border-b border-primary outline-none focus-visible:ring-2 focus-visible:ring-ring w-full py-0"
                  autoFocus
                />
              ) : (
                <div
                  className={cn('group/label', !isEntryPoint && mode === 'design' && 'cursor-text')}
                  onDoubleClick={handleStartEditing}
                  title={!isEntryPoint && mode === 'design' ? 'Double-click to rename' : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold truncate">{displayLabel}</h3>
                    {showMcpBadge && (
                      <span className="inline-flex items-center rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
                        MCP
                      </span>
                    )}
                  </div>
                  {hasCustomLabel && (
                    <span className="text-[10px] text-muted-foreground opacity-70 truncate block">
                      {component.name}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {mode === 'design' &&
                !isEntryPoint &&
                !!component?.toolProvider &&
                !isToolModeOnly &&
                componentCategory !== 'mcp' && (
                  <button
                    type="button"
                    onClick={toggleToolMode}
                    disabled={isToolModeOnly}
                    aria-label={isToolMode ? 'Disable Tool Mode' : 'Enable Tool Mode'}
                    aria-pressed={isToolMode}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded transition-all border',
                      isToolMode
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-background text-muted-foreground/60 border-border hover:border-purple-400 hover:text-purple-600',
                    )}
                    title={isToolMode ? 'Disable Tool Mode' : 'Enable Tool Mode'}
                  >
                    <Hammer
                      className={cn('h-3.5 w-3.5', isToolMode ? 'text-white' : 'text-current')}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      {isToolMode ? 'Tool' : 'Mode'}
                    </span>
                  </button>
                )}
              {entryPointHeaderSlot}
              {hasUnfilledRequired && !nodeStatus && (
                <span className="text-red-500 text-xs" title="Required fields missing">
                  !
                </span>
              )}
              {StatusIcon &&
                (!isTimelineActive || effectiveStatus !== 'running' || isPlaying) &&
                effectiveStatus !== 'success' && (
                  <StatusIcon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      nodeStyle.iconClass,
                      isTimelineActive &&
                        effectiveStatus === 'running' &&
                        isPlaying &&
                        'animate-spin',
                      isTimelineActive && effectiveStatus === 'error' && 'animate-bounce',
                    )}
                  />
                )}
              {supportsLiveLogs && mode === 'execution' && selectedRunId && (
                <TerminalButton
                  id={id}
                  label={displayLabel}
                  selectedRunId={selectedRunId}
                  isTerminalLoading={isTerminalLoading}
                  terminalSession={terminalSession}
                />
              )}
              {mode === 'design' && !isEntryPoint && (
                <button
                  type="button"
                  className={cn(
                    'p-1 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-all',
                    isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                  title="Delete node"
                  aria-label="Delete node"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
