import { Handle, Position } from '@xyflow/react';
import { Check, GitBranch, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeVisualState } from '@/store/executionTimelineStore';
import type { OutputPort } from '@/schemas/component';

export interface NodeOutputPortsProps {
  effectiveOutputs: OutputPort[];
  isToolMode: boolean;
  isTimelineActive: boolean;
  visualState: NodeVisualState;
}

const DESIGN_MODE_COLORS: Record<string, string> = {
  green:
    'bg-green-50/80 dark:bg-green-900/20 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300',
  red: 'bg-red-50/80 dark:bg-red-900/20 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300',
  amber:
    'bg-amber-50/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300',
  blue: 'bg-blue-50/80 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300',
  purple:
    'bg-purple-50/80 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 text-purple-700 dark:text-purple-300',
  slate:
    'bg-slate-100/80 dark:bg-slate-800/30 border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-300',
};

const HANDLE_DESIGN_COLORS: Record<string, string> = {
  green: '!border-green-500 !bg-green-500',
  red: '!border-red-500 !bg-red-500',
  amber: '!border-amber-500 !bg-amber-500',
  blue: '!border-blue-500 !bg-blue-500',
  purple: '!border-purple-500 !bg-purple-500',
  slate: '!border-slate-500 !bg-slate-500',
};

/**
 * Renders the output ports section: tool-mode export handle, regular outputs, and branching outputs.
 */
export function NodeOutputPorts({
  effectiveOutputs,
  isToolMode,
  isTimelineActive,
  visualState,
}: NodeOutputPortsProps) {
  if (isToolMode) {
    return (
      <div className="relative flex items-center justify-end gap-2 text-xs">
        <div className="flex-1 text-right text-purple-600 dark:text-purple-400 font-medium italic">
          Tool Export
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="tools"
          className="!w-[10px] !h-[10px] !border-2 !border-purple-500 !bg-purple-500 !rounded-full"
          style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
        />
      </div>
    );
  }

  const regularOutputs = effectiveOutputs.filter((o) => !o.isBranching);
  const branchingOutputs = effectiveOutputs.filter((o) => o.isBranching);

  return (
    <>
      {/* Regular output ports */}
      {regularOutputs.length > 0 && (
        <div className="space-y-1.5">
          {regularOutputs.map((output) => (
            <div key={output.id} className="relative flex items-center justify-end gap-2 text-xs">
              <div className="flex-1 text-right">
                <div className="text-muted-foreground font-medium">{output.label}</div>
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={output.id}
                className="!w-[10px] !h-[10px] !border-2 !border-green-500 !bg-green-500 !rounded-full"
                style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Branching outputs */}
      {branchingOutputs.length > 0 && (
        <BranchingOutputs
          branchingOutputs={branchingOutputs}
          isTimelineActive={isTimelineActive}
          visualState={visualState}
        />
      )}
    </>
  );
}

/** Branching decision outputs with activated/inactive visual states. */
function BranchingOutputs({
  branchingOutputs,
  isTimelineActive,
  visualState,
}: {
  branchingOutputs: OutputPort[];
  isTimelineActive: boolean;
  visualState: NodeVisualState;
}) {
  const data = isTimelineActive ? visualState.lastEvent?.data : undefined;
  const activatedPorts = data?.activatedPorts;
  const legacyActiveBranchId =
    !activatedPorts && data
      ? data.approved === true
        ? 'approved'
        : data.approved === false
          ? 'rejected'
          : null
      : null;
  const isNodeFinished =
    isTimelineActive && (visualState.status === 'success' || visualState.status === 'error');
  const isNodeSkipped = isTimelineActive && visualState.status === 'skipped';
  const hasBranchDecision = isNodeFinished || isNodeSkipped;

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-amber-300/50 dark:border-amber-700/50">
      <div className="flex gap-2">
        <div className="flex items-center gap-1 flex-shrink-0">
          <GitBranch className="h-3 w-3 text-amber-500 dark:text-amber-400" />
          <span className="text-[9px] font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wider">
            Branches
          </span>
        </div>
        <div className="flex flex-col flex-1 gap-1">
          {branchingOutputs.map((output) => {
            const isActive =
              isNodeFinished &&
              (activatedPorts
                ? activatedPorts.includes(output.id)
                : legacyActiveBranchId === output.id);
            const isInactive = isNodeSkipped || (isNodeFinished && !isActive);
            const branchColor = output.branchColor || 'amber';

            return (
              <div key={output.id} className="relative flex items-center justify-end gap-2 text-xs">
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all',
                    'border',
                    !hasBranchDecision && DESIGN_MODE_COLORS[branchColor],
                    isActive &&
                      'bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 ring-1 ring-green-400/50',
                    isInactive &&
                      'bg-slate-50/50 dark:bg-slate-900/20 border-dashed border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 opacity-30 grayscale-[0.8]',
                  )}
                >
                  {isActive && <Check className="h-2.5 w-2.5" />}
                  {isInactive && <X className="h-2.5 w-2.5 text-slate-400/50" />}
                  <span>{output.label}</span>
                </div>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.id}
                  className={cn(
                    '!w-[10px] !h-[10px] !border-2 !rounded-full',
                    !hasBranchDecision && HANDLE_DESIGN_COLORS[branchColor],
                    isActive && '!border-green-500 !bg-green-500',
                    isInactive && '!border-slate-300 !bg-slate-200 dark:!bg-slate-800 opacity-30',
                  )}
                  style={{
                    top: '50%',
                    right: '-18px',
                    transform: 'translateY(-50%)',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
