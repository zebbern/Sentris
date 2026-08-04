import { Bot, Sparkles } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createOperatorWorkflowAuthoringNavigationState } from './operatorHandoff';

interface WorkflowOperatorHandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePath: string;
  workflowId?: string;
  workflowName: string;
  hasUnsavedChanges: boolean;
}

export function WorkflowOperatorHandoffDialog({
  open,
  onOpenChange,
  sourcePath,
  workflowId,
  workflowName,
  hasUnsavedChanges,
}: WorkflowOperatorHandoffDialogProps) {
  const navigate = useNavigate();
  const [request, setRequest] = useState('');
  const isNewWorkflow = !workflowId;
  const normalizedRequest = request.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedRequest) return;

    navigate('/operator', {
      state: createOperatorWorkflowAuthoringNavigationState({
        request: normalizedRequest,
        sourcePath,
        ...(workflowId ? { workflowId } : {}),
      }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              {isNewWorkflow ? 'Build with Operator' : `Ask Operator about ${workflowName}`}
            </DialogTitle>
            <DialogDescription>
              {isNewWorkflow
                ? 'Describe the outcome you want. Operator will inspect the available components and create a workflow draft you can review in the Builder.'
                : 'Operator receives the saved workflow identity, inspects its exact current version, and can propose focused changes for review.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-5">
            <Label htmlFor="workflow-operator-request">
              {isNewWorkflow ? 'What should the workflow accomplish?' : 'What should Operator do?'}
            </Label>
            <Textarea
              id="workflow-operator-request"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder={
                isNewWorkflow
                  ? 'Example: Discover subdomains, probe live hosts, scan for high-confidence vulnerabilities, and summarize reportable findings.'
                  : 'Example: Review this workflow and propose the most useful focused improvement.'
              }
              className="min-h-28 resize-y"
              maxLength={4_000}
              autoFocus
            />
            {!isNewWorkflow && hasUnsavedChanges ? (
              <p className="text-xs text-amber-500">
                Operator uses the latest saved version. Save first if your current canvas changes
                should be included.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!normalizedRequest} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Continue in Operator
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
