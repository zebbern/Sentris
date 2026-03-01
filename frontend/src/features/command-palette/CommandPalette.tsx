import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useThemeStore } from '@/store/themeStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { usePlacementStore } from '@/components/layout/sidebar-state';
import { Search, Hash, CornerDownLeft } from 'lucide-react';
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
        className="max-w-2xl p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl"
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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
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
            className="flex-1 bg-transparent border-none outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-base placeholder:text-muted-foreground/60"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto overflow-x-hidden">
          {(isLoadingWorkflows || isLoadingComponents) && query && (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading...</div>
          )}

          {!isLoadingWorkflows && !isLoadingComponents && flatCommandList.length === 0 && (
            <div className="px-4 py-8 text-center">
              <Hash className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
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
                onExecuteCommand={executeCommand}
                onSelectIndex={setSelectedIndex}
                onViewAll={handleViewAll}
              />
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border/50 bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↑
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
                <CornerDownLeft className="w-3 h-3" />
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
