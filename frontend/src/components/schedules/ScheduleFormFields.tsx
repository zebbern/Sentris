import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ScheduleFormState, WorkflowOption } from './scheduleTypes';

interface ScheduleFormFieldsProps {
  form: ScheduleFormState;
  workflowOptions: WorkflowOption[];
  selectedWorkflow: WorkflowOption | null;
  workflowDisabled: boolean;
  onFieldChange: <K extends keyof ScheduleFormState>(key: K, value: ScheduleFormState[K]) => void;
  onWorkflowChange: (value: string) => void;
}

export function ScheduleFormFields({
  form,
  workflowOptions,
  selectedWorkflow,
  workflowDisabled,
  onFieldChange,
  onWorkflowChange,
}: ScheduleFormFieldsProps) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Workflow</Label>
          <Select
            value={form.workflowId || 'none'}
            disabled={workflowDisabled || workflowOptions.length === 0}
            onValueChange={(value) => {
              if (value === 'none') {
                onWorkflowChange('');
                return;
              }
              onWorkflowChange(value);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select workflow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>
                Select workflow
              </SelectItem>
              {workflowOptions.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWorkflow ? (
            <p className="text-xs text-muted-foreground">{selectedWorkflow.name}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Choose which workflow this cadence should invoke.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Schedule name</Label>
          <Input
            value={form.name}
            onChange={(event) => onFieldChange('name', event.target.value)}
            placeholder="Daily quick scan"
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">
            Appears in run metadata and chips inside the workflow.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Description</Label>
        <Textarea
          value={form.description}
          onChange={(event) => onFieldChange('description', event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Optional context for other operators."
        />
      </div>
    </section>
  );
}
