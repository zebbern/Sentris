import { useMemo } from 'react';
import { scoreCommand } from './command-palette-scoring';
import {
  type Command,
  type CommandCategory,
  type CommandGroup,
  categoryLabels,
  categoryOrder,
  MAX_RESULTS_PER_CATEGORY,
} from './command-palette-types';

interface UseFilteredCommandsOptions {
  query: string;
  allCommands: Command[];
  staticCommands: Command[];
  workflowCommands: Command[];
  componentCommands: Command[];
  canPlaceComponents: boolean;
}

interface UseFilteredCommandsResult {
  filteredCommands: Command[];
  groupedCommands: CommandGroup[];
  flatCommandList: Command[];
}

export function useFilteredCommands({
  query,
  allCommands,
  staticCommands,
  workflowCommands,
  componentCommands,
  canPlaceComponents,
}: UseFilteredCommandsOptions): UseFilteredCommandsResult {
  // Filter and score commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show static commands + limited entity results when no query
      return [
        ...staticCommands,
        ...(canPlaceComponents ? componentCommands.slice(0, MAX_RESULTS_PER_CATEGORY) : []),
        ...workflowCommands.slice(0, MAX_RESULTS_PER_CATEGORY),
      ];
    }

    const terms = query.toLowerCase().split(' ').filter(Boolean);

    return allCommands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd);
  }, [query, allCommands, staticCommands, workflowCommands, componentCommands, canPlaceComponents]);

  // Group commands by category with counts
  const groupedCommands = useMemo(() => {
    const groups = Object.fromEntries(categoryOrder.map((cat) => [cat, [] as Command[]])) as Record<
      CommandCategory,
      Command[]
    >;

    for (const cmd of filteredCommands) {
      groups[cmd.category].push(cmd);
    }

    const hasQuery = query.trim().length > 0;

    return categoryOrder
      .filter((cat) => groups[cat].length > 0)
      .map((cat) => {
        const all = groups[cat];
        return {
          category: cat,
          label: categoryLabels[cat],
          totalCount: all.length,
          commands: hasQuery ? all.slice(0, MAX_RESULTS_PER_CATEGORY) : all,
          hasMore: hasQuery && all.length > MAX_RESULTS_PER_CATEGORY,
        };
      });
  }, [filteredCommands, query]);

  // Flat list for keyboard navigation
  const flatCommandList = useMemo(() => {
    return groupedCommands.flatMap((group) => group.commands);
  }, [groupedCommands]);

  return { filteredCommands, groupedCommands, flatCommandList };
}
