import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StatusFilter } from '@/hooks/queries/useScheduleQueries';
import type { WorkflowOption } from '@/utils/tableHelpers';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
];

interface ScheduleFiltersProps {
  status: StatusFilter;
  workflowId: string | null;
  workflowOptions: WorkflowOption[];
  workflowsLoading: boolean;
  onStatusChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
}

export function ScheduleFilters({
  status,
  workflowId,
  workflowOptions,
  workflowsLoading,
  onStatusChange,
  onWorkflowChange,
}: ScheduleFiltersProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-2">
        <label className="text-xs uppercase text-muted-foreground">Status</label>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs uppercase text-muted-foreground">Workflow</label>
        <Select
          value={workflowId ?? 'all'}
          onValueChange={onWorkflowChange}
          disabled={workflowsLoading}
        >
          <SelectTrigger aria-label="Filter by workflow">
            <SelectValue placeholder="All workflows" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workflows</SelectItem>
            {workflowOptions.map((workflow) => (
              <SelectItem key={workflow.id} value={workflow.id}>
                {workflow.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
