import type { Dispatch, SetStateAction } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Editor from '@monaco-editor/react';
import type { WebhookFormState, WorkflowOption, RuntimeInput } from './webhookEditorTypes';

interface WebhookFormSectionProps {
  form: WebhookFormState;
  setForm: Dispatch<SetStateAction<WebhookFormState>>;
  workflows: WorkflowOption[];
  workflowRuntimeInputs: RuntimeInput[];
}

export function WebhookFormSection({
  form,
  setForm,
  workflows,
  workflowRuntimeInputs,
}: WebhookFormSectionProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-6">
      {/* Workflow Selection */}
      <div className="space-y-2">
        <Label>Trigger Workflow</Label>
        <Select
          value={form.workflowId}
          onValueChange={(v) => setForm((prev) => ({ ...prev, workflowId: v }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a workflow..." />
          </SelectTrigger>
          <SelectContent>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The workflow to trigger when this webhook receives an event.
        </p>
      </div>

      {/* Parsing Script */}
      <div className="space-y-2 flex-1 flex flex-col min-h-[400px]">
        <div className="flex items-center justify-between">
          <Label>Parsing Script</Label>
          <Badge variant="secondary" className="font-mono text-[10px]">
            TypeScript
          </Badge>
        </div>
        <div className="flex-1 border rounded-md overflow-hidden min-h-[300px]">
          <Editor
            language="typescript"
            value={form.parsingScript}
            onChange={(v) => setForm((prev) => ({ ...prev, parsingScript: v || '' }))}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>
      </div>

      {/* Expected Inputs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Expected Output (Workflow Inputs)</Label>
          <Badge variant="outline">{workflowRuntimeInputs.length} Inputs</Badge>
        </div>
        <div className="space-y-2">
          {workflowRuntimeInputs.map((input) => (
            <div
              key={input.id}
              className="flex items-center justify-between p-3 border rounded-md bg-muted/50"
            >
              <div className="flex flex-col">
                <span className="font-medium text-sm">{input.label}</span>
                <code className="text-xs text-muted-foreground">{input.id}</code>
              </div>
              <Badge variant={input.required ? 'default' : 'secondary'} className="text-[10px]">
                {input.type}
              </Badge>
            </div>
          ))}
          {workflowRuntimeInputs.length === 0 && (
            <div className="text-sm text-muted-foreground italic text-center py-4">
              Associate a workflow with an Entry Point to see required inputs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
