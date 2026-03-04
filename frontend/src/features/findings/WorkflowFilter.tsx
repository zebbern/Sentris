import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkflowsList } from '@/hooks/queries/useWorkflowQueries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowFilterProps {
  value: string | undefined;
  onChange: (workflowId: string | undefined) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowFilter({ value, onChange }: WorkflowFilterProps) {
  const { data: workflows } = useWorkflowsList();

  const handleChange = (val: string) => {
    onChange(val === 'all' ? undefined : val);
  };

  return (
    <Select value={value ?? 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Workflow" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All workflows</SelectItem>
        {(workflows ?? []).map((wf) => (
          <SelectItem key={wf.id} value={wf.id}>
            {wf.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
