import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ScheduleFormState, WorkflowOption } from './scheduleTypes';
import { FieldHintLabel } from './FieldHintLabel';

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
    <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <FieldHintLabel hint="Choose which workflow this cadence should invoke.">
            Workflow
          </FieldHintLabel>
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
            <SelectTrigger className="h-9">
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
            <p className="truncate text-[11px] text-muted-foreground">{selectedWorkflow.name}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <FieldHintLabel hint="Appears in run metadata and chips inside the workflow.">
            Schedule name
          </FieldHintLabel>
          <Input
            value={form.name}
            onChange={(event) => onFieldChange('name', event.target.value)}
            placeholder="Daily quick scan"
            maxLength={100}
            className="h-9"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldHintLabel hint="Optional context for other operators.">Description</FieldHintLabel>
        <Textarea
          value={form.description}
          onChange={(event) => onFieldChange('description', event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional context for other operators."
          className="min-h-[2.75rem] resize-y"
        />
      </div>
    </section>
  );
}
