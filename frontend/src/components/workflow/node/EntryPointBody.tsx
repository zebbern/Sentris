import { Handle, Position } from 'reactflow';
import { CalendarClock, Settings, Webhook } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useEntryPointActions } from '../entry-point-context';

export interface EntryPointBodyProps {
  effectiveOutputs: any[];
  workflowId: string | undefined;
  onOpenWebhookDialog: () => void;
}

/**
 * Body layout for entry-point nodes: webhook / schedule / inputs buttons on the left,
 * dynamic output handles on the right.
 */
export function EntryPointBody({
  effectiveOutputs,
  workflowId,
  onOpenWebhookDialog,
}: EntryPointBodyProps) {
  const navigate = useNavigate();
  const mode = useWorkflowUiStore((s) => s.mode);
  const { onOpenScheduleSidebar, onOpenWebhooksSidebar, selectEntryPoint } = useEntryPointActions();

  return (
    <div className="flex gap-3 mt-1">
      <div className="flex-[0.6] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenWebhooksSidebar) {
              onOpenWebhooksSidebar();
            } else {
              onOpenWebhookDialog();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
        >
          <Webhook className="h-3 w-3 flex-shrink-0" />
          <span>Webhooks</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenScheduleSidebar) {
              onOpenScheduleSidebar();
            } else {
              navigate(`/schedules?workflowId=${workflowId}`);
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
        >
          <CalendarClock className="h-3 w-3 flex-shrink-0" />
          <span>Schedules</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (mode === 'design') {
              selectEntryPoint?.();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
        >
          <Settings className="h-3 w-3 flex-shrink-0" />
          <span>Inputs</span>
        </button>
      </div>
      <div className="flex-[0.4] flex flex-col justify-start">
        {effectiveOutputs.length > 0 ? (
          <div className="space-y-1.5">
            {effectiveOutputs.map((output) => (
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
        ) : (
          <div className="relative flex items-center justify-end gap-2 text-xs">
            <div className="flex-1 text-right italic font-medium opacity-60">Triggered</div>
            <Handle
              type="source"
              position={Position.Right}
              className="!w-[10px] !h-[10px] !border-2 !border-blue-500 !bg-blue-500 !rounded-full"
              style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
