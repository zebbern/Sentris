import { Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import type { TerminalButtonProps } from './types';

/**
 * Terminal button that opens/focuses a terminal tab in the bottom dock panel.
 * Replaces the previous ReactFlow terminal-node approach.
 */
export function TerminalButton({
  id,
  label,
  selectedRunId,
  isTerminalLoading,
  terminalSession,
}: TerminalButtonProps) {
  const dockedTerminals = useWorkflowUiStore((s) => s.dockedTerminals);
  const dockTerminal = useWorkflowUiStore((s) => s.dockTerminal);
  const setActiveDockedTerminal = useWorkflowUiStore((s) => s.setActiveDockedTerminal);

  const isDocked = dockedTerminals.some((t) => t.nodeId === id);

  const handleClick = () => {
    if (isDocked) {
      setActiveDockedTerminal(id);
    } else {
      dockTerminal(id, label, selectedRunId);
    }
  };

  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors',
          isDocked
            ? 'bg-blue-600/15 text-blue-600 border-blue-400 shadow-sm ring-2 ring-blue-300/60'
            : 'bg-slate-900/60 text-slate-100 border-slate-700',
        )}
        title="Live Logs"
        aria-label="Live Logs"
      >
        <TerminalIcon className="h-3 w-3 text-current" />
        {isTerminalLoading && <span className="animate-pulse">…</span>}
        {!isTerminalLoading && terminalSession?.chunks?.length ? (
          <span className="w-2 h-2 rounded-full bg-green-400" />
        ) : null}
      </button>
    </div>
  );
}
