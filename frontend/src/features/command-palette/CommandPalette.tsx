import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useThemeStore } from '@/store/themeStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { usePlacementStore } from '@/components/layout/sidebar-state';
import { useIsMac } from '@/hooks/useIsMac';
import { Search, Hash, CornerDownLeft, Command as CommandKeyIcon } from 'lucide-react';
import type { ComponentMetadata } from '@/schemas/component';
import type { Command, CommandCategory } from './command-palette-types';
import { useStaticCommands } from './useStaticCommands';
import { useEntityCommands } from './useEntityCommands';
import { useFilteredCommands } from './useFilteredCommands';
import { CommandGroup } from './CommandGroup';

const CATEGORY_ROUTES: Partial<Record<CommandCategory, string>> = {
  templates: '/templates',
  schedules: '/schedules',
  secrets: '/secrets',
  'api-keys': '/api-keys',
  webhooks: '/webhooks',
  workflows: '/',
};

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const close = useCommandPaletteStore((s) => s.close);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useThemeStore((s) => s.theme);
  const startTransition = useThemeStore((s) => s.startTransition);
  const mode = useWorkflowUiStore((state) => state.mode);
  const setPlacement = usePlacementStore((state) => state.setPlacement);
  const currentWorkflowId = useWorkflowStore((state) => state.metadata.id);
  const isMac = useIsMac();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialMountRef = useRef(true);

  // Check if we're on a workflow builder page
  const isOnWorkflowPage =
    location.pathname.startsWith('/workflows/') && location.pathname !== '/workflows/new';
  const isOnNewWorkflowPage = location.pathname === '/workflows/new';
  const canPlaceComponents = (isOnWorkflowPage || isOnNewWorkflowPage) && mode === 'design';

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Custom hooks for commands
  const staticCommands = useStaticCommands({ navigate, close, theme, startTransition });

  const {
    workflowCommands,
    componentCommands,
    templateCommands,
    scheduleCommands,
    secretCommands,
    apiKeyCommands,
    webhookCommands,
    allComponents,
    isLoadingWorkflows,
    isLoadingComponents,
  } = useEntityCommands(isOpen);

  const allCommands = useMemo<Command[]>(
    () => [
      ...staticCommands,
      ...workflowCommands,
      ...componentCommands,
      ...templateCommands,
      ...scheduleCommands,
      ...secretCommands,
      ...apiKeyCommands,
      ...webhookCommands,
    ],
    [
      staticCommands,
      workflowCommands,
      componentCommands,
      templateCommands,
      scheduleCommands,
      secretCommands,
      apiKeyCommands,
      webhookCommands,
    ],
  );

  const { groupedCommands, flatCommandList } = useFilteredCommands({
    query,
    allCommands,
    staticCommands,
    workflowCommands,
    componentCommands,
    canPlaceComponents,
  });

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatCommandList.length) {
      setSelectedIndex(Math.max(0, flatCommandList.length - 1));
    }
  }, [flatCommandList.length, selectedIndex]);

  // Handle component placement
  const handleComponentSelect = useCallback(
    (component: ComponentMetadata) => {
      if (!isOnWorkflowPage && !isOnNewWorkflowPage) {
        navigate('/workflows/new');
        close();
        return;
      }
      setPlacement(component.id, component.name, currentWorkflowId);
      close();
    },
    [isOnWorkflowPage, isOnNewWorkflowPage, navigate, close, setPlacement, currentWorkflowId],
  );

  // Execute command
  const executeCommand = useCallback(
    (command: Command) => {
      switch (command.type) {
        case 'navigation':
          navigate(command.href);
          close();
          break;
        case 'action':
          command.action();
          break;
        case 'workflow':
          navigate(`/workflows/${command.workflowId}`);
          close();
          break;
        case 'component': {
          const component = allComponents.find((c) => c.id === command.componentId);
          if (component) {
            handleComponentSelect(component);
          }
          break;
        }
      }
    },
    [navigate, close, allComponents, handleComponentSelect],
  );

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatCommandList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatCommandList[selectedIndex]) {
            executeCommand(flatCommandList[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    },
    [flatCommandList, selectedIndex, executeCommand, close],
  );

  // Scroll selected item into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const selectedEl = listEl.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on location change (skip initial mount to avoid closing on lazy-load)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    close();
  }, [location.pathname, close]);

  const handleViewAll = useCallback(
    (category: CommandCategory) => {
      const route = CATEGORY_ROUTES[category];
      if (route) {
        navigate(route);
        close();
      }
    },
    [navigate, close],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden rounded-xl border-border/50 bg-background/95 shadow-2xl backdrop-blur-xl [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search commands, workflows, and navigation
        </DialogDescription>

        {/* Search input */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/40 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                canPlaceComponents
                  ? 'Search commands, components, workflows...'
                  : 'Search commands, workflows, settings...'
              }
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              aria-label="Search commands"
              role="combobox"
              aria-expanded={true}
              aria-controls="command-palette-list"
              aria-activedescendant={
                flatCommandList[selectedIndex]
                  ? `cmd-${flatCommandList[selectedIndex].id}`
                  : undefined
              }
              autoComplete="off"
              spellCheck={false}
            />
            {!query.trim() && (
              <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-border/50 bg-background/70 px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                {isMac ? (
                  <>
                    <CommandKeyIcon className="h-2.5 w-2.5" />K
                  </>
                ) : (
                  'Ctrl+K'
                )}
              </kbd>
            )}
          </div>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-[360px] overflow-x-hidden overflow-y-auto px-1.5 pb-2"
        >
          {(isLoadingWorkflows || isLoadingComponents) && query && (
            <div className="px-3 py-3 text-sm text-muted-foreground">Loading...</div>
          )}

          {!isLoadingWorkflows && !isLoadingComponents && flatCommandList.length === 0 && (
            <div className="px-3 py-8 text-center">
              <Hash className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Try &quot;workflow&quot;, &quot;secrets&quot;, or a page name
              </p>
            </div>
          )}

          {groupedCommands.map((group, groupIndex) => {
            let startIndex = 0;
            for (let i = 0; i < groupIndex; i++) {
              startIndex += groupedCommands[i].commands.length;
            }

            return (
              <CommandGroup
                key={group.category}
                group={group}
                startIndex={startIndex}
                selectedIndex={selectedIndex}
                canPlaceComponents={canPlaceComponents}
                hasQuery={query.trim().length > 0}
                showDivider={groupIndex > 0}
                onExecuteCommand={executeCommand}
                onSelectIndex={setSelectedIndex}
                onViewAll={handleViewAll}
              />
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between gap-4 border-t border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↑
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
                <CornerDownLeft className="h-3 w-3" />
              </kbd>
              <span>Select</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
              ESC
            </kbd>
            <span>Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
