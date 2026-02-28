import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OverrideDraft, ScheduleWorkflowNode } from './scheduleTypes';

interface NodeOverridesSectionProps {
  nodeOverridesDraft: OverrideDraft;
  nodeOverrideErrors: Record<string, string>;
  workflowNodes: ScheduleWorkflowNode[];
  availableOverrideNodes: ScheduleWorkflowNode[];
  pendingOverrideNode: string;
  onAddOverrideNode: () => void;
  onRemoveOverrideNode: (nodeId: string) => void;
  onOverrideChange: (nodeId: string, value: string) => void;
  onPendingOverrideNodeChange: (nodeId: string) => void;
}

export function NodeOverridesSection({
  nodeOverridesDraft,
  nodeOverrideErrors,
  workflowNodes,
  availableOverrideNodes,
  pendingOverrideNode,
  onAddOverrideNode,
  onRemoveOverrideNode,
  onOverrideChange,
  onPendingOverrideNodeChange,
}: NodeOverridesSectionProps) {
  const overrideEntries = Object.entries(nodeOverridesDraft);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Node overrides</h3>
          <p className="text-xs text-muted-foreground">
            Override component parameters for this schedule without touching the workflow graph.
          </p>
        </div>
        <Badge variant="outline">{overrideEntries.length} overrides</Badge>
      </div>

      <div className="space-y-3">
        {overrideEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Workflow nodes will appear here so you can override parameters when this schedule runs.
          </p>
        ) : (
          overrideEntries.map(([nodeId, draftValue]) => {
            const node = workflowNodes.find((candidate) => candidate.id === nodeId);
            const label = node?.data?.label ?? nodeId;
            const error = nodeOverrideErrors[nodeId];
            return (
              <div key={nodeId} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{nodeId}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Remove override"
                    onClick={() => onRemoveOverrideNode(nodeId)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                <Textarea
                  rows={4}
                  className={cn('font-mono', error && 'border-red-500')}
                  value={draftValue}
                  onChange={(event) => onOverrideChange(nodeId, event.target.value)}
                  placeholder='{"parameter": "value"}'
                />
                {error ? <p className="text-xs text-red-500">{error}</p> : null}
              </div>
            );
          })
        )}
        {workflowNodes.length > 0 && availableOverrideNodes.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={pendingOverrideNode || 'select-node'}
              onValueChange={(value) => {
                if (value === 'select-node') return;
                onPendingOverrideNodeChange(value);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select node to override" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="select-node" disabled>
                  Select node
                </SelectItem>
                {availableOverrideNodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.data?.label ?? node.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={!pendingOverrideNode}
              onClick={onAddOverrideNode}
            >
              <Plus className="h-4 w-4" />
              Add override
            </Button>
          </div>
        ) : null}
        {workflowNodes.length > 0 &&
        overrideEntries.length === 0 &&
        availableOverrideNodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every workflow node already has overrides attached to this schedule.
          </p>
        ) : null}
      </div>
    </section>
  );
}
